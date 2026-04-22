import * as z from 'zod/v4';
import { creatableTriggerTypes } from '../services/trigger-definitions.js';

const workflowReasoningEfforts = ['high', 'medium', 'low'] as const;
const workerRuntimeValues = ['static', 'ephemeral'] as const;
const variableScopeValues = ['agent', 'user', 'workspace'] as const;
const variableTypeValues = ['property', 'credential'] as const;
const credentialSubTypeValues = [
  'secret_text',
  'github_token',
  'github_app',
  'user_account',
  'private_key',
  'certificate',
] as const;

export const platformListAgentsInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
});

export const platformListWorkflowsInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
  labels: z.array(z.string()).optional(),
});

export const platformGetWorkflowInputSchema = z.object({
  id: z.string().uuid(),
});

export const platformWorkflowStepSchema = z.object({
  name: z.string().min(1).max(200),
  promptTemplate: z.string().min(1),
  stepOrder: z.number().int().min(1),
  agentId: z.string().uuid().optional(),
  model: z.string().max(100).optional(),
  reasoningEffort: z.enum(workflowReasoningEfforts).optional(),
  workerRuntime: z.enum(workerRuntimeValues).optional(),
  timeoutSeconds: z.number().int().min(30).max(3600).default(300),
});

export const platformWorkflowTriggerSchema = z.object({
  triggerType: z.enum(creatableTriggerTypes),
  configuration: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().optional(),
});

export const platformCreateWorkflowBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  labels: z.array(z.string().min(1).max(50)).max(10).default([]),
  defaultAgentId: z.string().uuid().optional(),
  defaultModel: z.string().max(100).optional(),
  defaultReasoningEffort: z.enum(workflowReasoningEfforts).optional(),
  workerRuntime: z.enum(workerRuntimeValues).default('static'),
  stepAllocationTimeoutSeconds: z.number().int().min(15).max(3600).default(300),
  scope: z.enum(['user', 'workspace']).default('user'),
  steps: z.array(platformWorkflowStepSchema).min(1).max(20),
  triggers: z.array(platformWorkflowTriggerSchema).optional(),
});

export const platformUpdateWorkflowBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  labels: z.array(z.string().min(1).max(50)).max(10).optional(),
  isActive: z.boolean().optional(),
  defaultAgentId: z.string().uuid().nullable().optional(),
  defaultModel: z.string().max(100).nullable().optional(),
  defaultReasoningEffort: z.enum(workflowReasoningEfforts).nullable().optional(),
  workerRuntime: z.enum(workerRuntimeValues).optional(),
  stepAllocationTimeoutSeconds: z.number().int().min(15).max(3600).optional(),
});

export const platformReplaceWorkflowStepsBodySchema = z.object({
  steps: z.array(platformWorkflowStepSchema).min(1).max(20),
});

export const platformUpdateWorkflowInputSchema = platformUpdateWorkflowBodySchema.extend({
  id: z.string().uuid(),
});

export const platformReplaceWorkflowStepsInputSchema = platformReplaceWorkflowStepsBodySchema.extend({
  id: z.string().uuid(),
});

export const platformRunWorkflowInputSchema = z.object({
  id: z.string().uuid(),
  inputs: z.record(z.string(), z.unknown()).default({}),
});

export const platformListVariablesInputSchema = z.object({
  scope: z.enum(variableScopeValues).default('agent'),
  agentId: z.string().uuid().optional(),
});

export const platformGetVariableInputSchema = z.object({
  id: z.string().uuid(),
  scope: z.enum(variableScopeValues).optional(),
});

export const platformCreateVariableBodySchema = z.object({
  agentId: z.string().uuid().optional(),
  scope: z.enum(variableScopeValues).default('agent'),
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Z_][A-Z0-9_]*$/, 'Key must be uppercase with underscores'),
  value: z.string().min(1).max(50000),
  variableType: z.enum(variableTypeValues).default('credential'),
  credentialSubType: z.enum(credentialSubTypeValues).default('secret_text'),
  injectAsEnvVariable: z.boolean().default(false),
  description: z.string().max(300).optional(),
});

export const platformUpdateVariableBodySchema = z.object({
  value: z.string().min(1).max(50000).optional(),
  variableType: z.enum(variableTypeValues).optional(),
  credentialSubType: z.enum(credentialSubTypeValues).optional(),
  injectAsEnvVariable: z.boolean().optional(),
  description: z.string().max(300).optional(),
  scope: z.enum(variableScopeValues).default('agent'),
});

export const platformUpdateVariableInputSchema = platformUpdateVariableBodySchema.extend({
  id: z.string().uuid(),
});

export const platformDeleteVariableInputSchema = z.object({
  id: z.string().uuid(),
  scope: z.enum(variableScopeValues).default('agent'),
});