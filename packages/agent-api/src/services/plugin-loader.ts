import { simpleGit } from 'simple-git';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, and } from 'drizzle-orm';
import { createLogger, decrypt } from '@ai-trader/shared';
import { db } from '../database/index.js';
import { plugins, agentPlugins } from '../database/schema.js';

const logger = createLogger('plugin-loader');

// ─── Manifest Types ──────────────────────────────────────────────────

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  tools?: PluginToolDef[];
  skills?: string[];
  mcpServers?: PluginMcpServer[];
}

export interface PluginToolDef {
  name: string;
  description: string;
  scriptPath: string;
  parameters: Record<string, unknown>;
}

export interface PluginMcpServer {
  name: string;
  description?: string;
  command: string;
  args: string[];
  envMapping?: Record<string, string>;
  writeTools?: string[];
}

export interface LoadedPlugin {
  pluginId: string;
  manifest: PluginManifest;
  workdir: string;
  cleanup: () => Promise<void>;
}

// ─── Sync Plugin Manifest (admin action) ─────────────────────────────

/**
 * Clone a plugin repo, read plugin.json, update manifestCache in DB.
 */
export async function syncPluginManifest(pluginId: string): Promise<PluginManifest> {
  const plugin = await db.query.plugins.findFirst({
    where: eq(plugins.id, pluginId),
  });
  if (!plugin) throw new Error(`Plugin ${pluginId} not found`);

  const workdir = await mkdtemp(join(tmpdir(), 'plugin-sync-'));

  try {
    let cloneUrl = plugin.gitRepoUrl;
    if (plugin.githubTokenEncrypted) {
      const token = decrypt(plugin.githubTokenEncrypted);
      cloneUrl = cloneUrl.replace('https://', `https://${token}@`);
    }

    const git = simpleGit();
    await git.clone(cloneUrl, workdir, [
      '--branch', plugin.gitBranch,
      '--depth', '1',
      '--single-branch',
    ]);

    const manifestPath = join(workdir, 'plugin.json');
    const manifestRaw = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestRaw) as PluginManifest;

    // Update manifest cache in DB
    await db
      .update(plugins)
      .set({ manifestCache: manifest, updatedAt: new Date() })
      .where(eq(plugins.id, pluginId));

    logger.info({ pluginId, name: manifest.name, version: manifest.version }, 'Plugin manifest synced');
    return manifest;
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Load Plugins for Agent (runtime) ─────────────────────────────────

/**
 * Load all enabled plugins for an agent:
 * 1. Query enabled agent_plugins
 * 2. Git clone each plugin repo
 * 3. Read plugin.json manifest
 * 4. Return loaded plugins with workdirs for tool/skill/mcp loading
 */
export async function loadAgentPlugins(agentId: string): Promise<LoadedPlugin[]> {
  // Get enabled plugins for this agent
  const agentPluginLinks = await db.query.agentPlugins.findMany({
    where: and(eq(agentPlugins.agentId, agentId), eq(agentPlugins.isEnabled, true)),
  });

  if (agentPluginLinks.length === 0) return [];

  const pluginIds = agentPluginLinks.map((ap) => ap.pluginId);
  const loadedPlugins: LoadedPlugin[] = [];

  for (const pluginId of pluginIds) {
    const plugin = await db.query.plugins.findFirst({
      where: and(eq(plugins.id, pluginId), eq(plugins.isAllowed, true)),
    });
    if (!plugin) continue;

    const workdir = await mkdtemp(join(tmpdir(), `plugin-${plugin.name}-`));

    try {
      let cloneUrl = plugin.gitRepoUrl;
      if (plugin.githubTokenEncrypted) {
        const token = decrypt(plugin.githubTokenEncrypted);
        cloneUrl = cloneUrl.replace('https://', `https://${token}@`);
      }

      const git = simpleGit();
      await git.clone(cloneUrl, workdir, [
        '--branch', plugin.gitBranch,
        '--depth', '1',
        '--single-branch',
      ]);

      // Read manifest
      const manifestPath = join(workdir, 'plugin.json');
      const manifestRaw = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestRaw) as PluginManifest;

      const cleanup = async () => {
        try {
          await rm(workdir, { recursive: true, force: true });
        } catch {
          logger.warn({ workdir }, 'Failed to clean up plugin directory');
        }
      };

      loadedPlugins.push({ pluginId, manifest, workdir, cleanup });
      logger.info({ pluginId, name: manifest.name }, 'Plugin loaded');
    } catch (err) {
      logger.warn({ pluginId, error: err }, 'Failed to load plugin, skipping');
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return loadedPlugins;
}

// ─── Read Plugin Skills ──────────────────────────────────────────────

/**
 * Read skill markdown files from a loaded plugin.
 */
export async function readPluginSkills(loaded: LoadedPlugin): Promise<string[]> {
  const skills: string[] = [];
  const skillPaths = loaded.manifest.skills ?? [];

  for (const relPath of skillPaths) {
    try {
      const content = await readFile(join(loaded.workdir, relPath), 'utf-8');
      skills.push(content);
    } catch {
      logger.warn({ plugin: loaded.manifest.name, path: relPath }, 'Plugin skill file not found');
    }
  }

  return skills;
}

// ─── Get Plugin MCP Servers ──────────────────────────────────────────

/**
 * Get MCP server configs from a loaded plugin's manifest.
 */
export function getPluginMcpServers(loaded: LoadedPlugin): PluginMcpServer[] {
  return loaded.manifest.mcpServers ?? [];
}

// ─── Get Plugin Tool Definitions ─────────────────────────────────────

/**
 * Get tool definitions from a loaded plugin's manifest.
 * The scriptPath is resolved to an absolute path in the workdir.
 */
export function getPluginToolDefs(loaded: LoadedPlugin): Array<PluginToolDef & { absolutePath: string }> {
  const tools = loaded.manifest.tools ?? [];
  return tools.map((t) => ({
    ...t,
    absolutePath: join(loaded.workdir, t.scriptPath),
  }));
}
