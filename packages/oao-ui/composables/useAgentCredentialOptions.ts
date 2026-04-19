interface CredentialVariableSummary {
  id: string;
  key: string;
  variableType: string;
  credentialSubType?: string | null;
}

interface CredentialOption {
  id: string;
  key: string;
  scope: 'agent' | 'user' | 'workspace';
  scopeLabel: string;
  credentialSubType: string;
  subTypeLabel: string;
  optionLabel: string;
}

const SCOPE_ORDER: Record<CredentialOption['scope'], number> = {
  agent: 0,
  user: 1,
  workspace: 2,
};

const CREDENTIAL_SUBTYPE_LABELS: Record<string, string> = {
  secret_text: 'Secret Text',
  github_token: 'GitHub Token',
  github_app: 'GitHub App',
  user_account: 'User Account',
  private_key: 'Private Key',
  certificate: 'Certificate',
};

const GIT_AUTH_SUBTYPES = new Set(['secret_text', 'github_token', 'github_app', 'user_account']);
const COPILOT_AUTH_SUBTYPES = new Set(['secret_text', 'github_token']);

export function useAgentCredentialOptions() {
  function formatCredentialSubType(subType?: string | null): string {
    return CREDENTIAL_SUBTYPE_LABELS[subType || 'secret_text'] || subType || 'Secret Text';
  }

  function buildCredentialOptions(
    sources: Array<{
      scope: CredentialOption['scope'];
      scopeLabel: string;
      variables: CredentialVariableSummary[];
    }>,
  ): CredentialOption[] {
    return sources
      .flatMap(({ scope, scopeLabel, variables }) => variables
        .filter((variable) => variable.variableType === 'credential')
        .map((variable) => {
          const credentialSubType = variable.credentialSubType || 'secret_text';
          const subTypeLabel = formatCredentialSubType(credentialSubType);

          return {
            id: variable.id,
            key: variable.key,
            scope,
            scopeLabel,
            credentialSubType,
            subTypeLabel,
            optionLabel: `${variable.key} (${scopeLabel} · ${subTypeLabel})`,
          };
        }))
      .sort((left, right) => {
        const scopeDelta = SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope];
        return scopeDelta !== 0 ? scopeDelta : left.key.localeCompare(right.key);
      });
  }

  function filterGitAuthCredentialOptions(options: CredentialOption[], selectedId?: string | null): CredentialOption[] {
    return options.filter((option) => GIT_AUTH_SUBTYPES.has(option.credentialSubType) || option.id === selectedId);
  }

  function filterCopilotCredentialOptions(options: CredentialOption[], selectedId?: string | null): CredentialOption[] {
    return options.filter((option) => COPILOT_AUTH_SUBTYPES.has(option.credentialSubType) || option.id === selectedId);
  }

  function findCredentialOption(options: CredentialOption[], credentialId?: string | null): CredentialOption | null {
    if (!credentialId) return null;
    return options.find((option) => option.id === credentialId) || null;
  }

  return {
    buildCredentialOptions,
    filterGitAuthCredentialOptions,
    filterCopilotCredentialOptions,
    formatCredentialSubType,
    findCredentialOption,
  };
}

export type { CredentialOption, CredentialVariableSummary };