// scripts/screenshots.mjs — Generate screenshots of OAO platform using Playwright
// Usage: node scripts/screenshots.mjs [base-url]
// Default base-url: http://oao.local (via ingress)

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs', 'public', 'screenshots');
const BASE_URL = process.argv[2] || 'http://oao.local';

// Superadmin credentials — override via env vars if needed
const EMAIL = process.env.OAO_EMAIL || 'admin@oao.local';
const PASSWORD = process.env.OAO_PASSWORD || '';

if (!PASSWORD) {
  console.error('Error: OAO_PASSWORD env var is required.');
  console.error('  Find the superadmin password:');
  console.error('  kubectl -n open-agent-orchestra logs job/oao-platform-db-migrate | grep -A 5 "SUPERADMIN"');
  console.error('');
  console.error('Usage: OAO_PASSWORD=<password> node scripts/screenshots.mjs [base-url]');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const PAGES = [
  { name: 'login',       path: '/default/login',        skipAuth: true },
  { name: 'dashboard',   path: '/default'                              },
  { name: 'agents',      path: '/default/agents'                       },
  { name: 'workflows',   path: '/default/workflows'                    },
  { name: 'executions',  path: '/default/executions'                   },
  { name: 'variables',   path: '/default/variables'                    },
  { name: 'plugins',     path: '/default/plugins'                      },
  { name: 'settings',    path: '/default/settings/change-password'     },
];

async function main() {
  console.log(`\nScreenshotting OAO at ${BASE_URL}`);
  console.log(`Output: ${OUT_DIR}\n`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });

  // ── Login ────────────────────────────────────────────────────────────
  const page = await context.newPage();

  // Screenshot login page first (before auth)
  await page.goto(`${BASE_URL}/default/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT_DIR, 'login.png'), fullPage: true });
  console.log('  ✓ login.png');

  // Perform login
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/default', { timeout: 10000 });
  await page.waitForTimeout(1000);

  // ── Authenticated pages ──────────────────────────────────────────────
  for (const { name, path, skipAuth } of PAGES) {
    if (skipAuth) continue; // already captured
    try {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: true });
      console.log(`  ✓ ${name}.png`);
    } catch (err) {
      console.error(`  ✗ ${name}: ${err.message}`);
    }
  }

  await browser.close();
  console.log(`\nDone — ${PAGES.length} screenshots saved to docs/public/screenshots/\n`);
}

main().catch((err) => {
  console.error('Screenshot generation failed:', err.message);
  process.exit(1);
});
