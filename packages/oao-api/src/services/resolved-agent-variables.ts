import { eq } from 'drizzle-orm';
import { decrypt } from '@oao/shared';
import { db } from '../database/index.js';
import { agentVariables, userVariables, workspaceVariables } from '../database/schema.js';

export async function resolveAgentTemplateContextMaps(params: {
  agentId: string;
  userId: string;
  workspaceId: string;
}): Promise<{
  credentials: Map<string, string>;
  properties: Map<string, string>;
  envVariables: Map<string, string>;
}> {
  const [workspaceVars, userVars, agentVars] = await Promise.all([
    db.query.workspaceVariables.findMany({
      where: eq(workspaceVariables.workspaceId, params.workspaceId),
    }),
    db.query.userVariables.findMany({
      where: eq(userVariables.userId, params.userId),
    }),
    db.query.agentVariables.findMany({
      where: eq(agentVariables.agentId, params.agentId),
    }),
  ]);

  const workspaceCredentialMap = new Map(
    workspaceVars
      .filter((variable) => variable.variableType === 'credential')
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  );
  const workspacePropertyMap = new Map(
    workspaceVars
      .filter((variable) => variable.variableType === 'property')
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  );
  const workspaceEnvVarMap = new Map(
    workspaceVars
      .filter((variable) => variable.injectAsEnvVariable)
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  );

  const userCredentialMap = new Map([
    ...workspaceCredentialMap,
    ...userVars
      .filter((variable) => variable.variableType === 'credential')
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  ]);
  const userPropertyMap = new Map([
    ...workspacePropertyMap,
    ...userVars
      .filter((variable) => variable.variableType === 'property')
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  ]);
  const userEnvVarMap = new Map([
    ...workspaceEnvVarMap,
    ...userVars
      .filter((variable) => variable.injectAsEnvVariable)
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  ]);

  const credentials = new Map([
    ...userCredentialMap,
    ...agentVars
      .filter((variable) => variable.variableType === 'credential')
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  ]);
  const properties = new Map([
    ...userPropertyMap,
    ...agentVars
      .filter((variable) => variable.variableType === 'property')
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  ]);
  const envVariables = new Map([
    ...userEnvVarMap,
    ...agentVars
      .filter((variable) => variable.injectAsEnvVariable)
      .map((variable) => [variable.key, decrypt(variable.valueEncrypted)] as [string, string]),
  ]);

  return { credentials, properties, envVariables };
}