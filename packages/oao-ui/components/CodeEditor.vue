<template>
  <div ref="editorEl" class="cm-host rounded-lg border border-surface-200 overflow-hidden bg-[#282c34]" :style="{ minHeight: height }" />
</template>

<script setup lang="ts">
/**
 * CodeMirror 6 backed editor with YAML highlighting, line numbers,
 * fold gutter, bracket matching and search. Supports a `readonly` mode
 * so the same component is used for both editable and read-only views,
 * preserving visual consistency across the workflow editor and historical
 * version pages.
 */
import { ref, watch, onMounted, onBeforeUnmount, shallowRef } from 'vue';

interface Props {
  modelValue: string;
  language?: 'yaml' | 'javascript';
  readonly?: boolean;
  height?: string;
}
const props = withDefaults(defineProps<Props>(), {
  language: 'yaml',
  readonly: false,
  height: '520px',
});
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const editorEl = ref<HTMLElement | null>(null);
const view = shallowRef<any>(null);
let suppressUpdate = false;

onMounted(async () => {
  if (!editorEl.value) return;
  const [
    { EditorState, Compartment },
    { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap, drawSelection },
    { foldGutter, indentOnInput, bracketMatching, defaultHighlightStyle, syntaxHighlighting },
    { defaultKeymap, history, historyKeymap, indentWithTab },
    { searchKeymap, highlightSelectionMatches },
    { yaml },
    { javascript },
    { oneDark },
  ] = await Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/language'),
    import('@codemirror/commands'),
    import('@codemirror/search'),
    import('@codemirror/lang-yaml'),
    import('@codemirror/lang-javascript'),
    import('@codemirror/theme-one-dark'),
  ]);

  const readonlyCompartment = new Compartment();
  const editableCompartment = new Compartment();

  const updateListener = EditorView.updateListener.of((u: any) => {
    if (u.docChanged && !suppressUpdate) {
      const text = u.state.doc.toString();
      emit('update:modelValue', text);
    }
  });

  const languageExtension = props.language === 'javascript' ? javascript() : yaml();

  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    foldGutter(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    highlightSelectionMatches(),
    history(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    languageExtension,
    oneDark,
    readonlyCompartment.of(EditorState.readOnly.of(props.readonly)),
    editableCompartment.of(EditorView.editable.of(!props.readonly)),
    EditorView.theme({
      '&': { fontSize: '12px', height: props.height },
      '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
      '.cm-content': { padding: '8px 0' },
    }),
    updateListener,
  ];

  const state = EditorState.create({ doc: props.modelValue ?? '', extensions });
  view.value = new EditorView({ state, parent: editorEl.value });

  // Watch external value changes and reflect into editor without echoing back.
  watch(() => props.modelValue, (v) => {
    const current = view.value?.state.doc.toString();
    if (v === current) return;
    suppressUpdate = true;
    view.value?.dispatch({ changes: { from: 0, to: current?.length ?? 0, insert: v ?? '' } });
    suppressUpdate = false;
  });

  watch(() => props.readonly, (ro) => {
    view.value?.dispatch({
      effects: [
        readonlyCompartment.reconfigure(EditorState.readOnly.of(ro)),
        editableCompartment.reconfigure(EditorView.editable.of(!ro)),
      ],
    });
  });
});

onBeforeUnmount(() => {
  view.value?.destroy();
  view.value = null;
});
</script>

<style scoped>
.cm-host :deep(.cm-editor) {
  outline: none;
}
.cm-host :deep(.cm-editor.cm-focused) {
  outline: none;
}
</style>
