<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-200 bg-white px-4 py-3">
      <div class="flex flex-wrap items-center gap-2">
        <Tag value="YAML View" severity="info" />
        <Tag v-if="readonly" value="Read-only" severity="secondary" />
        <Tag :value="`${nodeCount} blocks`" severity="secondary" />
        <Tag :value="`${edgeCount} edges`" severity="secondary" />
        <Tag :value="`${triggerCount} triggers`" severity="secondary" />
        <Tag v-if="dirty && !readonly" value="Unsaved changes" severity="warn" />
      </div>
      <div class="flex flex-wrap gap-2">
        <Button label="Reload" icon="pi pi-refresh" severity="secondary" outlined size="small" :disabled="saving" @click="loadYaml" />
        <Button v-if="!readonly" label="Format" icon="pi pi-align-left" severity="secondary" outlined size="small" :disabled="!yamlText" @click="formatYaml" />
        <Button v-if="!readonly" label="Save YAML" icon="pi pi-check" severity="primary" size="small" :loading="saving" :disabled="!dirty || !!parseError" @click="saveYaml" />
      </div>
    </div>
    <Message v-if="errorMsg" severity="error" :closable="true" @close="errorMsg = null">{{ errorMsg }}</Message>
    <Message v-if="parseError" severity="warn" :closable="false">YAML parse error: {{ parseError }}</Message>
    <Message v-if="okMsg" severity="success" :closable="true" @close="okMsg = null">{{ okMsg }}</Message>
    <CodeEditor v-model="yamlText" language="yaml" :readonly="readonly" height="560px" @update:modelValue="onChange" />
    <p class="text-xs text-surface-400">
      The YAML representation captures workflow blocks (nodes), edges, and triggers.
      <span v-if="!readonly">Editing here saves back to the same graph as the Visual Editor.</span>
      <span v-else>Read-only snapshot of a historical workflow version.</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';

interface Props { workflowId: string; readonly?: boolean; versionData?: GraphPayload | null }
const props = withDefaults(defineProps<Props>(), { readonly: false, versionData: null });
const emit = defineEmits<{ saved: []; triggersChanged: [] }>();

const { authHeaders } = useAuth();
const headers = authHeaders();

const yamlText = ref('');
const lastLoaded = ref('');
const dirty = ref(false);
const saving = ref(false);
const errorMsg = ref<string | null>(null);
const okMsg = ref<string | null>(null);
const parseError = ref<string | null>(null);

const parsed = computed(() => {
  if (!yamlText.value.trim()) { parseError.value = null; return null; }
  try {
    const obj = yamlParse(yamlText.value);
    parseError.value = null;
    return obj;
  } catch (e) {
    parseError.value = e instanceof Error ? e.message : String(e);
    return null;
  }
});

const nodeCount = computed(() => Array.isArray(parsed.value?.blocks) ? parsed.value.blocks.length : 0);
const edgeCount = computed(() => Array.isArray(parsed.value?.edges) ? parsed.value.edges.length : 0);
const triggerCount = computed(() => Array.isArray(parsed.value?.triggers) ? parsed.value.triggers.length : 0);

function onChange() {
  dirty.value = yamlText.value !== lastLoaded.value;
}

function formatYaml() {
  if (!parsed.value) return;
  const formatted = yamlStringify(parsed.value, { lineWidth: 100 });
  yamlText.value = formatted;
  onChange();
}

interface GraphPayload {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  triggers: Array<Record<string, unknown>>;
}

function toYaml(graph: GraphPayload): string {
  const blocks = (graph.nodes || []).map((n: any) => ({
    key: n.nodeKey,
    type: n.nodeType,
    name: n.name,
    position: { x: n.positionX ?? 0, y: n.positionY ?? 0 },
    config: n.config && Object.keys(n.config).length ? n.config : undefined,
  }));
  const edges = (graph.edges || []).map((e: any) => ({
    from: e.fromNodeKey,
    to: e.toNodeKey,
    branch: e.branchKey || undefined,
  }));
  const triggers = (graph.triggers || []).map((t: any) => ({
    id: t.id,
    type: t.triggerType,
    active: t.isActive !== false,
    entryStepKey: t.entryStepKey || undefined,
    configuration: t.configuration || {},
  }));
  return yamlStringify({
    blocks,
    edges,
    triggers,
  }, { lineWidth: 100 });
}

interface YamlGraphInput {
  blocks?: Array<{ key: string; type: string; name?: string; position?: { x?: number; y?: number }; config?: Record<string, unknown> }>;
  edges?: Array<{ from: string; to: string; branch?: string }>;
}

function fromYaml(obj: YamlGraphInput): { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } {
  const nodes = (obj.blocks || []).map((b) => ({
    nodeKey: b.key,
    nodeType: b.type,
    name: b.name || b.key,
    config: b.config || {},
    positionX: b.position?.x ?? 0,
    positionY: b.position?.y ?? 0,
  }));
  const edges = (obj.edges || []).map((e) => ({
    fromNodeKey: e.from,
    toNodeKey: e.to,
    branchKey: e.branch || null,
  }));
  return { nodes, edges };
}

async function loadYaml() {
  errorMsg.value = null;
  okMsg.value = null;
  try {
    let graph: GraphPayload;
    if (props.versionData) {
      graph = props.versionData;
    } else {
      graph = await $fetch<GraphPayload>(`/api/workflow-graph/${props.workflowId}/graph`, { headers });
    }
    const text = toYaml(graph);
    yamlText.value = text;
    lastLoaded.value = text;
    dirty.value = false;
  } catch (e: any) {
    errorMsg.value = e?.data?.error || 'Failed to load YAML.';
  }
}

async function saveYaml() {
  if (props.readonly) return;
  if (!parsed.value) { errorMsg.value = 'Cannot save — YAML has parse errors.'; return; }
  saving.value = true;
  errorMsg.value = null;
  okMsg.value = null;
  try {
    const { nodes, edges } = fromYaml(parsed.value);
    await $fetch(`/api/workflow-graph/${props.workflowId}/graph`, { method: 'PUT', headers, body: { nodes, edges } });
    // Triggers (if present in YAML and changed) — only update entryStepKey/active here for safety.
    if (Array.isArray(parsed.value.triggers)) {
      for (const t of parsed.value.triggers) {
        if (!t || !t.id) continue;
        try {
          await $fetch(`/api/triggers/${t.id}`, {
            method: 'PUT', headers,
            body: {
              isActive: t.active !== false,
              entryStepKey: t.entryStepKey ?? null,
              configuration: t.configuration ?? undefined,
            },
          });
        } catch {
          // ignore individual trigger failure; main graph saved
        }
      }
      emit('triggersChanged');
    }
    okMsg.value = 'YAML saved successfully.';
    await loadYaml();
    emit('saved');
  } catch (e: any) {
    errorMsg.value = `Save failed: ${e?.data?.error || e?.message || 'unknown'}`;
  } finally {
    saving.value = false;
  }
}

await loadYaml();
</script>
