import DefaultTheme from 'vitepress/theme';
import { onMounted, watch } from 'vue';
import { useRoute } from 'vitepress';
import './mermaid-zoom.css';

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute();
    onMounted(() => {
      // Mermaid renders asynchronously — retry a few times
      addMermaidLinks();
      setTimeout(addMermaidLinks, 800);
      setTimeout(addMermaidLinks, 2000);
    });
    watch(() => route.path, () => {
      setTimeout(addMermaidLinks, 500);
      setTimeout(addMermaidLinks, 1500);
    });
  },
};

async function encodeMermaidLiveUrl(code: string): Promise<string> {
  const json = JSON.stringify({
    code,
    mermaid: { theme: 'default' },
    autoSync: true,
    updateDiagram: true,
  });

  // CompressionStream('deflate') produces zlib format — same as pako.deflate()
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate'));
      const buffer = await new Response(stream).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return `https://mermaid.live/edit#pako:${b64}`;
    } catch { /* fall through to fallback */ }
  }

  // Fallback: plain base64 encoding
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return `https://mermaid.live/edit#base64:${b64}`;
}

function addMermaidLinks() {
  document.querySelectorAll<HTMLElement>('.mermaid-source[data-mermaid-source]').forEach((el) => {
    if (el.dataset.linked) return;
    el.dataset.linked = '1';

    const source = atob(el.dataset.mermaidSource!);
    const container = el.previousElementSibling as HTMLElement | null;
    if (!container) return;

    // Wrap diagram + link together
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid-diagram-wrapper';
    container.parentNode!.insertBefore(wrapper, container);
    wrapper.appendChild(container);
    wrapper.appendChild(el); // move hidden div into wrapper too

    const link = document.createElement('a');
    link.className = 'mermaid-live-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '↗ Open in Mermaid Live Editor';
    link.href = '#';
    wrapper.appendChild(link);

    encodeMermaidLiveUrl(source).then((url) => {
      link.href = url;
    });
  });
}
