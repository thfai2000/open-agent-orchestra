# Conversations

Conversations let users chat directly with an agent outside the workflow engine.

## What a Conversation Is

- A conversation is a persisted thread between one user and one selected agent.
- Each conversation belongs to a workspace and is recorded in the database.
- The conversation history is stored as ordered `user` and `assistant` messages, so users can leave and resume later.

## Starting a Conversation

- Open **Conversations** from the workspace navigation and create a new thread.
- Choose one active agent from the available agent list.
- Optionally provide a title; otherwise OAO generates one automatically.
- Agent detail pages include a **Start Conversation** shortcut that preselects that agent.

## Interactive Behavior

- Messages are stored immediately when the user sends them.
- The assistant response is created as a pending message and then streamed into the UI as deltas arrive.
- Conversation pages subscribe to server-sent events (SSE), so the transcript updates while the agent is still responding.
- Only one assistant turn can run at a time for a conversation.

## Agent Context

- Conversations use the selected agent's markdown instructions, skills, built-in tools, MCP servers, and scoped variables.
- Workflow-specific tools such as workflow editing and self-scheduling are intentionally excluded from conversation sessions because there is no workflow execution context.
- The same per-agent session lock used by workflow steps also applies to conversations, so an agent cannot run conflicting Copilot sessions at the same time.

## Persistence Model

- `conversations` stores the thread header, selected agent, and timestamps.
- `conversation_messages` stores each turn, its status, any assistant error, and assistant metadata such as model/tool trace.
- If an agent is deleted later, the existing conversation remains readable, but new turns are disabled.

## Typical Use Cases

- Ask an agent ad hoc questions before formalizing the task into a workflow.
- Validate an agent's prompt design interactively from its detail page.
- Keep a lightweight working thread with an agent while still using workflows for repeatable automation.