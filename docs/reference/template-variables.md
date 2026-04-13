# Template Variables

Prompt templates in workflow steps use **Jinja2 templating** (powered by Nunjucks). These are the available variable namespaces.

## Variable Reference

| Variable | Type | Description |
|---|---|---|
| <span v-pre>`{{ precedent_output }}`</span> | `string` | Output from the previous step (empty for step 1 unless provided via webhook/manual run) |
| <span v-pre>`{{ properties.KEY }}`</span> | `string` | Property value from the 3-tier merged variable map |
| <span v-pre>`{{ credentials.KEY }}`</span> | `string` | Credential value from the 3-tier merged variable map |
| <span v-pre>`{{ env.KEY }}`</span> | `string` | Environment-injected variable value |
| <span v-pre>`{{ inputs.KEY }}`</span> | `string` | Webhook parameter / manual run input value |

## `precedent_output`

The output from the previous step in the workflow pipeline.

- **Step 1**: Empty string by default. If the workflow was triggered by webhook or manual run, the raw payload or first input value may appear here.
- **Step N** (N > 1): The `output` field from step N-1's execution record.

```markdown
Based on the previous analysis:
{{ precedent_output }}

Provide a summary.
```

## `properties.*`

Property variables resolved via the [3-tier override system](/concepts/variables):

1. **Workspace** variables (lowest priority)
2. **User** variables (medium priority)
3. **Agent** variables (highest priority)

```markdown
Analyze the market for {{ properties.MARKET_SYMBOL }}.
Current risk limit: {{ properties.MAX_RISK_PERCENT }}%
```

## `credentials.*`

Credential variables resolved via the same 3-tier system. All credentials are stored encrypted (AES-256-GCM) and decrypted only at render time in memory.

```markdown
Connect to the API using key: {{ credentials.API_KEY }}
```

## `env.*`

Variables marked with `injectAsEnvVariable: true`. These are also written to a `.env` file in the agent workspace directory at runtime.

```markdown
Database host: {{ env.DB_HOST }}
```

## `inputs.*`

Parameters passed via webhook trigger or manual run. These are defined in the webhook trigger's **parameter definitions** and validated at trigger time.

### Defining Parameters

When creating a webhook trigger, define parameters with:
- **Name** — the key used in templates
- **Required** — whether the parameter must be provided
- **Description** — optional help text shown in the Manual Run dialog

### Using Inputs

```markdown
Analyze the stock symbol {{ inputs.symbol }} over the {{ inputs.timeframe }} timeframe.

{% if inputs.include_news %}
Include recent news in the analysis.
{% endif %}
```

### How Inputs Are Populated

| Trigger Source | How `inputs` is populated |
|---|---|
| **Webhook** (`POST /api/webhooks/:path`) | Extracted from the request body, validated against parameter definitions |
| **Manual Run** (UI button) | User fills in input fields based on parameter definitions |
| **Cron / Datetime / Event** | Empty object (`{}`) |

## Jinja2 Features

Full Jinja2 syntax is supported — conditionals, loops, filters, and expressions:

```markdown
{% if inputs.symbol %}
Analyze {{ inputs.symbol | upper }}.
{% else %}
Analyze the default watchlist.
{% endif %}

{% for symbol in properties.WATCHLIST.split(',') %}
- Check {{ symbol | trim }}
{% endfor %}
```

## Backward Compatibility

Old-style placeholders are auto-converted:

| Old Syntax | Converted To |
|---|---|
| `<PRECEDENT_OUTPUT>` | <span v-pre>`{{ precedent_output }}`</span> |
| <span v-pre>`{{ Properties.KEY }}`</span> | <span v-pre>`{{ properties.KEY }}`</span> |
