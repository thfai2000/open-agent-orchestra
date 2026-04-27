/**
 * Helper for ensuring an OAO workspace credential variable backed by
 * `TESTING_GITHUB_PAT` (or `GITHUB_TOKEN`) exists, so any test agent created
 * by the E2E suite can be wired to a real Copilot token. Without this, agents
 * created by Playwright runs are stranded without a token and any LLM call
 * the workflow makes will fail or never be triggered.
 *
 * Usage:
 *   const tokenVarId = await ensureWorkspaceCopilotTokenVariable(request, authToken);
 *   if (tokenVarId) {
 *     // Pass tokenVarId as `copilotTokenCredentialId` to POST /api/agents.
 *   } else {
 *     // No PAT available locally — caller may skip the LLM-dependent test.
 *   }
 */
import type { APIRequestContext } from '@playwright/test';

const VARIABLE_KEY = 'TESTING_GITHUB_PAT';

export function getTestingCopilotTokenValue(): string | undefined {
  return process.env.TESTING_GITHUB_PAT?.trim() || process.env.GITHUB_TOKEN?.trim() || undefined;
}

interface WorkspaceVariable {
  id: string;
  key: string;
  variableType?: string;
  credentialSubType?: string | null;
}

/**
 * Idempotently ensure a workspace-scoped credential variable named
 * `TESTING_GITHUB_PAT` exists with the value from the environment. Returns the
 * variable id, or `null` if no PAT is available in the test environment.
 *
 * This helper is safe to call from many tests in parallel: variable creation
 * uses `key` uniqueness, and any "already exists" 409 falls back to a list
 * lookup to retrieve the existing record.
 */
export async function ensureWorkspaceCopilotTokenVariable(
  request: APIRequestContext,
  authToken: string,
): Promise<string | null> {
  const tokenValue = getTestingCopilotTokenValue();
  if (!tokenValue) return null;

  const headers = { Authorization: `Bearer ${authToken}` };

  const listResponse = await request.get('/api/variables', {
    headers,
    params: { scope: 'workspace' },
  });
  if (listResponse.ok()) {
    const body = await listResponse.json() as { variables?: WorkspaceVariable[]; data?: WorkspaceVariable[] };
    const list = body.variables ?? body.data ?? [];
    const existing = list.find((entry) => entry.key === VARIABLE_KEY);
    if (existing?.id) return existing.id;
  }

  const createResponse = await request.post('/api/variables', {
    headers,
    data: {
      scope: 'workspace',
      key: VARIABLE_KEY,
      value: tokenValue,
      variableType: 'credential',
      credentialSubType: 'github_token',
      injectAsEnvVariable: false,
      description: 'Shared Copilot token for Playwright-created agents (auto-managed by tests/e2e).',
    },
  });

  if (createResponse.status() === 201) {
    const body = await createResponse.json() as { variable?: { id?: string } };
    if (body.variable?.id) return body.variable.id;
  }

  // Race / re-create: re-list and pick whatever is now there.
  const retryList = await request.get('/api/variables', {
    headers,
    params: { scope: 'workspace' },
  });
  if (retryList.ok()) {
    const body = await retryList.json() as { variables?: WorkspaceVariable[]; data?: WorkspaceVariable[] };
    const list = body.variables ?? body.data ?? [];
    const existing = list.find((entry) => entry.key === VARIABLE_KEY);
    if (existing?.id) return existing.id;
  }

  return null;
}
