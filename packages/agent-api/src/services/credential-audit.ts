import { CopilotClient, approveAll } from '@github/copilot-sdk';
import { eq } from 'drizzle-orm';
import { createLogger } from '@ai-trader/shared';
import { db } from '../database/index.js';
import { agents, stepExecutions, workflowExecutions } from '../database/schema.js';
import { prepareAgentWorkspace, prepareDbAgentWorkspace } from './agent-workspace.js';

const logger = createLogger('credential-audit');

/**
 * Lazy-created audit sessions per execution.
 * Key: executionId, Value: { session, client, messages }
 */
const auditSessions = new Map<string, {
  session: Awaited<ReturnType<CopilotClient['createSession']>>;
  client: CopilotClient;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  cleanup: () => Promise<void>;
}>();

export interface AuditCredentialParams {
  approvalAgentId: string;
  requestingAgentId: string;
  executionId?: string;
  credentialName: string;
  envName: string;
  reason: string;
  credentialSource: string;
  workspaceId: string;
}

export interface AuditCredentialResult {
  approved: boolean;
  sessionMessages: Array<{ role: string; content: string; timestamp: string }>;
}

/**
 * Run a sandbox Copilot session to audit a credential access request.
 * The audit session is lazily created per execution and reused for
 * subsequent credential requests in the same execution.
 *
 * The approval agent reviews the request context (which agent, which credential,
 * why, execution history) and returns a JSON verdict: { approved: true/false, reason: "..." }
 */
