import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  decimal,
  date,
  timestamp,
  pgEnum,
  uniqueIndex,
  jsonb,
  index,
  customType,
} from 'drizzle-orm/pg-core';

// ─── Enums ───────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['super_admin', 'workspace_admin', 'creator_user', 'view_user']);
export const resourceScopeEnum = pgEnum('resource_scope', ['user', 'workspace']);
export const eventScopeEnum = pgEnum('event_scope', ['workspace', 'user']);
export const agentStatusEnum = pgEnum('agent_status', ['active', 'paused', 'error']);
export const triggerTypeEnum = pgEnum('trigger_type', [
  'time_schedule',
  'exact_datetime',
  'webhook',
  'event',
  'manual',
]);
export const agentSourceTypeEnum = pgEnum('agent_source_type', ['github_repo', 'database']);
export const executionStatusEnum = pgEnum('execution_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export const stepStatusEnum = pgEnum('step_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
]);
export const reasoningEffortEnum = pgEnum('reasoning_effort', ['high', 'medium', 'low']);
export const variableTypeEnum = pgEnum('variable_type', ['property', 'credential']);

// ─── Workspaces ──────────────────────────────────────────────────────

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 50 }).notNull().unique(), // URL segment: /slug/...
  description: text('description'),
  isDefault: boolean('is_default').notNull().default(false), // Default Workspace cannot be deleted
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Users (independent — Agent Platform owns its own identity) ──────

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  role: userRoleEnum('role').notNull().default('creator_user'),
  workspaceId: uuid('workspace_id').references(() => workspaces.id), // null only for super_admin before joining
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Agents ──────────────────────────────────────────────────────────

export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(), // from JWT, no FK to trading_db
  scope: resourceScopeEnum('scope').notNull().default('user'), // 'user' or 'workspace'
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  sourceType: agentSourceTypeEnum('source_type').notNull().default('github_repo'),
  gitRepoUrl: varchar('git_repo_url', { length: 500 }), // required for github_repo source
  gitBranch: varchar('git_branch', { length: 100 }).notNull().default('main'),
  agentFilePath: varchar('agent_file_path', { length: 300 }), // required for github_repo source
  skillsPaths: varchar('skills_paths', { length: 300 }).array().notNull().default([]),
  skillsDirectory: varchar('skills_directory', { length: 300 }), // e.g. "skills/" — loads all .md files from this directory (github_repo only)
  githubTokenEncrypted: text('github_token_encrypted'),
  builtinToolsEnabled: jsonb('builtin_tools_enabled').notNull().default([
    'schedule_next_workflow_execution', 'manage_webhook_trigger', 'record_decision',
    'memory_store', 'memory_retrieve',
    'edit_workflow', 'read_variables', 'edit_variables',
  ]), // array of enabled built-in tool names
  status: agentStatusEnum('status').notNull().default('active'),
  lastSessionAt: timestamp('last_session_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Agent Files (DB-stored agent instruction/skill files) ───────────

export const agentFiles = pgTable(
  'agent_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    filePath: varchar('file_path', { length: 500 }).notNull(), // e.g. "agent.md", "skills/trading.md"
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentFilePathIdx: uniqueIndex('agent_files_agent_path_idx').on(table.agentId, table.filePath),
  }),
);

// ─── Workflows ───────────────────────────────────────────────────────

export const workflows = pgTable('workflows', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(), // owner — workflows belong to a user, not an agent
  scope: resourceScopeEnum('scope').notNull().default('user'), // 'user' or 'workspace'
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  maxConcurrentExecutions: integer('max_concurrent_executions').notNull().default(1),
  version: integer('version').notNull().default(1),
  defaultAgentId: uuid('default_agent_id').references(() => agents.id), // workflow-level default agent
  defaultModel: varchar('default_model', { length: 100 }), // workflow-level default model
  defaultReasoningEffort: reasoningEffortEnum('default_reasoning_effort'), // workflow-level default
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Workflow Steps ──────────────────────────────────────────────────

export const workflowSteps = pgTable(
  'workflow_steps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    promptTemplate: text('prompt_template').notNull(),
    stepOrder: integer('step_order').notNull(),
    agentId: uuid('agent_id')
      .references(() => agents.id), // optional — falls back to workflow defaultAgentId
    model: varchar('model', { length: 100 }), // Copilot model override (e.g. 'claude-sonnet-4-5')
    reasoningEffort: reasoningEffortEnum('reasoning_effort'), // high/medium/low
    timeoutSeconds: integer('timeout_seconds').notNull().default(300),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workflowOrderIdx: uniqueIndex('workflow_steps_workflow_order_idx').on(
      table.workflowId,
      table.stepOrder,
    ),
  }),
);

// ─── Triggers ────────────────────────────────────────────────────────

