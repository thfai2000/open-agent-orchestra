# UI Pages

## Page Map

| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/<workspace>/` | Overview: agent count, active workflows, recent executions |
| Login | `/<workspace>/login` | Workspace-scoped login |
| Register | `/<workspace>/register` | New user registration |
| Agents | `/<workspace>/agents` | Agent list with scope badges + create form (scope selector for admins) |
| Agent Detail | `/<workspace>/agents/:id` | View/Edit, scope display, built-in tools config, agent credentials, MCP servers |
| Workflows | `/<workspace>/workflows` | Workflow list with scope badges + create form (with defaults + per-step agent selection + scope selector) |
| Workflow Detail | `/<workspace>/workflows/:id` | Edit metadata + defaults, scope display, steps editor, trigger config (event name selector), Run Now with user input dialog |
| Executions | `/<workspace>/executions` | Execution history with filters |
| Execution Detail | `/<workspace>/executions/:id` | Full execution trace: each step's prompt, output, reasoning |
| Events | `/<workspace>/events` | System event audit log with filtering by event name and scope, paginated |
| Variables | `/<workspace>/variables` | User-level + agent-level + workspace-level variable manager |
| Plugins | `/<workspace>/plugins` | Plugin marketplace with per-agent toggle |
| Quotas | `/<workspace>/quotas` | Credit usage and quota settings |
| Admin: Users | `/<workspace>/admin/users` | User management: list, add, edit roles |
| Admin: Models | `/<workspace>/admin/models` | Model registry management |
| Workspaces | `/<workspace>/workspaces` | Workspace management (super_admin only) |

## Layout

The UI uses a **left sidebar layout**:
- **Top header bar** (fixed, h-14): Hamburger menu toggle, platform logo, user info, logout button
- **Left sidebar** (fixed, w-56): Navigation grouped into Main, Admin, and System sections
- **Main content area**: Offset by sidebar width on desktop, full-width on mobile

On mobile, the sidebar slides in/out with an overlay backdrop.

## Execution Detail View

The execution detail page is the most important UI feature:

```
┌─────────────────────────────────────────────────────────────────┐
│ Execution #e7a3...  │  Status: ✅ Completed  │  Duration: 45s  │
├─────────────────────────────────────────────────────────────────┤
│ Triggered by: Time Schedule (0 9 * * 1-5) at 2024-12-01 09:00  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Step 1: Analyze Market                          ✅ 12s         │
│  ┌── Prompt ──────────────────────────────────────────┐        │
│  │ Analyze the current market conditions for AAPL...  │        │
│  └────────────────────────────────────────────────────┘        │
│  ┌── Output ──────────────────────────────────────────┐        │
│  │ ## Market Analysis - Dec 1, 2024                   │        │
│  │ ### AAPL: Bullish ...                              │        │
│  └────────────────────────────────────────────────────┘        │
│  ┌── Reasoning (3 tool calls) ────────────────────────┐        │
│  │ → web_search("AAPL stock news today") ...          │        │
│  └────────────────────────────────────────────────────┘        │
│                                                                 │
│  Step 2: Make Trade Decisions                    ✅ 18s         │
│  ┌── Prompt ──────────────────────────────────────────┐        │
│  │ Based on the following market analysis...          │        │
│  │ [output from step 1 injected here]                 │        │
│  └────────────────────────────────────────────────────┘        │
│  ┌── Output ──────────────────────────────────────────┐        │
│  │ ## Trade Recommendations ...                       │        │
│  └────────────────────────────────────────────────────┘        │
│                                                                 │
│  Step 3: Write Blog Post                         ✅ 15s         │
│  ...                                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Quota System

Per-user credit limits (configurable by admin):
- **Daily credit limit**: Max credits per day
- **Monthly credit limit**: Max credits per month
- Tracked in `credit_usage` table (per user, per model, per day)
- Checked before each step execution
- Exceeded → step marked `failed`, execution halted
- Users can set their own limits (must be ≤ workspace limits)
