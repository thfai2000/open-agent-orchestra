<template>
  <div class="flex flex-col gap-4">
    <template v-if="trigger.triggerType === 'time_schedule'">
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">Cron Expression</label>
        <InputText v-model="configuration.cron" :disabled="disabled" placeholder="0 9 * * 1-5" />
        <small class="text-surface-400">Examples: <span class="font-mono">*/30 * * * *</span>, <span class="font-mono">0 8 * * 1-5</span></small>
      </div>
    </template>

    <template v-else-if="trigger.triggerType === 'exact_datetime'">
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">Date &amp; Time</label>
        <InputText v-model="configuration.datetime" :disabled="disabled" type="datetime-local" />
      </div>
    </template>

    <template v-else-if="trigger.triggerType === 'webhook'">
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Webhook Path</label>
          <InputText v-model="configuration.path" :disabled="disabled" placeholder="/my-trigger" />
          <small class="text-surface-400">This path must be unique across workflow webhook triggers.</small>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium">Parameters</label>
          <Button label="Add Parameter" icon="pi pi-plus" text size="small" :disabled="disabled" @click="addWebhookParameter" />
        </div>
        <div v-if="webhookParameters.length === 0" class="rounded-lg border border-dashed border-surface-300 px-4 py-3 text-sm text-surface-400">
          No parameters defined. Manual Run will accept arbitrary inputs when this list is empty.
        </div>
        <div v-for="(parameter, index) in webhookParameters" :key="index" class="rounded-lg border border-surface-200 p-4">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_1.6fr_auto_auto] md:items-center">
            <InputText v-model="parameter.name" :disabled="disabled" placeholder="symbol" />
            <InputText v-model="parameter.description" :disabled="disabled" placeholder="Short help text shown in Manual Run" />
            <label class="flex items-center gap-2 text-sm text-surface-600">
              <Checkbox v-model="parameter.required" :binary="true" :disabled="disabled" />
              Required
            </label>
            <Button icon="pi pi-trash" text rounded severity="danger" :disabled="disabled" @click="removeWebhookParameter(index)" />
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="trigger.triggerType === 'event'">
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Event Name</label>
          <InputText v-model="configuration.eventName" :disabled="disabled" placeholder="execution.completed" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Event Scope</label>
          <Select
            v-model="configuration.eventScope"
            :disabled="disabled"
            :options="eventScopeOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Any scope"
            showClear
          />
        </div>
      </div>
      <small class="text-surface-400">Use the system event name exactly as it appears in the Events reference.</small>
    </template>

    <template v-else-if="trigger.triggerType === 'jira_changes_notification'">
      <Message severity="info" :closable="false">
        Jira change notifications require a public OAO API URL plus Jira OAuth 2.0 credentials with webhook scopes.
      </Message>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Jira Site URL</label>
          <InputText v-model="configuration.jiraSiteUrl" :disabled="disabled" placeholder="https://your-domain.atlassian.net" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">OAuth Access Token Variable</label>
          <Select
            v-model="jiraCredentials.accessTokenVariableKey"
            :disabled="disabled"
            :options="getCredentialOptions(jiraCredentials.accessTokenVariableKey)"
            optionLabel="optionLabel"
            optionValue="key"
            filter
            showClear
            placeholder="Select a credential variable"
          />
        </div>
      </div>
      <small class="text-surface-400">Workflow triggers can resolve workspace and user credential variables only.</small>

      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">JQL Filter</label>
        <Textarea v-model="configuration.jql" :disabled="disabled" rows="4" placeholder="project = OAO AND statusCategory != Done" />
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Refresh Token Variable</label>
          <Select
            v-model="jiraCredentials.refreshTokenVariableKey"
            :disabled="disabled"
            :options="getCredentialOptions(jiraCredentials.refreshTokenVariableKey)"
            optionLabel="optionLabel"
            optionValue="key"
            filter
            showClear
            placeholder="Optional, enables token refresh"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Client ID Variable</label>
          <Select
            v-model="jiraCredentials.clientIdVariableKey"
            :disabled="disabled"
            :options="getCredentialOptions(jiraCredentials.clientIdVariableKey)"
            optionLabel="optionLabel"
            optionValue="key"
            filter
            showClear
            placeholder="Required when using refresh token"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Client Secret Variable</label>
          <Select
            v-model="jiraCredentials.clientSecretVariableKey"
            :disabled="disabled"
            :options="getCredentialOptions(jiraCredentials.clientSecretVariableKey)"
            optionLabel="optionLabel"
            optionValue="key"
            filter
            showClear
            placeholder="Required when using refresh token"
          />
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Cloud ID Override</label>
          <InputText v-model="jiraCredentials.cloudId" :disabled="disabled" placeholder="Optional UUID if auto-discovery is not possible" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Field Filter</label>
          <InputText
            :disabled="disabled"
            :modelValue="arrayToCsv('fieldIdsFilter')"
            placeholder="summary, customfield_10029"
            @update:modelValue="updateCsvArray('fieldIdsFilter', $event)"
          />
          <small class="text-surface-400">Optional comma-separated field IDs to narrow update notifications.</small>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">Jira Events</label>
        <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
          <label v-for="eventName in jiraEventOptions" :key="eventName.value" class="flex items-center gap-2 rounded-lg border border-surface-200 px-3 py-2 text-sm text-surface-700">
            <Checkbox
              :modelValue="selectedJiraEvents.includes(eventName.value)"
              :binary="true"
              :disabled="disabled"
              @update:modelValue="toggleArrayValue('events', eventName.value, Boolean($event))"
            />
            {{ eventName.label }}
          </label>
        </div>
      </div>
    </template>

    <template v-else-if="trigger.triggerType === 'jira_polling'">
      <Message severity="info" :closable="false">
        Jira polling uses an overlap window and a tracked issue map to reduce duplicates when Jira search results are eventually consistent.
      </Message>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Jira Site URL</label>
          <InputText v-model="configuration.jiraSiteUrl" :disabled="disabled" placeholder="https://your-domain.atlassian.net" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Authentication</label>
          <Select
            v-model="configuration.authMode"
            :disabled="disabled"
            :options="jiraAuthModeOptions"
            optionLabel="label"
            optionValue="value"
            @update:modelValue="onJiraPollingAuthModeChange"
          />
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">JQL Filter</label>
        <Textarea v-model="configuration.jql" :disabled="disabled" rows="4" placeholder="project = OAO AND statusCategory != Done" />
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Interval (minutes)</label>
          <InputNumber v-model="configuration.intervalMinutes" :disabled="disabled" :min="1" :max="1440" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Max Results</label>
          <InputNumber v-model="configuration.maxResults" :disabled="disabled" :min="1" :max="100" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Overlap (minutes)</label>
          <InputNumber v-model="configuration.overlapMinutes" :disabled="disabled" :min="1" :max="120" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">First Poll Behavior</label>
          <Select
            v-model="configuration.initialLoadMode"
            :disabled="disabled"
            :options="initialLoadModeOptions"
            optionLabel="label"
            optionValue="value"
          />
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">Fields</label>
        <InputText
          :disabled="disabled"
          :modelValue="arrayToCsv('fields')"
          placeholder="summary, status, assignee, updated"
          @update:modelValue="updateCsvArray('fields', $event)"
        />
        <small class="text-surface-400">Comma-separated Jira fields to include in each workflow input payload.</small>
      </div>

      <div v-if="configuration.authMode === 'api_token'" class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Jira Account Email</label>
          <InputText v-model="jiraCredentials.email" :disabled="disabled" placeholder="name@example.com" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">API Token Variable</label>
          <Select
            v-model="jiraCredentials.apiTokenVariableKey"
            :disabled="disabled"
            :options="getCredentialOptions(jiraCredentials.apiTokenVariableKey)"
            optionLabel="optionLabel"
            optionValue="key"
            filter
            showClear
            placeholder="Select a credential variable"
          />
        </div>
      </div>

      <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">OAuth Access Token Variable</label>
          <Select
            v-model="jiraCredentials.accessTokenVariableKey"
            :disabled="disabled"
            :options="getCredentialOptions(jiraCredentials.accessTokenVariableKey)"
            optionLabel="optionLabel"
            optionValue="key"
            filter
            showClear
            placeholder="Select a credential variable"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Refresh Token Variable</label>
          <Select
            v-model="jiraCredentials.refreshTokenVariableKey"
            :disabled="disabled"
            :options="getCredentialOptions(jiraCredentials.refreshTokenVariableKey)"
            optionLabel="optionLabel"
            optionValue="key"
            filter
            showClear
            placeholder="Optional, enables token refresh"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Cloud ID Override</label>
          <InputText v-model="jiraCredentials.cloudId" :disabled="disabled" placeholder="Optional UUID" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Client ID Variable</label>
          <Select
            v-model="jiraCredentials.clientIdVariableKey"
            :disabled="disabled"
            :options="getCredentialOptions(jiraCredentials.clientIdVariableKey)"
            optionLabel="optionLabel"
            optionValue="key"
            filter
            showClear
            placeholder="Required when using refresh token"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Client Secret Variable</label>
          <Select
            v-model="jiraCredentials.clientSecretVariableKey"
            :disabled="disabled"
            :options="getCredentialOptions(jiraCredentials.clientSecretVariableKey)"
            optionLabel="optionLabel"
            optionValue="key"
            filter
            showClear
            placeholder="Required when using refresh token"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
