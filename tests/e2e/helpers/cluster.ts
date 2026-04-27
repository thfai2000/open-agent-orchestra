import bcrypt from 'bcryptjs';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const NAMESPACE = process.env.E2E_K8S_NAMESPACE ?? 'open-agent-orchestra';
const UI_PORT = Number(process.env.E2E_UI_PORT ?? 3002);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4002);
const UI_RESOURCE = process.env.E2E_UI_RESOURCE ?? 'svc/oao-ui';
const API_RESOURCE = process.env.E2E_API_RESOURCE ?? 'svc/oao-api';
const POSTGRES_POD = process.env.E2E_POSTGRES_POD ?? 'postgres-0';
const LDAP_RESOURCE_NAME = process.env.E2E_LDAP_NAME ?? 'oao-test-ldap';
const PORT_FORWARD_STATE_FILE = resolve(process.cwd(), '.playwright-state/oao-ui-port-forward.json');
const API_PORT_FORWARD_STATE_FILE = resolve(process.cwd(), '.playwright-state/oao-api-port-forward.json');
const LOCAL_PROXY_CONTAINER = process.env.E2E_LOCAL_PROXY_CONTAINER ?? 'oao-local-proxy';
const LOCAL_PROXY_DIR = resolve(process.cwd(), '.playwright-state/oao-local-proxy');
const LOCAL_PROXY_CONF = resolve(LOCAL_PROXY_DIR, 'default.conf');
const SUPERADMIN_STATE_FILE = resolve(process.cwd(), '.playwright-state/superadmin-auth-state.json');

interface PortForwardState {
  pid: number;
}

interface SuperAdminAuthState {
  passwordHash: string;
  authProvider: string | null;
}

function runCommand(command: string, args: string[], allowFailure = false) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    const details = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${details ? `: ${details}` : ''}`);
  }
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function quoteForShell(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}

async function isReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

async function isReachableWithHostHeader(url: string, host: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Host: host },
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

function readinessUrl(baseURL: string) {
  if (isOaoHostBaseUrl(baseURL)) {
    return 'http://127.0.0.1/api/auth/providers?workspace=default';
  }
  return baseURL;
}

function writePortForwardState(state: PortForwardState) {
  mkdirSync(dirname(PORT_FORWARD_STATE_FILE), { recursive: true });
  writeFileSync(PORT_FORWARD_STATE_FILE, JSON.stringify(state), 'utf8');
}

function readPortForwardState(): PortForwardState | null {
  if (!existsSync(PORT_FORWARD_STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(PORT_FORWARD_STATE_FILE, 'utf8')) as PortForwardState;
  } catch {
    return null;
  }
}

function isLocalhostBaseUrl(baseURL: string) {
  try {
    const parsed = new URL(baseURL);
    return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && Number(parsed.port || 80) === UI_PORT;
  } catch {
    return false;
  }
}

function isOaoHostBaseUrl(baseURL: string) {
  try {
    const parsed = new URL(baseURL);
    return parsed.hostname === 'oao.local' && Number(parsed.port || 80) === 80;
  } catch {
    return false;
  }
}

function writeProxyConfig() {
  mkdirSync(dirname(LOCAL_PROXY_CONF), { recursive: true });
  writeFileSync(LOCAL_PROXY_CONF, `server {
  listen 80;
  server_name oao.local;

  location /api/ {
    proxy_pass http://host.docker.internal:${API_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://host.docker.internal:${UI_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
`, 'utf8');
}

function ensureDockerProxy() {
  writeProxyConfig();
  runCommand('docker', ['rm', '-f', LOCAL_PROXY_CONTAINER], true);
  runCommand('docker', [
    'run',
    '-d',
    '--restart',
    'unless-stopped',
    '--name',
    LOCAL_PROXY_CONTAINER,
    '-p',
    '80:80',
    '-v',
    `${LOCAL_PROXY_CONF}:/etc/nginx/conf.d/default.conf:ro`,
    'nginx:alpine',
  ]);
}

async function ensureApiForwardReachable() {
  if (await isReachable(`http://127.0.0.1:${API_PORT}/health`)) {
    return;
  }

  const portForward = spawn('kubectl', ['-n', NAMESPACE, 'port-forward', API_RESOURCE, `${API_PORT}:${API_PORT}`], {
    detached: true,
    stdio: 'ignore',
  });
  portForward.unref();
  writeFileSync(API_PORT_FORWARD_STATE_FILE, JSON.stringify({ pid: portForward.pid! }), 'utf8');

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await isReachable(`http://127.0.0.1:${API_PORT}/health`)) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  throw new Error(`Timed out waiting for local API on port ${API_PORT}.`);
}