export const triggers = pgTable('triggers', {
  id: uuid('id').defaultRandom().primaryKey(),
  workflowId: uuid('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  triggerType: triggerTypeEnum('trigger_type').notNull(),
  configuration: jsonb('configuration').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Workflow Executions ─────────────────────────────────────────────

export const workflowExecutions = pgTable('workflow_executions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workflowId: uuid('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  triggerId: uuid('trigger_id').references(() => triggers.id),
  triggerMetadata: jsonb('trigger_metadata'),
  workflowVersion: integer('workflow_version'), // snapshot of workflow.version at trigger time
  workflowSnapshot: jsonb('workflow_snapshot'), // full snapshot of workflow + steps config
  status: executionStatusEnum('status').notNull().default('pending'),
  currentStep: integer('current_step'),
  totalSteps: integer('total_steps'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Step Executions ─────────────────────────────────────────────────

export const stepExecutions = pgTable('step_executions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workflowExecutionId: uuid('workflow_execution_id')
    .notNull()
    .references(() => workflowExecutions.id, { onDelete: 'cascade' }),
  workflowStepId: uuid('workflow_step_id')
    .notNull()
    .references(() => workflowSteps.id),
  stepOrder: integer('step_order').notNull(),
  resolvedPrompt: text('resolved_prompt'),
  output: text('output'),
  reasoningTrace: jsonb('reasoning_trace'),
  status: stepStatusEnum('status').notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
});

// ─── Agent Variables (key-value store, agent-level) ──────────────────

export const agentVariables = pgTable(
  'agent_variables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 100 }).notNull(),
    valueEncrypted: text('value_encrypted').notNull(),
    variableType: variableTypeEnum('variable_type').notNull().default('credential'),
    injectAsEnvVariable: boolean('inject_as_env_variable').notNull().default(false),
    description: varchar('description', { length: 300 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentKeyIdx: uniqueIndex('agent_variables_agent_key_idx').on(table.agentId, table.key),
  }),
);

// ─── User Variables (key-value store, user-level) ───────────────────

export const userVariables = pgTable(
  'user_variables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 100 }).notNull(),
    valueEncrypted: text('value_encrypted').notNull(),
    variableType: variableTypeEnum('variable_type').notNull().default('credential'),
    injectAsEnvVariable: boolean('inject_as_env_variable').notNull().default(false),
    description: varchar('description', { length: 300 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userKeyIdx: uniqueIndex('user_variables_user_key_idx').on(table.userId, table.key),
  }),
);

// ─── Agent Quota Usage ───────────────────────────────────────────────

export const agentQuotaUsage = pgTable(
  'agent_quota_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    promptTokensUsed: integer('prompt_tokens_used').notNull().default(0),
    completionTokensUsed: integer('completion_tokens_used').notNull().default(0),
    sessionCount: integer('session_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentDateIdx: uniqueIndex('agent_quota_agent_date_idx').on(table.agentId, table.date),
  }),
);

// ─── Webhook Registrations ───────────────────────────────────────────

export const webhookRegistrations = pgTable('webhook_registrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  triggerId: uuid('trigger_id').references(() => triggers.id),
  endpointPath: varchar('endpoint_path', { length: 200 }).notNull(),
  hmacSecretEncrypted: text('hmac_secret_encrypted').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  requestCount: integer('request_count').notNull().default(0),
  lastReceivedAt: timestamp('last_received_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── MCP Server Configurations (per-agent) ──────────────────────────

export const mcpServerConfigs = pgTable(
  'mcp_server_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 500 }),
    command: varchar('command', { length: 200 }).notNull(), // e.g. "node", "npx", "python"
    args: jsonb('args').notNull().default([]), // e.g. ["--import", "tsx", "server.ts"]
    envMapping: jsonb('env_mapping').notNull().default({}), // credential key → env var name mapping
    isEnabled: boolean('is_enabled').notNull().default(true),
    writeTools: jsonb('write_tools').notNull().default([]), // tool names that require permission
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mcpServerAgentIdx: index('mcp_server_configs_agent_idx').on(table.agentId),
  }),
);

// ─── Workspace Variables (key-value store, workspace-level) ─────────

export const workspaceVariables = pgTable(
  'workspace_variables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 100 }).notNull(),
    valueEncrypted: text('value_encrypted').notNull(),
    variableType: variableTypeEnum('variable_type').notNull().default('credential'),
    injectAsEnvVariable: boolean('inject_as_env_variable').notNull().default(false),
    description: varchar('description', { length: 300 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceKeyIdx: uniqueIndex('workspace_variables_ws_key_idx').on(table.workspaceId, table.key),
  }),
);

// ─── Plugins (workspace-managed registry) ────────────────────────────

export const plugins = pgTable('plugins', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  gitRepoUrl: varchar('git_repo_url', { length: 500 }).notNull(),
  gitBranch: varchar('git_branch', { length: 100 }).notNull().default('main'),
  githubTokenEncrypted: text('github_token_encrypted'),
  manifestCache: jsonb('manifest_cache'), // cached plugin.json contents
  isAllowed: boolean('is_allowed').notNull().default(false),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Agent Plugins (per-agent toggle) ────────────────────────────────

export const agentPlugins = pgTable(
  'agent_plugins',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    pluginId: uuid('plugin_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentPluginIdx: uniqueIndex('agent_plugins_agent_plugin_idx').on(table.agentId, table.pluginId),
  }),
);

// ─── Agent Decisions (audit trail) ───────────────────────────────────

export const agentDecisions = pgTable('agent_decisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  executionId: uuid('execution_id').references(() => workflowExecutions.id),
  category: varchar('category', { length: 50 }).notNull(), // e.g. "trade", "analysis", "action"
  action: varchar('action', { length: 50 }).notNull(), // e.g. "buy", "sell", "approve", "reject"
  summary: text('summary'), // brief human-readable summary
  decision: jsonb('decision').notNull(), // full reasoning: signals, confidence, risk, etc.
  outcome: varchar('outcome', { length: 20 }), // executed, rejected, skipped
  referenceId: varchar('reference_id', { length: 100 }), // external reference ID
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── pgvector custom type ────────────────────────────────────────────

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // Postgres returns vector as "[0.1,0.2,...]"
    return value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(Number);
  },
});

// ─── Memory Type Enum ────────────────────────────────────────────────

export const memoryTypeEnum = pgEnum('memory_type', [
  'observation',
  'insight',
  'strategy',
  'lesson_learned',
  'general',
]);

// ─── Agent Memories (Vector Memory with pgvector) ────────────────────

export const agentMemories = pgTable(
  'agent_memories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    memoryType: memoryTypeEnum('memory_type').notNull().default('general'),
    tags: varchar('tags', { length: 50 }).array().notNull().default([]),
    metadata: jsonb('metadata'), // flexible extra data (symbols, dates, signals, etc.)
    embedding: vector('embedding'), // 1536-dim vector for semantic search
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentMemoriesAgentIdx: index('agent_memories_agent_idx').on(table.agentId),
    agentMemoriesTypeIdx: index('agent_memories_type_idx').on(table.agentId, table.memoryType),
  }),
);

