<template>
  <div>
    <Message v-if="loadError" severity="error" :closable="false" class="mb-3">{{ loadError }}</Message>

    <div v-if="loading" class="py-8 text-sm text-surface-400">Loading graph…</div>

    <div v-else-if="nodes.length === 0" class="py-8 text-sm text-surface-400">No graph nodes recorded for this execution.</div>

    <div v-else class="grid grid-cols-12 gap-4">
      <!-- ─── Canvas ──────────────────────────────────────── -->
      <div class="col-span-12 lg:col-span-7">
        <div class="border border-surface-200 rounded-lg bg-surface-50 overflow-auto" style="height: 560px">
          <svg :width="canvasWidth" :height="canvasHeight" @click="selectedKey = null">
            <defs>
              <marker id="exec-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
              </marker>
            </defs>

            <!-- Edges -->
            <g>
              <line
                v-for="(e, i) in edges"
                :key="`edge-${i}`"
                v-bind="edgeCoords(e)"
                stroke="#94a3b8"
                stroke-width="1.5"
                marker-end="url(#exec-arrow)"
                class="transition-colors"
              />
            </g>

            <!-- Nodes -->
            <g v-for="n in nodes" :key="n.nodeKey" :transform="`translate(${pos[n.nodeKey].x}, ${pos[n.nodeKey].y})`" class="cursor-pointer" @click.stop="selectedKey = n.nodeKey">
              <rect
                :width="nodeWidth"
                :height="nodeHeight"
                rx="10"
                :fill="nodeFill(n.nodeKey)"
                :stroke="selectedKey === n.nodeKey ? '#2563eb' : nodeStroke(n.nodeKey)"
                :stroke-width="selectedKey === n.nodeKey ? 2.5 : 1.5"
              />
              <!-- Status ball -->
              <circle :cx="14" :cy="16" r="5" :fill="statusBallFill(n.nodeKey)" :class="statusBallClass(n.nodeKey)" />
              <text :x="28" :y="20" font-size="11" font-weight="600" fill="#0f172a">{{ truncate(n.label || n.nodeKey, 22) }}</text>
              <text :x="14" :y="38" font-size="10" fill="#64748b">{{ n.nodeType }}</text>
              <text :x="14" :y="54" font-size="10" :fill="statusTextColor(n.nodeKey)">{{ statusLabel(n.nodeKey) }}</text>
              <!-- Awaiting input pulse -->
              <circle
                v-if="isAwaitingInput(n.nodeKey)"
                :cx="nodeWidth - 14"
                :cy="16"
                r="6"
                fill="#f59e0b"
                class="animate-pulse"
              >
                <title>Awaiting user input</title>
              </circle>
            </g>
          </svg>
        </div>
        <div class="flex flex-wrap items-center gap-3 mt-3 text-xs text-surface-500">
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>Completed</span>
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>Running</span>
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>Awaiting input</span>
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span>Failed</span>
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-surface-300"></span>Pending</span>
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-surface-400"></span>Skipped</span>
        </div>
      </div>

      <!-- ─── Side panel ─────────────────────────────────── -->
      <div class="col-span-12 lg:col-span-5">
        <div v-if="!selected" class="border border-dashed border-surface-300 rounded-lg p-6 text-sm text-surface-500 text-center">
          Click a node to inspect its input, output, logs, and any pending questions.
        </div>

        <div v-else class="border border-surface-200 rounded-lg bg-white">
          <div class="px-4 py-3 border-b border-surface-200 flex items-center justify-between">
            <div>
              <p class="font-semibold text-sm">{{ selected.label || selected.nodeKey }}</p>
              <p class="text-xs text-surface-500">{{ selected.nodeType }} · {{ selected.nodeKey }}</p>
            </div>
            <Tag :value="statusLabel(selected.nodeKey)" :severity="statusSeverity(selected.nodeKey)" />
          </div>

          <Tabs value="output" class="px-1">
            <TabList>
              <Tab value="output">Output</Tab>
              <Tab value="input">Input</Tab>
              <Tab value="logs">Logs</Tab>
              <Tab v-if="askForSelected" value="ask">Question</Tab>
            </TabList>
            <TabPanels>
              <TabPanel value="output">
                <pre class="text-xs whitespace-pre-wrap break-words p-3 max-h-[420px] overflow-auto bg-surface-50 rounded">{{ formatJson(execForSelected?.output) || '(no output)' }}</pre>
                <Message v-if="execForSelected?.error" severity="error" :closable="false" class="mt-2 m-3">{{ execForSelected.error }}</Message>
              </TabPanel>
              <TabPanel value="input">
                <pre class="text-xs whitespace-pre-wrap break-words p-3 max-h-[420px] overflow-auto bg-surface-50 rounded">{{ formatJson(execForSelected?.input) || formatJson(selected.config) || '(no input recorded)' }}</pre>
              </TabPanel>
              <TabPanel value="logs">
                <div v-if="logsForSelected.length === 0" class="text-xs text-surface-500 p-3">No logs streamed for this node yet.</div>
                <ul v-else class="text-xs p-3 space-y-1.5 max-h-[420px] overflow-auto">
                  <li v-for="(log, i) in logsForSelected" :key="i" class="flex gap-2">
                    <span class="text-surface-400 tabular-nums">{{ log.time }}</span>
                    <span class="font-medium text-surface-700">{{ log.type }}</span>
                    <span class="text-surface-500 truncate">{{ log.summary }}</span>
                  </li>
                </ul>
              </TabPanel>
              <TabPanel v-if="askForSelected" value="ask">
                <div class="p-3">
                  <AgentAskQuestionsForm
                    :ask="askForSelected"
                    :submitting="submittingAsk"
                    @submit="handleAskSubmit"
                  />
                </div>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Execution graph visualization — read-only SVG view of a graph-mode workflow
 * execution. Loads the workflow's nodes/edges template plus the per-execution
 * node statuses, lays them out by topological depth, and lets the user click
 * any node to inspect its I/O, logs, and pending ask_questions form.
 *
 * Realtime: subscribes to events emitted by the parent's useExecutionStream
 * via the `streamEvents` prop (push events array). Updates statuses and
 * collects log lines per node.
 */

