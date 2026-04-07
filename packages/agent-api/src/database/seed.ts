import { db } from './index.js';
import { agents, workflows, workflowSteps, triggers, mcpServerConfigs } from './schema.js';
import { createLogger } from '@ai-trader/shared';

const logger = createLogger('agent-seed');

async function seed() {
  logger.info('Seeding agent database...');

  // Create a sample agent
  const [agent] = await db
    .insert(agents)
    .values({
      userId: '00000000-0000-0000-0000-000000000001', // placeholder user id
      name: 'SampleAgent',
      description: 'A sample agent to demonstrate the platform capabilities.',
      gitRepoUrl: 'https://github.com/example/my-agent',
      gitBranch: 'main',
      agentFilePath: '.github/agents/normal.md',
      skillsPaths: ['skills/domain.md'],
      status: 'active',
    })
    .onConflictDoNothing()
    .returning();

  if (agent) {
    logger.info(`Created agent: ${agent.name}`);

    // Create a sample MCP server config (example: Trading Platform)
    await db.insert(mcpServerConfigs).values({
      agentId: agent.id,
      name: 'Trading Platform',
      description: 'AI Trader Simulation MCP server for market data and trading',
      command: 'node',
      args: ['--import', 'tsx', 'packages/trading-api/src/mcp-server.ts'],
      envMapping: {
        TRADING_API_URL: 'TRADING_API_URL',
        TRADING_API_KEY: 'TRADING_API_KEY',
        TRADER_ID: 'TRADER_ID',
      },
      isEnabled: true,
      writeTools: ['execute_trade', 'publish_blog_post'],
    });

    // Create a sample workflow (belongs to user, not agent)
    const [workflow] = await db
      .insert(workflows)
      .values({
        userId: '00000000-0000-0000-0000-000000000001',
        name: 'Morning Analysis',
        description: 'Analyze data and generate a report every weekday morning.',
        isActive: true,
        defaultAgentId: agent.id,
        defaultModel: 'claude-sonnet-4',
        defaultReasoningEffort: 'medium',
      })
      .returning();

    // Create workflow steps (each step references an agent)
    await db.insert(workflowSteps).values([
      {
        workflowId: workflow.id,
        agentId: agent.id,
        name: 'Gather Data',
        promptTemplate: `Gather and analyze the latest data relevant to your domain.

Provide a comprehensive analysis including:
1. Current status and trends
2. Key observations
3. Notable changes since last analysis

Use the available tools to fetch current data.`,
        stepOrder: 1,
        timeoutSeconds: 300,
      },
      {
        workflowId: workflow.id,
        agentId: agent.id,
        name: 'Make Decisions',
        promptTemplate: `Based on the following analysis, decide what actions to take:

<PRECEDENT_OUTPUT>

Consider risk management and constraints. For each recommended action, provide detailed reasoning.`,
        stepOrder: 2,
        timeoutSeconds: 300,
      },
      {
        workflowId: workflow.id,
        agentId: agent.id,
        name: 'Generate Report',
        promptTemplate: `Write a brief summary report based on the following analysis and decisions:

<PRECEDENT_OUTPUT>

Write in a professional tone. Include key observations, actions taken, and outlook.`,
        stepOrder: 3,
        timeoutSeconds: 300,
      },
    ]);

    // Create a time-based trigger
    await db.insert(triggers).values({
      workflowId: workflow.id,
      triggerType: 'time_schedule',
      configuration: { cron: '0 9 * * 1-5', timezone: 'America/New_York' },
      isActive: true,
    });

    logger.info(`Created workflow: ${workflow.name} with 3 steps`);
  }

  logger.info('Agent database seeded successfully!');
  process.exit(0);
}

seed().catch((err) => {
  logger.error(err, 'Seed failed');
  process.exit(1);
});