// ─── Models (workspace-managed model registry with credit costs) ─────

export const models = pgTable('models', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull().default('github'),
  description: text('description'),
  creditCost: decimal('credit_cost', { precision: 10, scale: 2 }).notNull().default('1.00'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Workspace Quota Settings (per-workspace) ──────────────────────

export const workspaceQuotaSettings = pgTable('workspace_quota_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .unique(),
  dailyCreditLimit: decimal('daily_credit_limit', { precision: 10, scale: 2 }),
  monthlyCreditLimit: decimal('monthly_credit_limit', { precision: 10, scale: 2 }),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── User Quota Settings (self-managed per user) ─────────────────────

export const userQuotaSettings = pgTable('user_quota_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  dailyCreditLimit: decimal('daily_credit_limit', { precision: 10, scale: 2 }),
  monthlyCreditLimit: decimal('monthly_credit_limit', { precision: 10, scale: 2 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Credit Usage (per-user, per-model, per-date tracking) ──────────

export const creditUsage = pgTable(
  'credit_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    modelName: varchar('model_name', { length: 100 }).notNull(),
    creditsConsumed: decimal('credits_consumed', { precision: 10, scale: 2 }).notNull().default('0'),
    sessionCount: integer('session_count').notNull().default(0),
    date: date('date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    creditUsageUserModelDateIdx: uniqueIndex('credit_usage_user_model_date_idx').on(
      table.userId,
      table.modelName,
      table.date,
    ),
    creditUsageUserDateIdx: index('credit_usage_user_date_idx').on(table.userId, table.date),
  }),
);

// ─── System Events (audit + event triggers) ─────────────────────────

export const systemEvents = pgTable(
  'system_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventScope: eventScopeEnum('event_scope').notNull(), // 'workspace' or 'user'
    scopeId: uuid('scope_id').notNull(), // workspace_id or user_id depending on scope
    eventName: varchar('event_name', { length: 100 }).notNull(), // predefined event name
    eventData: jsonb('event_data').notNull().default({}), // flexible payload
    actorId: uuid('actor_id'), // user who triggered the action (null for system events)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    systemEventsScopeIdx: index('system_events_scope_idx').on(table.eventScope, table.scopeId),
    systemEventsNameIdx: index('system_events_name_idx').on(table.eventName),
    systemEventsCreatedIdx: index('system_events_created_idx').on(table.createdAt),
  }),
);
