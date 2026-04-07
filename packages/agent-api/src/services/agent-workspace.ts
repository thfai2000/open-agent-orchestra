import { simpleGit, type SimpleGit } from 'simple-git';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger, decrypt } from '@ai-trader/shared';

const logger = createLogger('agent-workspace');

export interface AgentConfig {
  agentFilePath: string;
  skillsPaths: string[];
  parameters?: Record<string, unknown>;
}

export interface AgentWorkspace {
  workdir: string;
  agentMarkdown: string;
  skills: string[];
  config: AgentConfig | null;
  cleanup: () => Promise<void>;
}

/**
 * Clone an agent's Git repo into a temporary directory, read agent.json + agent.md + skills.
 * Returns an AgentWorkspace with the parsed content and a cleanup function.
 */
export async function prepareAgentWorkspace(opts: {
  gitRepoUrl: string;
  gitBranch: string;
  agentFilePath: string;
  skillsPaths: string[];
  githubTokenEncrypted?: string | null;
}): Promise<AgentWorkspace> {
  const workdir = await mkdtemp(join(tmpdir(), 'agent-workspace-'));

  const cleanup = async () => {
    try {
      await rm(workdir, { recursive: true, force: true });
      logger.debug({ workdir }, 'Cleaned up agent workspace');
    } catch (err) {
      logger.warn({ workdir, err }, 'Failed to clean up workspace');
    }
  };

  try {
    // Build clone URL with auth token if available
    let cloneUrl = opts.gitRepoUrl;
    if (opts.githubTokenEncrypted) {
      const token = decrypt(opts.githubTokenEncrypted);
      // Inject token into HTTPS URL: https://TOKEN@github.com/...
      cloneUrl = cloneUrl.replace('https://', `https://${token}@`);
    }

    const git: SimpleGit = simpleGit();
    logger.info({ repo: opts.gitRepoUrl, branch: opts.gitBranch }, 'Cloning agent repo');

    await git.clone(cloneUrl, workdir, [
      '--branch',
      opts.gitBranch,
      '--depth',
      '1',
      '--single-branch',
    ]);

    // Read agent markdown file
    const agentPath = join(workdir, opts.agentFilePath);
    const agentMarkdown = await readFile(agentPath, 'utf-8');

    // Read skills
    const skills: string[] = [];
    for (const skillPath of opts.skillsPaths) {
      try {
        const content = await readFile(join(workdir, skillPath), 'utf-8');
        skills.push(content);
      } catch {
        logger.warn({ skillPath }, 'Skill file not found, skipping');
      }
    }

    // Try to read agent.json config
    let config: AgentConfig | null = null;
    try {
      const configRaw = await readFile(join(workdir, 'agent.json'), 'utf-8');
      config = JSON.parse(configRaw) as AgentConfig;
    } catch {
      logger.debug('No agent.json found, using agent definition defaults');
    }

    logger.info(
      { workdir, agentFile: opts.agentFilePath, skillCount: skills.length },
      'Agent workspace ready',
    );

    return { workdir, agentMarkdown, skills, config, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/**
 * Commit and push changes back to the agent repo (e.g., journal updates).
 */
export async function pushAgentChanges(opts: {
  workdir: string;
  files: string[];
  message: string;
}): Promise<void> {
  const git = simpleGit(opts.workdir);

  await git.add(opts.files);
  const status = await git.status();

  if (status.staged.length === 0) {
    logger.debug('No changes to commit');
    return;
  }

  await git.commit(opts.message);
  await git.push();
  logger.info({ files: opts.files, message: opts.message }, 'Pushed agent changes');
}
