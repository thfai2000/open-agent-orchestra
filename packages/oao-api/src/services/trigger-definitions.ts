import { z } from 'zod';

export const creatableTriggerTypes = [
  'time_schedule',
  'exact_datetime',
  'webhook',
  'event',
  'jira_changes_notification',
  'jira_polling',
] as const;

export type CreatableTriggerType = typeof creatableTriggerTypes[number];

export const creatableTriggerTypeSchema = z.enum(creatableTriggerTypes);

export const jiraWebhookEventValues = [
  'jira:issue_created',
  'jira:issue_updated',
  'jira:issue_deleted',
] as const;

const jiraWebhookEventSchema = z.enum(jiraWebhookEventValues);

export interface TriggerCatalogEntry {
  type: CreatableTriggerType;
  label: string;
  shortLabel: string;
  category: 'Built-in' | 'Jira';
  description: string;
  notes?: string;
  supportsManualRun: boolean;
  defaultConfiguration: Record<string, unknown>;
}

const defaultJiraPollingFields = [
  'summary',
  'status',
  'assignee',
  'updated',
  'issuetype',
  'priority',
] as const;

const variableReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Variable references must start with a letter and contain only letters, numbers, or underscores');

const webhookParameterSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Parameter names must start with a letter or underscore and contain only letters, numbers, or underscores'),
    required: z.boolean().default(false),
    description: z.string().trim().max(300).default(''),
  })
  .transform((value) => ({
    name: value.name,
    required: value.required,
    description: value.description || '',
  }));

const triggerConditionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function normalizeWebhookPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }
  return trimmed;
}

function dedupeStrings(values: readonly string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

const httpsUrlSchema = z
  .string()
  .trim()
  .url('Must be a valid URL')
  .refine((value) => value.startsWith('https://'), 'Jira site URLs must use https://')
  .transform(stripTrailingSlash);

const timeScheduleConfigurationSchema = z.object({
  cron: z.string().trim().min(1).max(120),
});

const exactDatetimeConfigurationSchema = z.object({
  datetime: z.string().trim().min(1).max(100),
});

const webhookConfigurationSchema = z.object({
  path: z.string().trim().min(1).max(200).transform(normalizeWebhookPath),
  parameters: z.array(webhookParameterSchema).max(30).default([]),
});

const eventConfigurationSchema = z.object({
  eventName: z.string().trim().min(1).max(200),
  eventScope: z.enum(['workspace', 'user']).optional(),
  conditions: z.record(triggerConditionValueSchema).default({}),
});

const jiraOAuthCredentialsSchema = z
  .object({
    accessTokenVariableKey: variableReferenceSchema,
    refreshTokenVariableKey: variableReferenceSchema.optional(),
    clientIdVariableKey: variableReferenceSchema.optional(),
    clientSecretVariableKey: variableReferenceSchema.optional(),
    cloudId: z.string().trim().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    const refreshFields = [
      value.refreshTokenVariableKey,
      value.clientIdVariableKey,
      value.clientSecretVariableKey,
    ].filter(Boolean);
    if (refreshFields.length > 0 && refreshFields.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Refreshing Jira OAuth tokens requires refreshTokenVariableKey, clientIdVariableKey, and clientSecretVariableKey together',
      });
    }
  });

const jiraApiTokenCredentialsSchema = z.object({
  email: z.string().trim().email(),
  apiTokenVariableKey: variableReferenceSchema,
});

const jiraChangesNotificationConfigurationSchema = z
  .object({
    jiraSiteUrl: httpsUrlSchema,
    authMode: z.literal('oauth2').default('oauth2'),
    credentials: jiraOAuthCredentialsSchema,
    jql: z.string().trim().min(1).max(2000),
    events: z.array(jiraWebhookEventSchema).min(1).max(10).default(['jira:issue_created', 'jira:issue_updated']),
    fieldIdsFilter: z.array(z.string().trim().min(1).max(100)).max(25).default([]),
  })
  .transform((value) => ({
    jiraSiteUrl: value.jiraSiteUrl,
    authMode: value.authMode,
    credentials: value.credentials,
    jql: value.jql,
    events: dedupeStrings(value.events),
    fieldIdsFilter: dedupeStrings(value.fieldIdsFilter),
  }));