interface CredentialOption {
  key: string;
  optionLabel: string;
}

const props = withDefaults(defineProps<{
  trigger: Record<string, any>;
  disabled?: boolean;
  credentialOptions?: CredentialOption[];
}>(), {
  credentialOptions: () => [],
});

const disabled = computed(() => Boolean(props.disabled));

const jiraEventOptions = [
  { label: 'Issue Created', value: 'jira:issue_created' },
  { label: 'Issue Updated', value: 'jira:issue_updated' },
  { label: 'Issue Deleted', value: 'jira:issue_deleted' },
];

const eventScopeOptions = [
  { label: 'Workspace', value: 'workspace' },
  { label: 'User', value: 'user' },
];

const jiraAuthModeOptions = [
  { label: 'API Token', value: 'api_token' },
  { label: 'OAuth 2.0', value: 'oauth2' },
];

const initialLoadModeOptions = [
  { label: 'Start From Now', value: 'from_now' },
  { label: 'Include Current Matches', value: 'include_current_matches' },
];

const configuration = computed(() => {
  if (!props.trigger.configuration || typeof props.trigger.configuration !== 'object') {
    props.trigger.configuration = {};
  }
  return props.trigger.configuration as Record<string, any>;
});

const jiraCredentials = computed(() => {
  if (!configuration.value.credentials || typeof configuration.value.credentials !== 'object') {
    configuration.value.credentials = {};
  }
  return configuration.value.credentials as Record<string, any>;
});