export async function ensureUiBaseReachable(baseURL: string) {
  const readyUrl = readinessUrl(baseURL);
  const readyCheck = () => isOaoHostBaseUrl(baseURL)
    ? isReachableWithHostHeader(readyUrl, 'oao.local')
    : isReachable(readyUrl);

  if (isOaoHostBaseUrl(baseURL)) {
    const bridgeCommands: string[][] = [
      ['scripts/ensure-local-oao-access.sh'],
      ['scripts/ensure-local-oao-access.sh', 'restart'],
    ];

    for (const args of bridgeCommands) {
      runCommand('bash', args, true);

      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (await readyCheck()) {
          return;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      }
    }

    throw new Error(`Timed out waiting for ${readyUrl} after starting the local oao.local bridge.`);
  }

  if (await readyCheck()) {
    return;
  }

  if (!isLocalhostBaseUrl(baseURL)) {
    throw new Error(`E2E base URL ${baseURL} is unreachable.`);
  }

  const portForward = spawn('kubectl', ['-n', NAMESPACE, 'port-forward', UI_RESOURCE, `${UI_PORT}:${UI_PORT}`], {
    detached: true,
    stdio: 'ignore',
  });
  portForward.unref();
  writePortForwardState({ pid: portForward.pid! });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await readyCheck()) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  throw new Error(`Timed out waiting for ${readyUrl} after starting kubectl port-forward.`);
}

export function stopManagedUiForward() {
  const state = readPortForwardState();
  if (!state?.pid) return;
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch {
    // Ignore already-exited processes.
  }
  rmSync(PORT_FORWARD_STATE_FILE, { force: true });
}

export function stopManagedApiForward() {
  if (!existsSync(API_PORT_FORWARD_STATE_FILE)) return;
  try {
    const state = JSON.parse(readFileSync(API_PORT_FORWARD_STATE_FILE, 'utf8')) as PortForwardState;
    if (state?.pid) {
      process.kill(state.pid, 'SIGTERM');
    }
  } catch {
    // Ignore malformed or already-exited state.
  }
  rmSync(API_PORT_FORWARD_STATE_FILE, { force: true });
}

export function stopManagedLocalProxy() {
  runCommand('docker', ['rm', '-f', LOCAL_PROXY_CONTAINER], true);
  rmSync(LOCAL_PROXY_DIR, { recursive: true, force: true });
}

function runPsql(sql: string) {
  return runCommand('kubectl', [
    '-n', NAMESPACE,
    'exec',
    POSTGRES_POD,
    '--',
    'sh',
    '-lc',
    `export PGPASSWORD="$POSTGRES_PASSWORD"; psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc ${quoteForShell(sql)}`,
  ]).stdout;
}

export function querySingleValue(sql: string) {
  return runPsql(sql);
}

/**
 * Removes the `mail` row from system_settings so the API treats SMTP as
 * unconfigured. Forgot-password requests will then short-circuit instead
 * of trying to dial a stale MailHog cluster IP.
 */
export function clearMailSettings() {
  runPsql(`delete from system_settings where key = 'mail';`);
}

export function deleteLdapAuthProviders() {
  runPsql(`delete from auth_providers where provider_type = 'ldap';`);
}