const jiraPollingConfigurationSchema = z
  .object({
    jiraSiteUrl: httpsUrlSchema,
    authMode: z.enum(['oauth2', 'api_token']).default('api_token'),
    credentials: z.object({
      accessTokenVariableKey: variableReferenceSchema.optional(),
      refreshTokenVariableKey: variableReferenceSchema.optional(),
      clientIdVariableKey: variableReferenceSchema.optional(),
      clientSecretVariableKey: variableReferenceSchema.optional(),
      cloudId: z.string().trim().uuid().optional(),
      email: z.string().trim().email().optional(),
      apiTokenVariableKey: variableReferenceSchema.optional(),
    }),
    jql: z.string().trim().min(1).max(2000),
    intervalMinutes: z.number().int().min(1).max(1440).default(15),
    maxResults: z.number().int().min(1).max(100).default(50),
    fields: z.array(z.string().trim().min(1).max(100)).max(25).default(defaultJiraPollingFields as unknown as string[]),
    initialLoadMode: z.enum(['from_now', 'include_current_matches']).default('from_now'),
    overlapMinutes: z.number().int().min(1).max(120).default(5),
  })
  .superRefine((value, ctx) => {
    if (value.authMode === 'oauth2') {
      const oauthValidation = jiraOAuthCredentialsSchema.safeParse(value.credentials);
      if (!oauthValidation.success) {
        for (const issue of oauthValidation.error.issues) {
          ctx.addIssue(issue);
        }
      }
    }

    if (value.authMode === 'api_token') {
      const apiTokenValidation = jiraApiTokenCredentialsSchema.safeParse(value.credentials);
      if (!apiTokenValidation.success) {
        for (const issue of apiTokenValidation.error.issues) {
          ctx.addIssue(issue);
        }
      }
    }
  })
  .transform((value) => ({
    jiraSiteUrl: value.jiraSiteUrl,
    authMode: value.authMode,
    credentials: value.credentials,
    jql: value.jql,
    intervalMinutes: value.intervalMinutes,
    maxResults: value.maxResults,
    fields: dedupeStrings([...value.fields, ...defaultJiraPollingFields]),
    initialLoadMode: value.initialLoadMode,
    overlapMinutes: value.overlapMinutes,
  }));

const triggerConfigurationSchemas: Record<CreatableTriggerType, z.ZodTypeAny> = {
  time_schedule: timeScheduleConfigurationSchema,
  exact_datetime: exactDatetimeConfigurationSchema,
  webhook: webhookConfigurationSchema,
  event: eventConfigurationSchema,
  jira_changes_notification: jiraChangesNotificationConfigurationSchema,
  jira_polling: jiraPollingConfigurationSchema,
};