const webhookParameters = computed(() => {
  if (!Array.isArray(configuration.value.parameters)) {
    configuration.value.parameters = [];
  }
  return configuration.value.parameters as Array<Record<string, any>>;
});

const selectedJiraEvents = computed(() => {
  if (!Array.isArray(configuration.value.events)) {
    configuration.value.events = ['jira:issue_created', 'jira:issue_updated'];
  }
  return configuration.value.events as string[];
});

function getCredentialOptions(selectedKey?: string | null) {
  if (!selectedKey || props.credentialOptions.some((option) => option.key === selectedKey)) {
    return props.credentialOptions;
  }

  return [
    { key: selectedKey, optionLabel: `${selectedKey} (current value)` },
    ...props.credentialOptions,
  ];
}

function addWebhookParameter() {
  webhookParameters.value.push({ name: '', required: false, description: '' });
}

function removeWebhookParameter(index: number) {
  webhookParameters.value.splice(index, 1);
}

function updateCsvArray(key: string, value: string) {
  configuration.value[key] = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function arrayToCsv(key: string) {
  return Array.isArray(configuration.value[key])
    ? configuration.value[key].join(', ')
    : '';
}

function toggleArrayValue(key: string, value: string, checked: boolean) {
  const currentValues = Array.isArray(configuration.value[key]) ? [...configuration.value[key]] : [];
  const nextValues = checked
    ? Array.from(new Set([...currentValues, value]))
    : currentValues.filter((entry: string) => entry !== value);
  configuration.value[key] = nextValues;
}

function onJiraPollingAuthModeChange(value: string) {
  configuration.value.authMode = value;
  if (value === 'api_token') {
    if (!jiraCredentials.value.email) jiraCredentials.value.email = '';
    if (!jiraCredentials.value.apiTokenVariableKey) jiraCredentials.value.apiTokenVariableKey = '';
  } else {
    if (!jiraCredentials.value.accessTokenVariableKey) jiraCredentials.value.accessTokenVariableKey = '';
  }
}
</script>