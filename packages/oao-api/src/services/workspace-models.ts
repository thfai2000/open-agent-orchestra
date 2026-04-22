import { and, asc, eq } from 'drizzle-orm';
import { db } from '../database/index.js';
import { models } from '../database/schema.js';

export async function listWorkspaceActiveModels(workspaceId: string) {
  return db.query.models.findMany({
    where: and(eq(models.workspaceId, workspaceId), eq(models.isActive, true)),
    orderBy: asc(models.name),
  });
}

export async function resolveWorkspaceActiveModelName(params: {
  workspaceId: string;
  requestedModel?: string | null;
  envDefaultModel?: string | null;
}) {
  const activeModels = await listWorkspaceActiveModels(params.workspaceId);
  const requestedModel = params.requestedModel?.trim() || null;
  const envDefaultModel = params.envDefaultModel?.trim() || null;

  if (requestedModel) {
    if (activeModels.some((model) => model.name === requestedModel)) {
      return requestedModel;
    }

    throw new Error(`Model ${requestedModel} is not active in this workspace. Choose an active model from Admin > Models or clear the override.`);
  }

  if (envDefaultModel && activeModels.some((model) => model.name === envDefaultModel)) {
    return envDefaultModel;
  }

  if (activeModels.length > 0) {
    return activeModels[0].name;
  }

  throw new Error('No active models are configured for this workspace. Add one in Admin > Models before sending a conversation turn.');
}