export async function auditCredentialRequest(params: AuditCredentialParams): Promise<AuditCredentialResult> {
  const {
    approvalAgentId,
    requestingAgentId,
    executionId,
    credentialName,
    envName,
    reason,
    credentialSource,
  } = params;

  const sessionKey = executionId ?? `adhoc-${Date.now()}`;

  // Get or create the audit session for this execution
  let auditEntry = auditSessions.get(sessionKey);

  if (!auditEntry) {
    // Load the approval agent
    const approvalAgent = await db.query.agents.findFirst({
      where: eq(agents.id, approvalAgentId),
    });

    if (!approvalAgent) {
      throw new Error(`Approval agent ${approvalAgentId} not found`);
    }

    // Prepare workspace for the approval agent
    const workspace = approvalAgent.sourceType === 'database'
      ? await prepareDbAgentWorkspace(approvalAgent.id)
      : await prepareAgentWorkspace({
        gitRepoUrl: approvalAgent.gitRepoUrl!,
        gitBranch: approvalAgent.gitBranch,
        agentFilePath: approvalAgent.agentFilePath!,
        skillsPaths: approvalAgent.skillsPaths ?? [],
        skillsDirectory: approvalAgent.skillsDirectory,
        githubTokenEncrypted: approvalAgent.githubTokenEncrypted,
      });

    const skillsContent = workspace.skills.length
      ? `\n\n## Agent Skills\n\n${workspace.skills.join('\n\n---\n\n')}`
      : '';

    const systemContent = `${workspace.agentMarkdown}${skillsContent}

## Security Audit Role

You are a security audit agent for the Open Agent Orchestra (OAO) platform.
Your role is to review credential access requests from other agents during workflow execution.

For each request, you must evaluate:
1. Is the credential request reasonable for the agent's stated purpose?
2. Does the reason justify access to this specific credential?
3. Are there any signs of credential misuse or unauthorized access patterns?

IMPORTANT: You MUST respond with a JSON object and nothing else:
{ "approved": true, "reason": "Brief explanation" }
or
{ "approved": false, "reason": "Brief explanation why denied" }

If you are unsure, err on the side of DENYING the request.`;

    const client = new CopilotClient();
    const model = process.env.DEFAULT_AGENT_MODEL ?? 'gpt-4.1';

    const session = await client.createSession({
      model,
      tools: [],
      onPermissionRequest: approveAll,
      systemMessage: {
        mode: 'customize',
        sections: {
          code_change_rules: { action: 'remove' },
        },
        content: systemContent,
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const messages: Array<{ role: string; content: string; timestamp: string }> = [];

    auditEntry = { session, client, messages, cleanup: workspace.cleanup };
    auditSessions.set(sessionKey, auditEntry);

    logger.info({ approvalAgentId, executionId: sessionKey }, 'Created sandbox audit session');
  }

  // Build execution context for the audit prompt
  let executionContext = '';
  if (executionId) {
    const execution = await db.query.workflowExecutions.findFirst({
      where: eq(workflowExecutions.id, executionId),
    });
    const steps = execution ? await db.query.stepExecutions.findMany({
      where: eq(stepExecutions.workflowExecutionId, executionId),
      orderBy: stepExecutions.stepOrder,
    }) : [];

    const completedSteps = steps
      .filter(s => s.status === 'completed')
      .map(s => `  Step ${s.stepOrder}: ${s.output?.substring(0, 200) ?? '(no output)'}`)
      .join('\n');

    executionContext = `
Execution ID: ${executionId}
Workflow: ${(execution?.workflowSnapshot as { workflow?: { name?: string } })?.workflow?.name ?? 'unknown'}
Steps completed so far:
${completedSteps || '  (none yet)'}`;
  }

  // Load requesting agent info
  const requestingAgent = await db.query.agents.findFirst({
    where: eq(agents.id, requestingAgentId),
  });

  const auditPrompt = `
## Credential Access Request

**Requesting Agent**: ${requestingAgent?.name ?? requestingAgentId} (ID: ${requestingAgentId})
**Credential Name**: ${credentialName}
**Target Env Variable**: ${envName}
**Reason**: ${reason}
**Credential Source**: ${credentialSource}-level variable
${executionContext}

Please review this credential access request and respond with your verdict as a JSON object.`;

  // Record the prompt
  auditEntry.messages.push({
    role: 'user',
    content: auditPrompt,
    timestamp: new Date().toISOString(),
  });

  try {
    const response = await auditEntry.session.sendAndWait({ prompt: auditPrompt }, 30_000);
    const responseContent = response?.data?.content ?? '';

    auditEntry.messages.push({
      role: 'assistant',
      content: responseContent,
      timestamp: new Date().toISOString(),
    });

    logger.info({ executionId: sessionKey, credentialName, response: responseContent }, 'Audit session response');

    // Parse the JSON verdict
    const jsonMatch = responseContent.match(/\{[\s\S]*"approved"\s*:\s*(true|false)[\s\S]*\}/);
    if (jsonMatch) {
      const verdict = JSON.parse(jsonMatch[0]);
      return {
        approved: verdict.approved === true,
        sessionMessages: [...auditEntry.messages],
      };
    }

    // If we can't parse, default to deny
    logger.warn({ response: responseContent }, 'Could not parse audit verdict, denying');
    return {
      approved: false,
      sessionMessages: [...auditEntry.messages],
    };
  } catch (error) {
    logger.error({ error, credentialName }, 'Audit session error');
    auditEntry.messages.push({
      role: 'system',
      content: `Audit error: ${error instanceof Error ? error.message : 'unknown'}`,
      timestamp: new Date().toISOString(),
    });
    return {
      approved: false,
      sessionMessages: [...auditEntry.messages],
    };
  }
}

/**
 * Clean up an audit session for a given execution.
 * Should be called when the workflow execution completes.
 */
export async function cleanupAuditSession(executionId: string): Promise<void> {
  const entry = auditSessions.get(executionId);
  if (entry) {
    try {
      await entry.session.disconnect();
      await entry.client.stop();
      await entry.cleanup();
    } catch {
      // ignore cleanup errors
    }
    auditSessions.delete(executionId);
    logger.info({ executionId }, 'Audit session cleaned up');
  }
}