export function getWebhookRegistrationId(triggerId: string) {
  return runPsql(`select id from webhook_registrations where trigger_id = '${triggerId}' order by created_at desc limit 1;`);
}

export function getWebhookRequestCount(registrationId: string) {
  const result = runPsql(`select request_count from webhook_registrations where id = '${registrationId}' limit 1;`);
  return Number(result || 0);
}

export async function resetSuperAdminPassword(password: string) {
  const hash = await bcrypt.hash(password, 10);
  runPsql(`update users set password_hash = '${hash}', auth_provider = 'database', updated_at = now() where email = 'admin@oao.local';`);
}

export function snapshotSuperAdminAuthState() {
  if (existsSync(SUPERADMIN_STATE_FILE)) {
    return;
  }

  const snapshot = querySingleValue(`select json_build_object('passwordHash', password_hash, 'authProvider', auth_provider) from users where email = 'admin@oao.local' limit 1;`);
  if (!snapshot) {
    return;
  }

  mkdirSync(dirname(SUPERADMIN_STATE_FILE), { recursive: true });
  writeFileSync(SUPERADMIN_STATE_FILE, snapshot, 'utf8');
}

export function restoreSuperAdminAuthState() {
  if (!existsSync(SUPERADMIN_STATE_FILE)) {
    return;
  }

  try {
    const state = JSON.parse(readFileSync(SUPERADMIN_STATE_FILE, 'utf8')) as SuperAdminAuthState;
    if (!state?.passwordHash) {
      return;
    }

    const authProviderValue = state.authProvider
      ? `'${escapeSqlLiteral(state.authProvider)}'`
      : 'NULL';

    runPsql(`update users set password_hash = '${escapeSqlLiteral(state.passwordHash)}', auth_provider = ${authProviderValue}, updated_at = now() where email = 'admin@oao.local';`);
  } finally {
    rmSync(SUPERADMIN_STATE_FILE, { force: true });
  }
}

async function waitForApiPodTcpEndpoint(host: string, port: number, timeoutMs = 60_000) {
  const probe = `node -e 'const net = require("node:net"); const socket = net.createConnection({ host: "${host}", port: ${port} }, () => { socket.end(); process.exit(0); }); socket.setTimeout(2000, () => { socket.destroy(); process.exit(1); }); socket.on("error", () => process.exit(1));'`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = runCommand('kubectl', ['-n', NAMESPACE, 'exec', 'deployment/oao-api', '--', 'sh', '-lc', probe], true);
    if (result.ok) {
      return;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }

  throw new Error(`Timed out waiting for ${host}:${port} to accept TCP connections from the API pod.`);
}

export async function ensureClusterLdap() {
  const podExists = runCommand('kubectl', ['-n', NAMESPACE, 'get', 'pod', LDAP_RESOURCE_NAME], true).ok;
  if (!podExists) {
    runCommand('kubectl', ['-n', NAMESPACE, 'run', LDAP_RESOURCE_NAME, '--image=dwimberger/ldap-ad-it', '--restart=Never', '--port=10389']);
  }

  const svcExists = runCommand('kubectl', ['-n', NAMESPACE, 'get', 'svc', LDAP_RESOURCE_NAME], true).ok;
  if (!svcExists) {
    runCommand('kubectl', ['-n', NAMESPACE, 'expose', 'pod', LDAP_RESOURCE_NAME, `--name=${LDAP_RESOURCE_NAME}`, '--port=10389', '--target-port=10389']);
  }

  runCommand('kubectl', ['-n', NAMESPACE, 'wait', '--for=condition=Ready', `pod/${LDAP_RESOURCE_NAME}`, '--timeout=180s']);
  await waitForApiPodTcpEndpoint(LDAP_RESOURCE_NAME, 10389);
  return `ldap://${LDAP_RESOURCE_NAME}:10389`;
}