const triggerCatalog: TriggerCatalogEntry[] = [
  {
    type: 'time_schedule',
    label: 'Schedule',
    shortLabel: 'Schedule',
    category: 'Built-in',
    description: 'Run the workflow on a recurring cron schedule.',
    supportsManualRun: true,
    defaultConfiguration: { cron: '' },
  },
  {
    type: 'exact_datetime',
    label: 'Exact Datetime',
    shortLabel: 'Exact Time',
    category: 'Built-in',
    description: 'Run the workflow once at a specific date and time.',
    supportsManualRun: true,
    defaultConfiguration: { datetime: '' },
  },
  {
    type: 'webhook',
    label: 'Webhook',
    shortLabel: 'Webhook',
    category: 'Built-in',
    description: 'Expose an HTTP endpoint and validate incoming parameters before execution.',
    supportsManualRun: true,
    defaultConfiguration: { path: '', parameters: [] },
  },
  {
    type: 'event',
    label: 'System Event',
    shortLabel: 'System Event',
    category: 'Built-in',
    description: 'Run the workflow when a platform event matches the selected event name and optional scope.',
    supportsManualRun: false,
    defaultConfiguration: { eventName: '', eventScope: undefined, conditions: {} },
  },
  {
    type: 'jira_changes_notification',
    label: 'Jira Changes Notification',
    shortLabel: 'Jira Notify',
    category: 'Jira',
    description: 'Register a Jira dynamic webhook filtered by JQL, then receive issue changes automatically.',
    notes: 'Requires a public OAO API URL plus Jira OAuth 2.0 credentials with webhook scopes. OAO refreshes webhook registrations before they expire.',
    supportsManualRun: false,
    defaultConfiguration: {
      jiraSiteUrl: '',
      authMode: 'oauth2',
      credentials: {
        accessTokenVariableKey: '',
        refreshTokenVariableKey: '',
        clientIdVariableKey: '',
        clientSecretVariableKey: '',
      },
      jql: '',
      events: ['jira:issue_created', 'jira:issue_updated'],
      fieldIdsFilter: [],
    },
  },
  {
    type: 'jira_polling',
    label: 'Jira Polling',
    shortLabel: 'Jira Poll',
    category: 'Jira',
    description: 'Poll Jira search results with a controlled overlap window so recent issue changes are captured without duplicates.',
    notes: 'Supports either Jira API tokens or OAuth 2.0. The polling engine tracks recent issue updates to absorb eventual consistency and controller restarts.',
    supportsManualRun: true,
    defaultConfiguration: {
      jiraSiteUrl: '',
      authMode: 'api_token',
      credentials: {
        email: '',
        apiTokenVariableKey: '',
      },
      jql: '',
      intervalMinutes: 15,
      maxResults: 50,
      fields: [...defaultJiraPollingFields],
      initialLoadMode: 'from_now',
      overlapMinutes: 5,
    },
  },
];

export function safeParseTriggerConfiguration(triggerType: CreatableTriggerType, configuration: unknown) {
  return triggerConfigurationSchemas[triggerType].safeParse(configuration ?? {});
}

export function getTriggerCatalog() {
  return triggerCatalog.map((entry) => ({
    ...entry,
    defaultConfiguration: JSON.parse(JSON.stringify(entry.defaultConfiguration)) as Record<string, unknown>,
  }));
}

export function getDefaultTriggerConfiguration(triggerType: CreatableTriggerType) {
  const catalogEntry = triggerCatalog.find((entry) => entry.type === triggerType);
  return catalogEntry
    ? JSON.parse(JSON.stringify(catalogEntry.defaultConfiguration)) as Record<string, unknown>
    : {};
}

export function getTriggerTypeLabel(triggerType?: string | null) {
  const catalogEntry = triggerCatalog.find((entry) => entry.type === triggerType);
  if (catalogEntry) {
    return catalogEntry.label;
  }

  if (triggerType === 'manual') {
    return 'Manual';
  }

  return triggerType || 'Unknown';
}

export function getTriggerShortLabel(triggerType?: string | null) {
  const catalogEntry = triggerCatalog.find((entry) => entry.type === triggerType);
  if (catalogEntry) {
    return catalogEntry.shortLabel;
  }

  if (triggerType === 'manual') {
    return 'Manual';
  }

  return triggerType || 'Unknown';
}

export function getWebhookPathFromConfiguration(triggerType: string, configuration: unknown) {
  if (triggerType !== 'webhook') {
    return null;
  }

  const record = configuration && typeof configuration === 'object'
    ? configuration as Record<string, unknown>
    : null;

  return typeof record?.path === 'string' && record.path.trim()
    ? normalizeWebhookPath(record.path)
    : null;
}

export type TriggerConfigurationParseResult = ReturnType<typeof safeParseTriggerConfiguration>;