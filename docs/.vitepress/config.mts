import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';
import { DOC_VERSIONS } from './versions.js';

// ─── Versioned docs support ─────────────────────────────────────────
// DOCS_BASE env var overrides the base path for versioned builds.
// DOCS_OUTDIR env var overrides the output directory.
const SITE_BASE = '/open-agent-orchestra';
const base = process.env.DOCS_BASE || `${SITE_BASE}/`;
const outDir = process.env.DOCS_OUTDIR || '../docs-dist';

// Determine current doc version from the base path
const currentLabel = DOC_VERSIONS.find(v =>
  base === `${SITE_BASE}/` ? v.latest : base === `${SITE_BASE}/${v.version}/`,
);

// Build version dropdown items (absolute paths so links work across bases)
const versionDropdown = DOC_VERSIONS.map(v => ({
  text: v.latest ? `${v.version} (latest)` : v.version,
  link: v.latest ? `${SITE_BASE}/` : `${SITE_BASE}/${v.version}/`,
}));

export default withMermaid(
  defineConfig({
    title: 'Open Agent Orchestra',
    description: 'An autonomous AI workflow engine powered by the GitHub Copilot SDK. Build cost-effective AI teams with segregation of duties, secure credential management, and multi-step workflows.',
    base,
    outDir,
    ignoreDeadLinks: [
      /localhost/,
    ],
    head: [
      ['link', { rel: 'icon', type: 'image/png', href: '/open-agent-orchestra/logo.png' }],
    ],
    appearance: true,
    themeConfig: {
      logo: '/logo.png',
      nav: [
        { text: 'Home', link: '/' },
        { text: 'Guide', link: '/guide/what-is-oao' },
        { text: 'Concepts', link: '/concepts/agents' },
        { text: 'Architecture', link: '/architecture/overview' },
        { text: 'Database', link: '/database/schema' },
        { text: 'Reference', link: '/reference/api-endpoints' },
        {
          text: currentLabel?.version || 'Version',
          items: versionDropdown,
        },
      ],
      sidebar: {
        '/guide/': [
          {
            text: 'Getting Started',
            items: [
              { text: 'What is OAO?', link: '/guide/what-is-oao' },
              { text: 'Host on Docker', link: '/guide/docker' },
              { text: 'Host on Kubernetes', link: '/guide/kubernetes' },
            ],
          },
          {
            text: 'Start Development',
            items: [
              { text: 'Build & Deploy', link: '/guide/build-and-deploy' },
              { text: 'File Structure', link: '/guide/file-structure' },
            ],
          },
        ],
        '/concepts/': [
          {
            text: 'Basic',
            items: [
              { text: 'Agents', link: '/concepts/agents' },
              { text: 'Variables', link: '/concepts/variables' },
            ],
          },
          {
            text: 'Automation',
            items: [
              { text: 'Workflows', link: '/concepts/workflows' },
              { text: 'Agent Steps', link: '/concepts/agent-steps' },
              { text: 'Workflow Engine & Controller', link: '/concepts/workflow-engine' },
            ],
          },
          {
            text: 'Security & Access',
            items: [
              { text: 'AI Security', link: '/concepts/security' },
              { text: 'Copilot CLI Security', link: '/concepts/security-copilot-cli' },
              { text: 'RBAC', link: '/concepts/rbac' },
            ],
          },
          {
            text: 'Platform',
            items: [
              { text: 'Workspaces', link: '/concepts/workspaces' },
              { text: 'Plugins', link: '/concepts/plugins' },
              { text: 'Admin', link: '/concepts/admin' },
            ],
          },
        ],
        '/architecture/': [
          {
            text: 'Architecture',
            items: [
              { text: 'System Overview', link: '/architecture/overview' },
              { text: 'Agent Instances', link: '/architecture/agent-instances' },
              { text: 'Request & Trigger Flows', link: '/architecture/request-flows' },
              { text: 'Technologies', link: '/architecture/technologies' },
            ],
          },
        ],
        '/reference/': [
          {
            text: 'Reference',
            items: [
              { text: 'Template Variables', link: '/reference/template-variables' },
              { text: 'Events', link: '/reference/events' },
              { text: 'API Endpoints', link: '/reference/api-endpoints' },
            ],
          },
        ],
        '/database/': [
          {
            text: 'Database',
            items: [
              { text: 'Schema Overview', link: '/database/schema' },
              { text: 'Core Tables', link: '/database/schema-core' },
              { text: 'Support Tables', link: '/database/schema-support' },
            ],
          },
        ],
        '/configuration/': [
          {
            text: 'Configuration',
            items: [
              { text: 'Copilot Sessions', link: '/configuration/copilot' },
            ],
          },
        ],
      },
      socialLinks: [
        { icon: 'github', link: 'https://github.com/thfai2000/open-agent-orchestra' },
      ],
      footer: {
        message: 'Built with the GitHub Copilot SDK',
        copyright: '© 2026 Open Agent Orchestra',
      },
      search: {
        provider: 'local',
      },
    },
    markdown: {
      config: (md) => {
        // Inject a hidden div with the mermaid source after each mermaid fence block.
        // This runs during token processing (core phase) — before the fence renderer.
        // vitepress-plugin-mermaid replaces the fence renderer, but our injected
        // html_block tokens are unaffected by that.
        md.core.ruler.push('mermaid-source-capture', (state) => {
          const inserts: { index: number; token: typeof state.tokens[0] }[] = [];
          for (let i = 0; i < state.tokens.length; i++) {
            const token = state.tokens[i];
            if (token.type === 'fence' && token.info.trim() === 'mermaid') {
              const encoded = Buffer.from(token.content.trim()).toString('base64');
              const htmlToken = new state.Token('html_block', '', 0);
              htmlToken.content = `<div class="mermaid-source" data-mermaid-source="${encoded}"></div>\n`;
              inserts.push({ index: i + 1, token: htmlToken });
            }
          }
          // Insert in reverse so indices stay correct
          for (let j = inserts.length - 1; j >= 0; j--) {
            state.tokens.splice(inserts[j].index, 0, inserts[j].token);
          }
        });
      },
    },
    mermaid: {},
  }),
);
