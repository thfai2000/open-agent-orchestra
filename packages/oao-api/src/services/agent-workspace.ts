import { simpleGit, type SimpleGit } from 'simple-git';
import { mkdtemp, rm, readFile, writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createLogger, decrypt } from '@oao/shared';
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

interface GitCloneAuth {
  username: string;
  password: string;
}

function normalizeMultilineSecret(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

function parseStructuredCredential(rawValue: string, credentialSubType: string): Record<string, string> {
  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Credential payload must be a JSON object');
    }

    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, typeof value === 'string' ? value : String(value ?? '')]),
    );
  } catch (error) {
    throw new Error(
      `Git credential subtype "${credentialSubType}" requires a structured JSON value. ${error instanceof Error ? error.message : 'Invalid JSON payload.'}`,
      { cause: error },
    );
  }
}

async function createGitHubAppInstallationAuth(rawValue: string): Promise<GitCloneAuth> {
  const credential = parseStructuredCredential(rawValue, 'github_app');
  const appId = credential.appId?.trim();
  const installationId = credential.installationId?.trim();
  const privateKey = credential.privateKey ? normalizeMultilineSecret(credential.privateKey) : '';

  if (!appId || !installationId || !privateKey) {
    throw new Error('GitHub App credentials require appId, installationId, and privateKey.');
  }

  const jose = await import('jose');
  const signingKey = await jose.importPKCS8(privateKey, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new jose.SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .setIssuer(appId)
    .sign(signingKey);

  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'open-agent-orchestra',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Failed to create a GitHub App installation token (${response.status}). ${errorBody || 'GitHub API request failed.'}`,
    );
  }

  const payload = await response.json() as { token?: string };
  if (!payload.token) {
    throw new Error('GitHub App token response did not include an installation token.');
  }

  return {
    username: 'x-access-token',
    password: payload.token,
  };
}

async function resolveGitCloneAuth(opts: {
  gitRepoUrl: string;
  githubTokenEncrypted?: string | null;
  githubCredentialSubType?: string | null;
}): Promise<GitCloneAuth | null> {
  if (!opts.githubTokenEncrypted) return null;

  const secret = decrypt(opts.githubTokenEncrypted);
  const credentialSubType = opts.githubCredentialSubType || 'secret_text';
  const defaultTokenUsername = opts.gitRepoUrl.includes('github.com') ? 'x-access-token' : 'git';

  switch (credentialSubType) {
    case 'secret_text':
    case 'github_token':
      return {
        username: defaultTokenUsername,
        password: secret,
      };
    case 'github_app':
      return createGitHubAppInstallationAuth(secret);
    case 'user_account': {
      const credential = parseStructuredCredential(secret, 'user_account');
      if (!credential.username?.trim() || !credential.password) {
        throw new Error('User account credentials require both username and password.');
      }

      return {
        username: credential.username.trim(),
        password: credential.password,
      };
    }
    case 'private_key':
    case 'certificate':
      throw new Error(
        `Git credential subtype "${credentialSubType}" is not supported for HTTPS repository cloning. Use GitHub Token, GitHub App, User Account, or Secret Text instead.`,
      );
    default:
      throw new Error(`Unsupported Git credential subtype "${credentialSubType}".`);
  }
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
  githubCredentialSubType?: string | null;
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

    const gitCloneAuth = await resolveGitCloneAuth({
      gitRepoUrl: opts.gitRepoUrl,
      githubTokenEncrypted: opts.githubTokenEncrypted,
      githubCredentialSubType: opts.githubCredentialSubType,
    });

    if (gitCloneAuth) {
      // Use GIT_ASKPASS to provide credentials securely without embedding secrets in the repo URL.
      const { writeFile, chmod } = await import('node:fs/promises');
      const askpassPath = join(workdir, '.git-askpass.sh');
      await writeFile(
        askpassPath,
        `#!/bin/sh
case "$1" in
  Username*|*Username*|*username*) printf '%s\\n' "$GIT_AUTH_USERNAME" ;;
  *) printf '%s\\n' "$GIT_AUTH_PASSWORD" ;;
esac
`,
        { mode: 0o700 },
      );
      await chmod(askpassPath, 0o700);
      git.env('GIT_ASKPASS', askpassPath);
      git.env('GIT_TERMINAL_PROMPT', '0');
      git.env('GIT_AUTH_USERNAME', gitCloneAuth.username);
      git.env('GIT_AUTH_PASSWORD', gitCloneAuth.password);
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
