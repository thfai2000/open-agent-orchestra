# Variable System

## Overview

Variables provide encrypted key-value storage at three scopes. They are used to inject credentials, properties, and environment variables into Copilot sessions during workflow execution.

## Scopes & Priority

When a workflow step executes, variables are merged with the following priority (higher wins for the same key):

| Priority | Scope | Description |
|---|---|---|
| 1 (highest) | **Agent** | Scoped to a specific agent via `agentId` |
| 2 | **User** | Scoped to the workflow owner's user account |
| 3 (lowest) | **Workspace** | Shared across all users in the workspace |

## Variable Types

### Credential
Stored encrypted (AES-256-GCM). Injected into the Copilot session's credential map. Used for API keys, tokens, and secrets that MCP servers or tools need.

### Property
Stored encrypted. Can be referenced in prompt templates using the token syntax:
```
{{ Properties.KEY_NAME }}
```
The engine replaces these tokens with the decrypted value before sending to Copilot.

## Env Variable Injection

Any variable (credential or property) can be flagged with `injectAsEnvVariable: true`. When enabled, the variable is written to a `.env` file in the agent's temporary workspace directory before execution. This is useful for tools or scripts that read environment variables.

## Key Format

All keys must match: `^[A-Z_][A-Z0-9_]*$` (UPPER_SNAKE_CASE).

## Access Control

| Scope | Who can manage |
|---|---|
| Agent variables | `creator_user`, `workspace_admin`, `super_admin` |
| User variables | `creator_user`, `workspace_admin`, `super_admin` |
| Workspace variables | `workspace_admin`, `super_admin` only |
| `view_user` | Cannot create/modify/delete any variables |

## API Examples

### Create a workspace variable
```json
POST /api/variables
{
  "scope": "workspace",
  "key": "DEFAULT_API_URL",
  "value": "https://api.example.com",
  "variableType": "property",
  "description": "Shared API endpoint for all agents"
}
```

### Create an agent variable (overrides workspace/user)
```json
POST /api/variables
{
  "scope": "agent",
  "agentId": "uuid-of-agent",
  "key": "API_KEY",
  "value": "sk-...",
  "variableType": "credential",
  "injectAsEnvVariable": true
}
```
