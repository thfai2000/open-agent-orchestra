<template>
  <div ref="containerRef" :class="['markdown-body max-w-none', `markdown-body--${theme}`]" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { marked } from 'marked';

const props = withDefaults(defineProps<{ content: string; theme?: 'light' | 'dark' }>(), {
  theme: 'light',
});
const containerRef = ref<HTMLElement | null>(null);
const mermaidLoaded = ref(false);

const renderedHtml = computed(() => {
  if (!props.content) return '';
  // Custom renderer: fenced code blocks with language "mermaid" → div.mermaid
  const renderer = new marked.Renderer();
  const originalCode = renderer.code;
  renderer.code = function ({ text, lang }: { text: string; lang?: string; escaped?: boolean }) {
    if (lang === 'mermaid') {
      return `<div class="mermaid">${text}</div>`;
    }
    return originalCode.call(this, { text, lang, escaped: false });
  };
  return marked.parse(props.content, { renderer, breaks: true, gfm: true }) as string;
});

async function loadMermaid() {
  if (mermaidLoaded.value) return;
  if (typeof window === 'undefined') return;
  if ((window as any).mermaid) {
    (window as any).mermaid.initialize({ startOnLoad: false, theme: props.theme === 'dark' ? 'dark' : 'default' });
    mermaidLoaded.value = true;
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
  script.onload = () => {
    (window as any).mermaid.initialize({ startOnLoad: false, theme: props.theme === 'dark' ? 'dark' : 'default' });
    mermaidLoaded.value = true;
  };
  document.head.appendChild(script);
}

async function renderMermaid() {
  if (!containerRef.value) return;
  const mermaidDivs = containerRef.value.querySelectorAll('.mermaid');
  if (mermaidDivs.length === 0) return;
  await loadMermaid();
  await nextTick();
  const mermaid = (window as any).mermaid;
  if (!mermaid) return;
  // Mermaid v11 uses run()
  try {
    mermaid.initialize({ startOnLoad: false, theme: props.theme === 'dark' ? 'dark' : 'default' });
    await mermaid.run({ nodes: mermaidDivs });
  } catch {
    // fallback: re-init
    mermaid.initialize({ startOnLoad: false, theme: props.theme === 'dark' ? 'dark' : 'default' });
    await mermaid.run({ nodes: mermaidDivs });
  }
}

watch([renderedHtml, () => props.theme], async () => {
  await nextTick();
  await renderMermaid();
});

onMounted(async () => {
  await nextTick();
  await renderMermaid();
});
</script>

<style>
.markdown-body {
  font-size: 0.875rem;
  line-height: 1.65;
  word-break: break-word;
}

.markdown-body--light { color: #0f172a; }
.markdown-body--dark { color: #e2e8f0; }

.markdown-body h1 { font-size: 1.5em; font-weight: 700; margin-top: 1em; margin-bottom: 0.5em; }
.markdown-body h2 { font-size: 1.25em; font-weight: 600; margin-top: 0.8em; margin-bottom: 0.4em; }
.markdown-body h3 { font-size: 1.1em; font-weight: 600; margin-top: 0.6em; margin-bottom: 0.3em; }
.markdown-body p { margin: 0.5em 0; line-height: 1.6; }
.markdown-body ul, .markdown-body ol { margin: 0.5em 0; padding-left: 1.5em; }
.markdown-body li { margin: 0.25em 0; }
.markdown-body strong,
.markdown-body em,
.markdown-body span,
.markdown-body td,
.markdown-body th,
.markdown-body a,
.markdown-body blockquote,
.markdown-body p,
.markdown-body li { color: inherit; }
.markdown-body code { padding: 0.15em 0.35em; border-radius: 4px; font-size: 0.875em; }
.markdown-body pre { padding: 1em; border-radius: 8px; overflow-x: auto; margin: 0.75em 0; }
.markdown-body pre code { background: transparent; padding: 0; color: inherit; }
.markdown-body blockquote { border-left: 3px solid #d1d5db; padding-left: 1em; margin: 0.75em 0; }
.markdown-body table { border-collapse: collapse; width: 100%; margin: 0.75em 0; }
.markdown-body th, .markdown-body td { border: 1px solid #e5e7eb; padding: 0.5em 0.75em; text-align: left; }
.markdown-body th { font-weight: 600; }
.markdown-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 1em 0; }
.markdown-body a { text-decoration: underline; }
.markdown-body .mermaid { margin: 1em 0; text-align: center; }
.markdown-body .mermaid svg { max-width: 100%; }

.markdown-body--light code { background: #f1f5f9; color: #0f172a; }
.markdown-body--light pre { background: #0f172a; color: #e2e8f0; }
.markdown-body--light blockquote { border-left-color: #cbd5e1; color: #475569; }
.markdown-body--light th { background: #f8fafc; }
.markdown-body--light td,
.markdown-body--light th,
.markdown-body--light hr { border-color: #e2e8f0; }
.markdown-body--light a { color: #0f766e; }

.markdown-body--dark code { background: #1e293b; color: #e2e8f0; }
.markdown-body--dark pre { background: #020617; color: #e2e8f0; }
.markdown-body--dark blockquote { border-left-color: #475569; color: #cbd5e1; }
.markdown-body--dark th { background: #0f172a; }
.markdown-body--dark td,
.markdown-body--dark th,
.markdown-body--dark hr { border-color: #334155; }
.markdown-body--dark a { color: #67e8f9; }
</style>
