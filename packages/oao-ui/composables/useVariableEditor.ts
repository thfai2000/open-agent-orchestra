type VariableScope = 'agent' | 'user' | 'workspace';
type VariableType = 'credential' | 'property';
type CredentialSubType = 'secret_text' | 'github_token' | 'github_app' | 'user_account' | 'private_key' | 'certificate';

interface VariableSummary {
  id: string;
  key: string;
  variableType: VariableType;
  credentialSubType?: CredentialSubType | null;
  injectAsEnvVariable: boolean;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  scope?: VariableScope;
  agentId?: string | null;
}

interface VariableFormState {
  scope: VariableScope;
  agentId: string;
  key: string;
  value: string;
  description: string;
  variableType: VariableType;
  credentialSubType: CredentialSubType;
  injectAsEnvVariable: boolean;
}

interface VariableSubFields {
  appId: string;
  installationId: string;
  privateKey: string;
  username: string;
  password: string;
  key: string;
  passphrase: string;
  certificate: string;
}

interface SerializeVariableValueInput {
  variableType: VariableType;
  credentialSubType: CredentialSubType;
  rawValue: string;
  subFields: VariableSubFields;
  required: boolean;
}

interface SerializeVariableValueResult {
  error?: string;
  hasValue: boolean;
  value?: string;
}

const CREDENTIAL_SUB_TYPE_HINTS: Record<CredentialSubType, string> = {
  secret_text: 'A generic secret string such as an API key or token.',
  github_token: 'A GitHub Personal Access Token credential.',
  github_app: 'GitHub App credentials with App ID, Installation ID, and Private Key.',
  user_account: 'A username and password or secret pair.',
  private_key: 'An SSH or PEM private key with an optional passphrase.',
  certificate: 'An X.509 certificate with an optional private key and passphrase.',
};

function formatCredentialSubType(subType?: CredentialSubType | null): string {
  const labels: Record<CredentialSubType, string> = {
    secret_text: 'Secret Text',
    github_token: 'GitHub Token',
    github_app: 'GitHub App',
    user_account: 'User Account',
    private_key: 'Private Key',
    certificate: 'Certificate',
  };

  return subType ? labels[subType] ?? subType : 'Secret Text';
}

function formatVariableScopeLabel(scope: VariableScope): string {
  const labels: Record<VariableScope, string> = {
    agent: 'Agent',
    user: 'User',
    workspace: 'Workspace',
  };

  return labels[scope];
}

function createEmptyVariableForm(overrides: Partial<VariableFormState> = {}): VariableFormState {
  return {
    scope: 'user',
    agentId: '',
    key: '',
    value: '',
    description: '',
    variableType: 'credential',
    credentialSubType: 'secret_text',
    injectAsEnvVariable: false,
    ...overrides,
  };
}

function createEmptyVariableSubFields(overrides: Partial<VariableSubFields> = {}): VariableSubFields {
  return {
    appId: '',
    installationId: '',
    privateKey: '',
    username: '',
    password: '',
    key: '',
    passphrase: '',
    certificate: '',
    ...overrides,
  };
}

function hasTextValue(value: string): boolean {
  return value.trim().length > 0;
}

function serializeVariableValue(input: SerializeVariableValueInput): SerializeVariableValueResult {
  const { variableType, credentialSubType, rawValue, subFields, required } = input;

  if (variableType === 'property') {
    if (!hasTextValue(rawValue)) {
      return required ? { error: 'A property value is required.', hasValue: false } : { hasValue: false };
    }

    return { hasValue: true, value: rawValue };
  }

  if (credentialSubType === 'github_app') {
    const hasAnyValue = [subFields.appId, subFields.installationId, subFields.privateKey].some(hasTextValue);
    if (!hasAnyValue && !required) return { hasValue: false };
    if (!hasTextValue(subFields.appId) || !hasTextValue(subFields.installationId) || !hasTextValue(subFields.privateKey)) {
      return { error: 'GitHub App credentials require App ID, Installation ID, and Private Key.', hasValue: false };
    }

    return {
      hasValue: true,
      value: JSON.stringify({
        appId: subFields.appId,
        installationId: subFields.installationId,
        privateKey: subFields.privateKey,
      }),
    };
  }

  if (credentialSubType === 'user_account') {
    const hasAnyValue = [subFields.username, subFields.password].some(hasTextValue);
    if (!hasAnyValue && !required) return { hasValue: false };
    if (!hasTextValue(subFields.username) || !hasTextValue(subFields.password)) {
      return { error: 'User Account credentials require both username and password.', hasValue: false };
    }

    return {
      hasValue: true,
      value: JSON.stringify({
        username: subFields.username,
        password: subFields.password,
      }),
    };
  }

  if (credentialSubType === 'private_key') {
    const hasAnyValue = [subFields.key, subFields.passphrase].some(hasTextValue);
    if (!hasAnyValue && !required) return { hasValue: false };
    if (!hasTextValue(subFields.key)) {
      return { error: 'Private Key credentials require the private key content.', hasValue: false };
    }

    const value: Record<string, string> = { key: subFields.key };
    if (hasTextValue(subFields.passphrase)) value.passphrase = subFields.passphrase;

    return { hasValue: true, value: JSON.stringify(value) };
  }

  if (credentialSubType === 'certificate') {
    const hasAnyValue = [subFields.certificate, subFields.key, subFields.passphrase].some(hasTextValue);
    if (!hasAnyValue && !required) return { hasValue: false };
    if (!hasTextValue(subFields.certificate)) {
      return { error: 'Certificate credentials require the certificate content.', hasValue: false };
    }

    const value: Record<string, string> = { certificate: subFields.certificate };
    if (hasTextValue(subFields.key)) value.key = subFields.key;
    if (hasTextValue(subFields.passphrase)) value.passphrase = subFields.passphrase;

    return { hasValue: true, value: JSON.stringify(value) };
  }

  if (!hasTextValue(rawValue)) {
    return required ? { error: 'A credential value is required.', hasValue: false } : { hasValue: false };
  }

  return { hasValue: true, value: rawValue };
}

export function useVariableEditor() {
  return {
    CREDENTIAL_SUB_TYPE_HINTS,
    createEmptyVariableForm,
    createEmptyVariableSubFields,
    formatCredentialSubType,
    formatVariableScopeLabel,
    serializeVariableValue,
  };
}

export type {
  CredentialSubType,
  VariableFormState,
  VariableScope,
  VariableSubFields,
  VariableSummary,
  VariableType,
};