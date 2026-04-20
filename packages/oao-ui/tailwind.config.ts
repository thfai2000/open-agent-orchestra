import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: [
    './components/**/*.{vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './app.vue',
    '../ui-base/components/**/*.{vue,ts}',
  ],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
