import { db } from './index.js';
import { agents, workflows, workflowSteps, triggers, workspaces, models, users, authProviders, roles, functionalities, roleFunctionalities, userGroups, userGroupRoles, userGroupMembers } from './schema.js';
import { FUNCTIONALITY_CATALOG, SYSTEM_ROLES } from '../services/rbac-functionalities.js';
import { createLogger } from '@oao/shared';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

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

  // Seed default models for the superadmin user. All four are served via GitHub Copilot SDK
  // (providerType 'github'), including Anthropic-named ones — they are still routed through
  // Copilot. creditCost values are taken from the platform pricing table.
  // NOTE: As of v1.37.0 models are user-scoped, not workspace-scoped.
  const resolvedWsId = workspaceId ?? (await db.query.workspaces.findFirst({ where: (w, { eq }) => eq(w.slug, 'default') }))?.id;

  // Create or optionally reset superadmin user.
  const superAdminEmail = process.env.SUPERADMIN_EMAIL?.trim() || 'admin@oao.local';
  const configuredSuperAdminPassword = process.env.SUPERADMIN_PASSWORD?.trim() || '';
  const forceSuperAdminPasswordReset = process.env.SUPERADMIN_FORCE_PASSWORD_RESET === 'true';
  const existingSuperAdmin = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.role, 'super_admin'),
  });
  if (!existingSuperAdmin) {
    const generatedPassword = randomBytes(16).toString('hex'); // 32-char hex string
    const superAdminPassword = configuredSuperAdminPassword || generatedPassword;
    const passwordHash = await bcrypt.hash(superAdminPassword, 12);
    await db.insert(users).values({
      email: superAdminEmail,
      passwordHash,
      name: 'Super Admin',
      role: 'super_admin',
      authProvider: 'database',
      workspaceId: resolvedWsId ?? undefined,
    });
    logger.info('═══════════════════════════════════════════════════════════════');
    logger.info('  SUPERADMIN ACCOUNT CREATED');
    logger.info(`  Email:    ${superAdminEmail}`);
    if (configuredSuperAdminPassword) {
      logger.info('  Password: configured via SUPERADMIN_PASSWORD');
    } else {
      logger.info(`  Password: ${generatedPassword}`);
    }
    logger.info('  ⚠️  Change this password immediately after first login!');
    logger.info('═══════════════════════════════════════════════════════════════');
  } else if (configuredSuperAdminPassword && forceSuperAdminPasswordReset) {
    const passwordHash = await bcrypt.hash(configuredSuperAdminPassword, 12);
    await db.update(users)
      .set({
        email: superAdminEmail,
        passwordHash,
        authProvider: 'database',
        updatedAt: new Date(),
      })
      .where(eq(users.id, existingSuperAdmin.id));
    logger.info('═══════════════════════════════════════════════════════════════');
    logger.info('  SUPERADMIN PASSWORD RESET FROM CONFIGURATION');
    logger.info(`  Email:    ${superAdminEmail}`);
    logger.info('  Password: configured via SUPERADMIN_PASSWORD');
    logger.info('  Source:   SUPERADMIN_FORCE_PASSWORD_RESET=true');
    logger.info('═══════════════════════════════════════════════════════════════');
  } else {
    logger.info('Superadmin already exists, skipping password reset');
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

  // Seed default models for the superadmin user (idempotent).
  const superAdminUser = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.role, 'super_admin') });
  if (superAdminUser) {
    const defaultModels = [
      { name: 'claude-sonnet-4-6', provider: 'github', description: 'Claude Sonnet 4.6 via GitHub Copilot — balanced model', creditCost: '1.00' },
      { name: 'gpt-5.4',           provider: 'github', description: 'GPT-5.4 via GitHub Copilot — advanced reasoning model', creditCost: '1.00' },
      { name: 'gpt-5.4-mini',      provider: 'github', description: 'GPT-5.4 Mini via GitHub Copilot — balanced speed and capability', creditCost: '0.33' },
      { name: 'gpt-5-mini',        provider: 'github', description: 'GPT-5 Mini via GitHub Copilot — fast and free of charge', creditCost: '0.00' },
    ];
    for (const m of defaultModels) {
      const existing = await db.query.models.findFirst({
        where: (mt, { and: andFn, eq }) => andFn(eq(mt.userId, superAdminUser.id), eq(mt.name, m.name)),
      });
      if (existing) {
        await db.update(models)
          .set({ provider: m.provider, description: m.description, creditCost: m.creditCost, updatedAt: new Date() })
          .where(eq(models.id, existing.id));
      } else {
        await db.insert(models).values({ userId: superAdminUser.id, ...m });
      }
    }
    logger.info(`Seeded ${defaultModels.length} default models for superadmin (idempotent upsert)`);
  }

  // ─── RBAC v2.0.0 seed: functionalities, system roles, default user-groups ────
  // Idempotent: re-running this block is safe; it only adds missing rows.
  logger.info('Seeding RBAC functionalities and system roles...');
  for (const f of FUNCTIONALITY_CATALOG) {
    await db.insert(functionalities).values({
      key: f.key,
      resource: f.resource,
      action: f.action,
      label: f.label,
      description: f.description,
      category: f.category,
      isSystem: true,
    }).onConflictDoUpdate({
      target: functionalities.key,
      set: {
        resource: f.resource,
        action: f.action,
        label: f.label,
        description: f.description,
        category: f.category,
      },
    });
  }
  logger.info(`Upserted ${FUNCTIONALITY_CATALOG.length} functionalities`);

  // Seed the four system roles (workspaceId NULL = global). Functionality bindings are
  // re-applied so deployment changes to the catalog propagate; manual bindings on
  // non-system roles are untouched.
  const systemRoleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    let row = await db.query.roles.findFirst({
      where: (rt, { eq, and: andFn, isNull }) => andFn(eq(rt.name, r.name), isNull(rt.workspaceId)),
    });
    if (!row) {
      const [inserted] = await db.insert(roles).values({
        name: r.name,
        description: r.description,
        isSystem: true,
        workspaceId: null,
      }).returning();
      row = inserted!;
      logger.info(`Created system role ${r.name}`);
    } else if (row.description !== r.description || !row.isSystem) {
      await db.update(roles)
        .set({ description: r.description, isSystem: true, updatedAt: new Date() })
        .where(eq(roles.id, row.id));
    }
    systemRoleIds[r.name] = row.id;

    // Reset functionality bindings on system roles to match the canonical list.
    await db.delete(roleFunctionalities).where(eq(roleFunctionalities.roleId, row.id));
    if (r.functionalities.length) {
      await db.insert(roleFunctionalities).values(
        r.functionalities.map((key) => ({ roleId: row!.id, functionalityKey: key })),
      ).onConflictDoNothing();
    }
  }
  logger.info(`Upserted ${SYSTEM_ROLES.length} system roles with functionality bindings`);

  // Seed one default user-group per system role inside the default workspace.
  if (resolvedWsId) {
    for (const r of SYSTEM_ROLES) {
      const groupName = `${r.name.replace(/_/g, ' ')}s`.replace(/\b\w/g, (c) => c.toUpperCase()); // e.g. "Super Admins"
      let group = await db.query.userGroups.findFirst({
        where: (g, { eq, and: andFn }) => andFn(eq(g.workspaceId, resolvedWsId!), eq(g.name, groupName)),
      });
      if (!group) {
        const [inserted] = await db.insert(userGroups).values({
          workspaceId: resolvedWsId,
          name: groupName,
          description: `Default group for the ${r.name} role.`,
          isLegacy: false,
        }).returning();
        group = inserted!;
        logger.info(`Created default user-group "${groupName}"`);
      }
      // Bind the matching role
      await db.insert(userGroupRoles).values({
        groupId: group.id,
        roleId: systemRoleIds[r.name]!,
      }).onConflictDoNothing();

      // Auto-add the superadmin user to the super_admin group so the v2 flag-based
      // checks pass without requiring a manual UI step.
      if (r.name === 'super_admin' && superAdminUser) {
        await db.insert(userGroupMembers).values({
          groupId: group.id,
          userId: superAdminUser.id,
        }).onConflictDoNothing();
      }
    }
  }

  // ─── v2.0.0 legacy bridge: ensure every existing user has at least the
  // group-membership matching their legacy `users.role` so flag-based checks
  // do not regress for pre-v2 users. Only fires for non-superadmin users.
  if (resolvedWsId) {
    const legacyRoleToGroupName: Record<string, string> = {
      super_admin: 'Super Admins',
      workspace_admin: 'Workspace Admins',
      creator_user: 'Creators',
      view_user: 'Viewers',
    };
    const allUsers = await db.query.users.findMany({ columns: { id: true, role: true, workspaceId: true } });
    let bridged = 0;
    for (const u of allUsers) {
      const targetGroupName = legacyRoleToGroupName[u.role];
      if (!targetGroupName) continue;
      const ws = u.workspaceId ?? resolvedWsId;
      const group = await db.query.userGroups.findFirst({
        where: (g, { eq, and: andFn }) => andFn(eq(g.workspaceId, ws!), eq(g.name, targetGroupName)),
      });
      if (!group) continue;
      const existing = await db.query.userGroupMembers.findFirst({
        where: (m, { eq, and: andFn }) => andFn(eq(m.groupId, group.id), eq(m.userId, u.id)),
      });
      if (!existing) {
        await db.insert(userGroupMembers).values({ groupId: group.id, userId: u.id }).onConflictDoNothing();
        bridged++;
      }
    }
    if (bridged > 0) logger.info(`Bridged ${bridged} legacy user(s) into default groups`);
  }
  logger.info('RBAC v2.0.0 seed complete');

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
