<template>
  <div ref="containerRef" class="markdown-body prose prose-sm max-w-none" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { marked } from 'marked';

const props = defineProps<{ content: string }>();
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
    mermaidLoaded.value = true;
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
  script.onload = () => {
    (window as any).mermaid.initialize({ startOnLoad: false, theme: 'default' });
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
    await mermaid.run({ nodes: mermaidDivs });
  } catch {
    // fallback: re-init
    mermaid.initialize({ startOnLoad: false, theme: 'default' });
    await mermaid.run({ nodes: mermaidDivs });
  }
}

watch(renderedHtml, async () => {
  await nextTick();
  await renderMermaid();
});

onMounted(async () => {
  await nextTick();
  await renderMermaid();
});
</script>

<style>
.markdown-body h1 { font-size: 1.5em; font-weight: 700; margin-top: 1em; margin-bottom: 0.5em; }
.markdown-body h2 { font-size: 1.25em; font-weight: 600; margin-top: 0.8em; margin-bottom: 0.4em; }
.markdown-body h3 { font-size: 1.1em; font-weight: 600; margin-top: 0.6em; margin-bottom: 0.3em; }
.markdown-body p { margin: 0.5em 0; line-height: 1.6; }
.markdown-body ul, .markdown-body ol { margin: 0.5em 0; padding-left: 1.5em; }
.markdown-body li { margin: 0.25em 0; }
.markdown-body code { background: #f3f4f6; padding: 0.15em 0.35em; border-radius: 4px; font-size: 0.875em; }
.markdown-body pre { background: #1e293b; color: #e2e8f0; padding: 1em; border-radius: 8px; overflow-x: auto; margin: 0.75em 0; }
.markdown-body pre code { background: transparent; padding: 0; color: inherit; }
.markdown-body blockquote { border-left: 3px solid #d1d5db; padding-left: 1em; color: #6b7280; margin: 0.75em 0; }
.markdown-body table { border-collapse: collapse; width: 100%; margin: 0.75em 0; }
.markdown-body th, .markdown-body td { border: 1px solid #e5e7eb; padding: 0.5em 0.75em; text-align: left; }
.markdown-body th { background: #f9fafb; font-weight: 600; }
.markdown-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 1em 0; }
.markdown-body a { color: #7c3aed; text-decoration: underline; }
.markdown-body .mermaid { margin: 1em 0; text-align: center; }
.markdown-body .mermaid svg { max-width: 100%; }
</style>
