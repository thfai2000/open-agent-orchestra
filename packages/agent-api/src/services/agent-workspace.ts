import { simpleGit, type SimpleGit } from 'simple-git';
import { mkdtemp, rm, readFile, writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createLogger, decrypt } from '@ai-trader/shared';
import { eq } from 'drizzle-orm';
import { db } from '../database/index.js';
import { agentFiles } from '../database/schema.js';
import { readdir } from 'node:fs/promises';

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
  skillsDirectory?: string | null;
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
    // Build clone with auth token via GIT_ASKPASS to avoid exposing token in process args/logs
    const cloneUrl = opts.gitRepoUrl;
    const git: SimpleGit = simpleGit();

    if (opts.githubTokenEncrypted) {
      const token = decrypt(opts.githubTokenEncrypted);
      // Use GIT_ASKPASS to provide credentials securely without embedding in URL
      const { writeFile, chmod } = await import('node:fs/promises');
      const askpassPath = join(workdir, '.git-askpass.sh');
      await writeFile(askpassPath, `#!/bin/sh\necho "${token.replace(/"/g, '\\"')}"`, { mode: 0o700 });
      await chmod(askpassPath, 0o700);
      git.env('GIT_ASKPASS', askpassPath);
      git.env('GIT_TERMINAL_PROMPT', '0');
    }

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

    // Read skills (individual paths)
    const skills: string[] = [];
    for (const skillPath of opts.skillsPaths) {
      try {
        const content = await readFile(join(workdir, skillPath), 'utf-8');
        skills.push(content);
      } catch {
        logger.warn({ skillPath }, 'Skill file not found, skipping');
      }
    }

    // Read skills from directory (loads all .md files)
    if (opts.skillsDirectory) {
      try {
        const skillsDir = join(workdir, opts.skillsDirectory);
        const entries = await readdir(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            try {
              const content = await readFile(join(skillsDir, entry.name), 'utf-8');
              skills.push(content);
            } catch {
              logger.warn({ file: entry.name }, 'Skill file in directory unreadable, skipping');
            }
          }
        }
      } catch {
        logger.warn({ skillsDirectory: opts.skillsDirectory }, 'Skills directory not found, skipping');
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

/**
 * Prepare an agent workspace from DB-stored files.
 * Writes files to a temp directory and reads the agent definition + skills.
 */
export async function prepareDbAgentWorkspace(agentId: string): Promise<AgentWorkspace> {
  const workdir = await mkdtemp(join(tmpdir(), 'agent-workspace-db-'));

  const cleanup = async () => {
    try {
      await rm(workdir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ workdir, err }, 'Failed to clean up DB workspace');
    }
  };

  try {
    const files = await db.query.agentFiles.findMany({
      where: eq(agentFiles.agentId, agentId),
    });

    if (files.length === 0) {
      throw new Error('No agent files found in database');
    }

    // Write files to temp directory
    for (const file of files) {
      const filePath = join(workdir, file.filePath);
      await mkdir(dirname(filePath), { recursive: true });
      await fsWriteFile(filePath, file.content, 'utf-8');
    }

    // Find the main agent file (first .md file at root, or first file)
    const agentFile = files.find(f => !f.filePath.includes('/') && f.filePath.endsWith('.md'))
      || files[0];

    const agentMarkdown = agentFile.content;

    // Collect skills (any .md files in subdirectories or explicitly named skills)
    const skills: string[] = [];
    for (const file of files) {
      if (file.filePath !== agentFile.filePath && file.filePath.endsWith('.md')) {
        skills.push(file.content);
      }
    }

    logger.info(
      { workdir, agentFile: agentFile.filePath, skillCount: skills.length, totalFiles: files.length },
      'DB agent workspace ready',
    );

    return { workdir, agentMarkdown, skills, config: null, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
