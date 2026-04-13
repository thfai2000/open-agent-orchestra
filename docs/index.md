---
layout: home

hero:
  name: Open Agent Orchestra
  text: Build Your AI Team
  tagline: "OAO — Define agents with different skills and costs. Orchestrate them into workflows with secure credential management, audit trails, and segregation of duties. Powered by the GitHub Copilot SDK."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/what-is-oao
    - theme: alt
      text: Host on Docker
      link: /guide/docker
    - theme: alt
      text: GitHub
      link: https://github.com/thfai2000/open-agent-orchestra

features:
  - icon: 👥
    title: AI Team with Segregation of Duties
    details: Lower-cost agents handle screening and data gathering. Higher-cost agents with thinking capability solve complex problems. Just like a real team.
  - icon: 🔐
    title: Zero Credential Exposure
    details: "Agents never see credentials. Scoped credentials are injected into MCP configs and HTTP headers via Jinja2 templates — agents can only access them through platform tools."
  - icon: 🔄
    title: Multi-Step Workflows
    details: Chain agent steps with precedent output passing, variable injection, and per-step model/reasoning configuration.
  - icon: ⏰
    title: Flexible Triggers
    details: Cron schedules, exact datetimes, webhooks, system events with data matching, or manual execution.
  - icon: 🏢
    title: Multi-Tenant Workspaces
    details: Full workspace isolation with RBAC (super admin, workspace admin, creator, viewer). URL-scoped routing.
  - icon: 🧩
    title: Plugin & MCP Ecosystem
    details: Extend agents with Git-hosted plugins and Model Context Protocol (MCP) servers for custom tool integration.
---

## Why Open Agent Orchestra?

Daily tasks can often be broken down into smaller subtasks that benefit from **different AI capabilities at different cost levels**. A lower-cost agent can screen and triage — then pass results to a higher-cost agent with specialized skills and reasoning power. **OAO** lets you build this kind of cost-effective AI team with proper credential management, audit trails, and segregation of duties.

### How It Works

```mermaid
graph LR
    T[Trigger<br/>cron / event / webhook] -->|fires| C[Controller<br/>30s poll]
    C -->|enqueue| WE[Workflow Engine<br/>step-by-step]
    WE -->|provisions| AP[Agent Instance<br/>Copilot session + tools + MCP]
```

### Key Differentiators

| Feature | OAO | Typical AI Frameworks |
|---|---|---|
| Cost-effective AI teams | Multi-agent workflows with per-step model selection | Single model for everything |
| Agent definition | Git-hosted markdown | Code-only |
| Credential security | Zero exposure — Jinja2 templates inject credentials into MCP configs & HTTP headers | Environment variables |
| Workflow orchestration | Built-in multi-step engine | Manual chaining |
| Scheduling | Cron, datetime, events, webhooks | External (cron jobs) |
| Multi-tenancy | Workspace isolation + RBAC | Single tenant |
| Tool ecosystem | Built-in tools + MCP + Plugins | Framework-specific |
| Execution history | Full audit trail per step | Logging only |
| Retry mechanism | Per-step retry from failure point | Full restart |