interface NodeDef { nodeKey: string; nodeType: string; label?: string | null; config?: unknown; }
interface EdgeDef { fromNodeKey: string; toNodeKey: string; condition?: string | null; }
interface NodeExec {
  id: string;
  workflowExecutionId: string;
  nodeKey: string;
  status: 'pending' | 'running' | 'awaiting_input' | 'completed' | 'failed' | 'skipped';
  input?: unknown;
  output?: unknown;
  error?: string | null;
  stepExecutionId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

const props = defineProps<{
  workflowId: string;
  executionId: string;
  streamEvents: Array<{ type: string; data: any; receivedAt: string }>;
}>();

const { authHeaders } = useAuth();
const headers = authHeaders();

const nodes = ref<NodeDef[]>([]);
const edges = ref<EdgeDef[]>([]);
const execs = ref<NodeExec[]>([]);
const loading = ref(true);
const loadError = ref('');
const selectedKey = ref<string | null>(null);
const submittingAsk = ref(false);

// Pending ask_questions per node. Key = nodeKey.
const pendingAsks = ref<Record<string, any>>({});
// Logs per node.
const nodeLogs = ref<Record<string, Array<{ time: string; type: string; summary: string }>>>({});

const nodeWidth = 180;
const nodeHeight = 64;
const colGap = 60;
const rowGap = 30;
const padding = 24;

// ─── Auto-layout: depth via BFS from nodes with no incoming edges ──
const pos = computed<Record<string, { x: number; y: number; depth: number; row: number }>>(() => {
  const adj: Record<string, string[]> = {};
  const indeg: Record<string, number> = {};
  for (const n of nodes.value) {
    adj[n.nodeKey] = [];
    indeg[n.nodeKey] = 0;
  }
  for (const e of edges.value) {
    if (adj[e.fromNodeKey] !== undefined && indeg[e.toNodeKey] !== undefined) {
      adj[e.fromNodeKey].push(e.toNodeKey);
      indeg[e.toNodeKey]++;
    }
  }
  const depth: Record<string, number> = {};
  const queue: string[] = [];
  for (const n of nodes.value) if ((indeg[n.nodeKey] ?? 0) === 0) { depth[n.nodeKey] = 0; queue.push(n.nodeKey); }
  while (queue.length > 0) {
    const k = queue.shift()!;
    for (const next of adj[k] ?? []) {
      depth[next] = Math.max(depth[next] ?? 0, (depth[k] ?? 0) + 1);
      indeg[next]--;
      if (indeg[next] === 0) queue.push(next);
    }
  }
  // Group by depth, then assign rows
  const byDepth: Record<number, string[]> = {};
  for (const n of nodes.value) {
    const d = depth[n.nodeKey] ?? 0;
    (byDepth[d] ||= []).push(n.nodeKey);
  }
  const out: Record<string, { x: number; y: number; depth: number; row: number }> = {};
  for (const dStr of Object.keys(byDepth)) {
    const d = Number(dStr);
    byDepth[d].forEach((k, row) => {
      out[k] = {
        depth: d,
        row,
        x: padding + d * (nodeWidth + colGap),
        y: padding + row * (nodeHeight + rowGap),
      };
    });
  }
  return out;
});

const canvasWidth = computed(() => {
  const maxX = Math.max(0, ...Object.values(pos.value).map(p => p.x + nodeWidth));
  return Math.max(720, maxX + padding);
});
const canvasHeight = computed(() => {
  const maxY = Math.max(0, ...Object.values(pos.value).map(p => p.y + nodeHeight));
  return Math.max(380, maxY + padding);
});

function edgeCoords(e: EdgeDef) {
  const a = pos.value[e.fromNodeKey];
  const b = pos.value[e.toNodeKey];
  if (!a || !b) return { x1: 0, y1: 0, x2: 0, y2: 0 };
  return {
    x1: a.x + nodeWidth,
    y1: a.y + nodeHeight / 2,
    x2: b.x,
    y2: b.y + nodeHeight / 2,
  };
}

// ─── Status helpers ────────────────────────────────────────────────
function nodeExec(key: string): NodeExec | undefined {
  return execs.value.find(e => e.nodeKey === key);
}
function status(key: string): NodeExec['status'] | 'pending' {
  return nodeExec(key)?.status ?? 'pending';
}
function isAwaitingInput(key: string): boolean {
  return status(key) === 'awaiting_input' || !!pendingAsks.value[key];
}
function nodeFill(key: string): string {
  const s = status(key);
  if (s === 'completed') return '#ecfdf5';
  if (s === 'running') return '#ecfdf5';
  if (s === 'failed') return '#fef2f2';
  if (s === 'awaiting_input') return '#fffbeb';
  if (s === 'skipped') return '#f5f5f4';
  return '#ffffff';
}
function nodeStroke(key: string): string {
  const s = status(key);
  if (s === 'completed') return '#10b981';
  if (s === 'running') return '#10b981';
  if (s === 'failed') return '#ef4444';
  if (s === 'awaiting_input') return '#f59e0b';
  if (s === 'skipped') return '#a8a29e';
  return '#cbd5e1';
}
function statusBallFill(key: string): string {
  const s = status(key);
  if (s === 'completed') return '#10b981';
  if (s === 'running') return '#10b981';
  if (s === 'failed') return '#ef4444';
  if (s === 'awaiting_input') return '#f59e0b';
  if (s === 'skipped') return '#a8a29e';
  return '#cbd5e1';
}
function statusBallClass(key: string): string {
  const s = status(key);
  return s === 'running' || s === 'awaiting_input' ? 'animate-pulse' : '';
}
function statusTextColor(key: string): string {
  const s = status(key);
  if (s === 'failed') return '#b91c1c';
  if (s === 'completed') return '#047857';
  if (s === 'awaiting_input') return '#b45309';
  return '#64748b';
}
function statusLabel(key: string): string {
  const s = status(key);
  return s.replace('_', ' ');
}
function statusSeverity(key: string): string {
  const s = status(key);
  if (s === 'completed') return 'success';
  if (s === 'failed') return 'danger';
  if (s === 'running') return 'info';
  if (s === 'awaiting_input') return 'warn';
  return 'secondary';
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.substring(0, n - 1) + '…' : s;
}
function formatJson(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

const selected = computed<NodeDef | null>(() => nodes.value.find(n => n.nodeKey === selectedKey.value) ?? null);
const execForSelected = computed<NodeExec | undefined>(() => selectedKey.value ? nodeExec(selectedKey.value) : undefined);
const askForSelected = computed(() => selectedKey.value ? pendingAsks.value[selectedKey.value] : null);
const logsForSelected = computed(() => selectedKey.value ? (nodeLogs.value[selectedKey.value] ?? []) : []);

// ─── Initial load ─────────────────────────────────────────────────
async function reload() {
  loading.value = true;
  loadError.value = '';
  try {
    const [graph, runtime] = await Promise.all([
      $fetch<{ workflow: any; nodes: NodeDef[]; edges: EdgeDef[] }>(
        `/api/workflow-graph/${props.workflowId}/graph`,
        { headers },
      ),
      $fetch<{ nodeExecutions: NodeExec[] }>(
        `/api/workflow-graph/executions/${props.executionId}/nodes`,
        { headers },
      ),
    ]);
    nodes.value = graph.nodes ?? [];
    edges.value = graph.edges ?? [];
    execs.value = runtime.nodeExecutions ?? [];
  } catch (e: any) {
    loadError.value = e?.data?.error || 'Failed to load execution graph.';
  } finally {
    loading.value = false;
  }
}

onMounted(reload);

// ─── Realtime: react to streamed events ──────────────────────────
watch(() => props.streamEvents.length, (len, prev) => {
  if (!len || len <= (prev ?? 0)) return;
  for (let i = (prev ?? 0); i < len; i++) {
    const ev = props.streamEvents[i];
    if (!ev) continue;
    handleStreamEvent(ev);
  }
});

function handleStreamEvent(ev: { type: string; data: any; receivedAt: string }) {
  const t = ev.type;
  const d = ev.data ?? {};

  // node.* events drive status updates
  if (t === 'node.started' || t === 'node.completed' || t === 'node.failed' || t === 'node.skipped') {
    const key: string | undefined = d.nodeKey;
    if (!key) return;
    const idx = execs.value.findIndex(e => e.nodeKey === key);
    const newStatus: NodeExec['status'] = t === 'node.started' ? 'running' : t === 'node.completed' ? 'completed' : t === 'node.skipped' ? 'skipped' : 'failed';
    if (idx >= 0) {
      execs.value[idx] = { ...execs.value[idx], status: newStatus, output: d.output ?? execs.value[idx].output, error: d.error ?? execs.value[idx].error, stepExecutionId: d.stepExecutionId ?? execs.value[idx].stepExecutionId };
    } else {
      execs.value.push({ id: d.nodeExecutionId ?? key, workflowExecutionId: props.executionId, nodeKey: key, status: newStatus, output: d.output, error: d.error, stepExecutionId: d.stepExecutionId });
    }
    pushLog(key, t, d);
    return;
  }

  // ask_questions on a step or agent
  if (t === 'agent.tool.ask_questions' || t === 'step.tool.ask_questions') {
    const nodeKey = d.nodeKey || resolveNodeKeyFromStep(d.stepExecutionId);
    if (!nodeKey) return;
    pendingAsks.value[nodeKey] = d.ask ?? {
      askId: d.askId,
      introduction: d.introduction ?? null,
      questions: d.questions ?? [],
      timeoutMs: d.timeoutMs,
    };
    const idx = execs.value.findIndex(e => e.nodeKey === nodeKey);
    if (idx >= 0) execs.value[idx] = { ...execs.value[idx], status: 'awaiting_input' };
    if (selectedKey.value !== nodeKey) selectedKey.value = nodeKey;
    pushLog(nodeKey, t, d);
    return;
  }
  if (t === 'agent.tool.ask_questions_resolved' || t === 'step.tool.ask_questions_resolved') {
    const nodeKey = d.nodeKey || resolveNodeKeyFromStep(d.stepExecutionId);
    if (!nodeKey) return;
    delete pendingAsks.value[nodeKey];
    const idx = execs.value.findIndex(e => e.nodeKey === nodeKey);
    if (idx >= 0 && execs.value[idx].status === 'awaiting_input') execs.value[idx] = { ...execs.value[idx], status: 'running' };
    pushLog(nodeKey, t, d);
    return;
  }

  // step events: try to map step → node. Many graph executions create one
  // step_execution per agent node, identified by config.nodeKey.
  if (t.startsWith('step.') || t.startsWith('agent.')) {
    const nodeKey = d.nodeKey || resolveNodeKeyFromStep(d.stepExecutionId);
    if (!nodeKey) return;
    pushLog(nodeKey, t, d);
  }
}

function resolveNodeKeyFromStep(stepExecutionId?: string): string | undefined {
  if (!stepExecutionId) return undefined;
  return execs.value.find(e => e.stepExecutionId === stepExecutionId || e.id === stepExecutionId)?.nodeKey;
}

function pushLog(nodeKey: string, type: string, data: any) {
  const arr = nodeLogs.value[nodeKey] ||= [];
  const summary = (() => {
    if (type.includes('ask_questions')) return data?.ask?.introduction || 'Awaiting answer';
    if (data?.toolName) return `tool: ${data.toolName}`;
    if (data?.error) return `error: ${data.error}`;
    if (data?.message) return String(data.message);
    return '';
  })();
  arr.push({ time: new Date().toISOString().slice(11, 19), type, summary });
  if (arr.length > 200) arr.splice(0, arr.length - 200);
}

// ─── Submit ask answer ───────────────────────────────────────────
async function handleAskSubmit(payload: { askId: string; answers: any }) {
  if (!selectedKey.value) return;
  const exec = nodeExec(selectedKey.value);
  if (!exec) return;
  submittingAsk.value = true;
  try {
    // Reuse the established agent-sessions answer endpoint.
    await $fetch('/api/agent-sessions/answer', {
      method: 'POST',
      headers,
      body: {
        contextType: 'workflow_step',
        contextId: (exec as any).stepExecutionId ?? exec.id,
        askId: payload.askId,
        answers: payload.answers,
      },
    });
    delete pendingAsks.value[selectedKey.value];
  } catch (e: any) {
    loadError.value = e?.data?.error || 'Failed to submit answer.';
  } finally {
    submittingAsk.value = false;
  }
}
</script>
