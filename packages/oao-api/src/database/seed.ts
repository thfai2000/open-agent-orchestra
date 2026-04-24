import { db } from './index.js';
import { agents, workflows, workflowSteps, triggers, workspaces, models, users, authProviders } from './schema.js';
import { createLogger } from '@oao/shared';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

const logger = createLogger('agent-seed');

async function seed() {
  logger.info('Seeding agent database...');

  // Create the Default Workspace (cannot be deleted)
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Default Workspace',
      slug: 'default',
      description: 'The default workspace for the platform.',
      isDefault: true,
    })
    .onConflictDoNothing()
    .returning();

  const workspaceId = workspace?.id;
  if (workspace) {
    logger.info(`Created workspace: ${workspace.name} (slug: ${workspace.slug})`);
  } else {
    logger.info('Default workspace already exists, skipping');
  }

  // Seed default models (idempotent — skip if models already exist for this workspace)
  const resolvedWsId = workspaceId ?? (await db.query.workspaces.findFirst({ where: (w, { eq }) => eq(w.slug, 'default') }))?.id;
  if (resolvedWsId) {
    const existingModels = await db.query.models.findFirst({ where: (m, { eq }) => eq(m.workspaceId, resolvedWsId) });
    if (!existingModels) {
      const defaultModels = [
        { name: 'claude-sonnet-4-6', provider: 'anthropic', description: 'Claude Sonnet 4.6 — fast, balanced model' },
        { name: 'gpt-5.4', provider: 'openai', description: 'GPT-5.4 — advanced reasoning model' },
        { name: 'gpt-5-mini', provider: 'openai', description: 'GPT-5 Mini — fast and cost-effective' },
        { name: 'gpt-5.4-mini', provider: 'openai', description: 'GPT-5.4 Mini — balanced speed and capability' },
      ];
      for (const m of defaultModels) {
        await db.insert(models).values({ workspaceId: resolvedWsId, ...m }).onConflictDoNothing();
      }
      logger.info(`Seeded ${defaultModels.length} default models`);
    } else {
      logger.info('Models already exist, skipping');
    }
  }

  // Create superadmin user with random password
  const existingSuperAdmin = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.role, 'super_admin'),
  });
  if (!existingSuperAdmin) {
    const randomPassword = randomBytes(16).toString('hex'); // 32-char hex string
    const passwordHash = await bcrypt.hash(randomPassword, 12);
    await db.insert(users).values({
      email: 'admin@oao.local',
      passwordHash,
      name: 'Super Admin',
      role: 'super_admin',
      workspaceId: resolvedWsId ?? undefined,
    });
    logger.info('═══════════════════════════════════════════════════════════════');
    logger.info('  SUPERADMIN ACCOUNT CREATED');
    logger.info(`  Email:    admin@oao.local`);
    logger.info(`  Password: ${randomPassword}`);
    logger.info('  ⚠️  Change this password immediately after first login!');
    logger.info('═══════════════════════════════════════════════════════════════');
  } else {
    logger.info('Superadmin already exists, skipping');
  }

  // Create default Database auth provider (idempotent)
  if (resolvedWsId) {
    const existingDbProvider = await db.query.authProviders.findFirst({
      where: (ap, { eq, and: andFn }) => andFn(eq(ap.workspaceId, resolvedWsId!), eq(ap.providerType, 'database')),
    });
    if (!existingDbProvider) {
      await db.insert(authProviders).values({
        workspaceId: resolvedWsId,
        providerType: 'database',
        name: 'Built-in Database',
        isEnabled: true,
        priority: 0,
        config: {},
      }).onConflictDoNothing();
      logger.info('Created default Database auth provider');
    } else {
      logger.info('Database auth provider already exists, skipping');
    }
  }

  // Create a sample agent (idempotent — skip if any agent already exists)
  const sampleWorkspaceId = workspaceId ?? resolvedWsId ?? '00000000-0000-0000-0000-000000000000';
  const sampleUserId = (await db.query.users.findFirst({ where: (u, { eq }) => eq(u.role, 'super_admin') }))?.id ?? '00000000-0000-0000-0000-000000000001';
  const existingAgent = await db.query.agents.findFirst({ where: (a, { eq }) => eq(a.workspaceId, sampleWorkspaceId) });
  if (existingAgent) {
    logger.info('Sample agent already exists, skipping');
  } else {
    const [agent] = await db
      .insert(agents)
      .values({
        workspaceId: sampleWorkspaceId,
        userId: sampleUserId,
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

      // Create a sample workflow (belongs to user, not agent)
      const [workflow] = await db
        .insert(workflows)
        .values({
          workspaceId: sampleWorkspaceId,
          userId: sampleUserId,
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
  }

  logger.info('Agent database seeded successfully!');
  process.exit(0);
}

seed().catch((err) => {
  logger.error(err, 'Seed failed');
  process.exit(1);
});