export function cleanupClusterLdap() {
  runCommand('kubectl', ['-n', NAMESPACE, 'delete', 'svc', LDAP_RESOURCE_NAME, '--ignore-not-found'], true);
  runCommand('kubectl', ['-n', NAMESPACE, 'delete', 'pod', LDAP_RESOURCE_NAME, '--ignore-not-found'], true);
}

// ─────────────────────────────────────────────────────────────────────────
// MailHog (in-cluster fake SMTP server) for forgot-password / mail tests.
// ─────────────────────────────────────────────────────────────────────────

const MAILHOG_RESOURCE_NAME = process.env.E2E_MAILHOG_NAME ?? 'oao-test-mailhog';

export interface MailhogTarget {
  host: string;     // cluster-internal SMTP host
  port: number;     // SMTP port (1025)
  httpHost: string; // cluster-internal HTTP host for the v2 API
  httpPort: number; // HTTP port (8025)
}

export async function ensureClusterMailhog(): Promise<MailhogTarget> {
  const manifest = `apiVersion: v1
kind: Pod
metadata:
  name: ${MAILHOG_RESOURCE_NAME}
  namespace: ${NAMESPACE}
  labels:
    app: ${MAILHOG_RESOURCE_NAME}
spec:
  restartPolicy: Never
  containers:
    - name: mailhog
      image: mailhog/mailhog:latest
      ports:
        - name: smtp
          containerPort: 1025
          protocol: TCP
        - name: http
          containerPort: 8025
          protocol: TCP
---
apiVersion: v1
kind: Service
metadata:
  name: ${MAILHOG_RESOURCE_NAME}
  namespace: ${NAMESPACE}
spec:
  selector:
    app: ${MAILHOG_RESOURCE_NAME}
  ports:
    - name: smtp
      port: 1025
      targetPort: 1025
      protocol: TCP
    - name: http
      port: 8025
      targetPort: 8025
      protocol: TCP
`;
  const apply = spawnSync('kubectl', ['apply', '-f', '-'], { input: manifest, encoding: 'utf8' });
  if (apply.status !== 0) {
    throw new Error(`Failed to apply MailHog manifest: ${(apply.stderr || apply.stdout || '').trim()}`);
  }
  runCommand('kubectl', ['-n', NAMESPACE, 'wait', '--for=condition=Ready', `pod/${MAILHOG_RESOURCE_NAME}`, '--timeout=180s']);
  await waitForApiPodTcpEndpoint(MAILHOG_RESOURCE_NAME, 1025);
  return { host: MAILHOG_RESOURCE_NAME, port: 1025, httpHost: MAILHOG_RESOURCE_NAME, httpPort: 8025 };
}

export function cleanupClusterMailhog() {
  runCommand('kubectl', ['-n', NAMESPACE, 'delete', 'svc', MAILHOG_RESOURCE_NAME, '--ignore-not-found'], true);
  runCommand('kubectl', ['-n', NAMESPACE, 'delete', 'pod', MAILHOG_RESOURCE_NAME, '--ignore-not-found'], true);
}

/**
 * Query the in-cluster MailHog HTTP API from the host by exec'ing into the
 * oao-api pod (which has Node available) and using fetch. Returns the raw
 * v2 response body (deserialized).
 */
export async function getMailhogMessages(target: MailhogTarget): Promise<{ items: Array<{ Content: { Headers: Record<string, string[]>; Body: string }; To: Array<{ Mailbox: string; Domain: string }> }> }> {
  // Find the oao-api pod (label selector is app=oao-api per Helm chart).
  const podRes = runCommand('kubectl', ['-n', NAMESPACE, 'get', 'pod', '-l', 'app=oao-api', '-o', 'jsonpath={.items[0].metadata.name}'], true);
  if (!podRes.ok || !podRes.stdout) throw new Error('Could not locate oao-api pod for MailHog query');
  const pod = podRes.stdout.trim();
  const url = `http://${target.httpHost}:${target.httpPort}/api/v2/messages`;
  const result = runCommand('kubectl', ['-n', NAMESPACE, 'exec', pod, '--', 'node', '-e', `fetch(${JSON.stringify(url)}).then(r=>r.text()).then(t=>process.stdout.write(t))`], true);
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[getMailhogMessages] kubectl exec failed: ${result.stderr || result.stdout}`);
    return { items: [] };
  }
  try {
    return JSON.parse(result.stdout) as { items: Array<{ Content: { Headers: Record<string, string[]>; Body: string }; To: Array<{ Mailbox: string; Domain: string }> }> };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[getMailhogMessages] non-JSON response: ${result.stdout.slice(0, 200)}`);
    return { items: [] };
  }
}

