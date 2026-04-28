import { readFileSync } from 'node:fs';
import Aura from '@primevue/themes/aura';
import { definePreset } from '@primevue/themes';

const rootPackage = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version?: string;
};

const OaoPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{violet.50}',
      100: '{violet.100}',
      200: '{violet.200}',
      300: '{violet.300}',
      400: '{violet.400}',
      500: '{violet.500}',
      600: '{violet.600}',
      700: '{violet.700}',
      800: '{violet.800}',
      900: '{violet.900}',
      950: '{violet.950}',
    },
  },
});

export default defineNuxtConfig({
  extends: ['../ui-base'],
  devServer: { port: 3002 },
  runtimeConfig: {
    public: {
      appVersion: process.env.NUXT_PUBLIC_APP_VERSION || rootPackage.version || '0.0.0',
    },
  },
  modules: ['@primevue/nuxt-module'],
  primevue: {
    options: {
      theme: {
        preset: OaoPreset,
        options: {
          darkModeSelector: '.dark',
        },
      },
    },
  },
  css: ['primeicons/primeicons.css'],
  app: {
    head: {
      title: 'OAO — Open Agent Orchestra',
      meta: [{ name: 'description', content: 'Autonomous AI workflow orchestration powered by GitHub Copilot SDK' }],
    },
  },
});
