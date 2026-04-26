# Copilot Token Variable Setup

Most OAO agents can use the platform default `DEFAULT_LLM_API_KEY` or `GITHUB_TOKEN`, but production workspaces often need a shared credential that operators can rotate without redeploying the API. Store that token on the Variables page, then select it on the agents that should use it.

This tutorial uses placeholder values only. Never paste a real token into documentation, issue comments, screenshots, or workflow prompts.

## When To Use This

Use a workspace-scoped Copilot token credential when many agents should share the same model authentication. Use a user-scoped credential when each operator should bring their own token. Use an agent-scoped credential only when one agent needs isolated billing, permissions, or rotation.

## 1. Create The Credential Variable

Open `http://oao.local/default/variables`, then create a variable with these settings:

| Field | Value |
|-------|-------|
| Scope | `Workspace` for a shared token, or `User` for a personal token |
| Key | `COPILOT_TOKEN` |
| Type | `credential` |
| Credential sub-type | `GitHub Token` |
| Value | Your GitHub Copilot token or compatible model API key |
| Inject as environment variable | Off |
| Description | `Default Copilot token for workspace agents` |

![Copilot token credential variable detail](/screenshots/copilot-token-variable.png)

The variable detail page intentionally does not show the stored value after creation. To rotate the token, open the same variable, enter a new value, and save it.

## 2. Assign It To An Agent

Open the agent create or edit page and find **GitHub Copilot Token / LLM API Key**. Select `COPILOT_TOKEN (Workspace - GitHub Token)` or the equivalent user-scoped option.

Recommended agent setup:

| Field | Value |
|-------|-------|
| Source | Database or Git repository |
| Model auth | `COPILOT_TOKEN` |
| Built-in tools | Keep only the tools this agent needs |
| Scope | `Workspace` for shared automation agents |

The agent stores only the credential variable id. The encrypted token remains in the Variables store and is resolved at runtime.

## 3. Use It Everywhere Safely

Once the variable exists, every new workflow can reuse agents that already reference it. For integrations that need their own external credentials, create separate variables such as `JIRA_API_TOKEN`, `SLACK_WEBHOOK_URL`, or `GITHUB_TOKEN` instead of reusing the Copilot token.

Use this pattern for common setup:

| Credential | Scope | Consumer |
|------------|-------|----------|
| `COPILOT_TOKEN` | Workspace | Agent model authentication |
| `GITHUB_TOKEN` | Workspace or User | GitHub MCP, Git clone auth, GitHub REST calls |
| `JIRA_API_TOKEN` | Workspace | Jira polling triggers |
| `SLACK_WEBHOOK_URL` | Workspace | Notification workflows using `simple_http_request` |

## 4. Verify The Setup

1. Open the agent detail page.
2. Click **Edit**.
3. Confirm **GitHub Copilot Token / LLM API Key** shows `COPILOT_TOKEN`.
4. Start a conversation or manual workflow run with that agent.
5. If model authentication fails, rotate the variable value and retry without changing the agent or workflow.

## Rotation Checklist

1. Create the replacement token in GitHub or your model provider.
2. Open `COPILOT_TOKEN` on the Variables page.
3. Paste the replacement value into **New Value**.
4. Save the variable.
5. Run a small agent conversation or manual workflow to confirm the new token works.
6. Revoke the old token from the provider.