/**
 * Poll the MailHog inbox repeatedly inside a single kubectl exec — much
 * faster than dispatching a new exec per attempt. Resolves with the inbox
 * contents as soon as it has any items, or empty if the deadline elapses.
 */
export async function waitForMailhogMessages(target: MailhogTarget, opts: { timeoutMs?: number; intervalMs?: number; recipient?: string } = {}): Promise<{ items: Array<{ Content: { Headers: Record<string, string[]>; Body: string }; To: Array<{ Mailbox: string; Domain: string }> }> }> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const intervalMs = opts.intervalMs ?? 500;
  const podRes = runCommand('kubectl', ['-n', NAMESPACE, 'get', 'pod', '-l', 'app=oao-api', '-o', 'jsonpath={.items[0].metadata.name}'], true);
  if (!podRes.ok || !podRes.stdout) throw new Error('Could not locate oao-api pod for MailHog query');
  const pod = podRes.stdout.trim();
  const url = `http://${target.httpHost}:${target.httpPort}/api/v2/messages`;
  const recipient = opts.recipient ?? '';
  const script = `
    const url = ${JSON.stringify(url)};
    const recipient = ${JSON.stringify(recipient)};
    const deadline = Date.now() + ${timeoutMs};
    (async () => {
      while (Date.now() < deadline) {
        try {
          const r = await fetch(url);
          const t = await r.text();
          const j = JSON.parse(t);
          if (j.items && j.items.length > 0) {
            if (!recipient) { process.stdout.write(t); process.exit(0); }
            const match = j.items.find((m) => (m.To || []).some((to) => (to.Mailbox + '@' + to.Domain) === recipient));
            if (match) { process.stdout.write(t); process.exit(0); }
          }
        } catch (e) {}
        await new Promise((r) => setTimeout(r, ${intervalMs}));
      }
      try {
        const r = await fetch(url);
        const t = await r.text();
        process.stdout.write(t);
      } catch (e) { process.stdout.write('{"items":[]}'); }
      process.exit(0);
    })();
  `;
  const result = runCommand('kubectl', ['-n', NAMESPACE, 'exec', pod, '--', 'node', '-e', script], true);
  if (!result.ok) {
    return { items: [] };
  }
  try {
    return JSON.parse(result.stdout) as { items: Array<{ Content: { Headers: Record<string, string[]>; Body: string }; To: Array<{ Mailbox: string; Domain: string }> }> };
  } catch {
    return { items: [] };
  }
}

export async function clearMailhog(target: MailhogTarget): Promise<void> {
  const podRes = runCommand('kubectl', ['-n', NAMESPACE, 'get', 'pod', '-l', 'app=oao-api', '-o', 'jsonpath={.items[0].metadata.name}'], true);
  if (!podRes.ok || !podRes.stdout) return;
  const pod = podRes.stdout.trim();
  const url = `http://${target.httpHost}:${target.httpPort}/api/v1/messages`;
  runCommand('kubectl', ['-n', NAMESPACE, 'exec', pod, '--', 'node', '-e', `fetch(${JSON.stringify(url)}, { method: 'DELETE' }).then(()=>process.exit(0))`], true);
}

export function uniqueName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function uniqueEmail(prefix = 'e2e') {
  return `${uniqueName(prefix)}@example.com`;
}