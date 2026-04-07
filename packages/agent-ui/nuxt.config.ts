export default defineNuxtConfig({
  extends: ['../ui-base'],
  devServer: { port: 3002 },
  shadcn: { prefix: '', componentDir: './components/ui' },
  app: {
    head: {
      title: 'Agent Orchestration Platform',
      meta: [{ name: 'description', content: 'Autonomous AI workflow orchestration powered by GitHub Copilot SDK' }],
    },
  },
});
