<template>
  <div class="flex flex-col gap-4">
    <!-- Toolbar -->
    <div class="flex flex-col gap-3 rounded-lg border border-surface-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div class="flex flex-wrap items-center gap-1.5">
          <Tag :value="`Mode: ${executionMode}`" :severity="executionMode === 'graph' ? 'info' : 'secondary'" />
          <Tag :value="`${agentStepCount} agent steps`" severity="secondary" />
          <Tag :value="`${triggers.length} triggers`" severity="secondary" />
          <Tag v-if="dirty" value="Unsaved changes" severity="warn" />
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button icon="pi pi-compass" label="Inspector" severity="secondary" outlined size="small" @click="toggleInspector" />
        <Button label="Reload" icon="pi pi-refresh" severity="secondary" outlined size="small" :disabled="saving" @click="loadGraph" />
        <Button label="Save Graph" icon="pi pi-check" severity="primary" size="small" :loading="saving" :disabled="!dirty" @click="saveGraph" />
      </div>
    </div>

    <Message v-if="errorMsg" severity="error" :closable="true" @close="errorMsg = null">{{ errorMsg }}</Message>
    <Message v-if="okMsg" severity="success" :closable="true" @close="okMsg = null">{{ okMsg }}</Message>

    <div v-if="loading" class="rounded-lg border border-surface-200 bg-white py-10 text-center text-sm text-surface-400">
      Loading visual workflow...
    </div>

    <div v-else class="flex gap-0 rounded-lg border border-surface-200 bg-white overflow-hidden" style="height: 720px">
      <!-- Left palette -->
      <div class="w-44 flex-shrink-0 border-r border-surface-200 bg-surface-50 overflow-y-auto flex flex-col">
        <div class="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase text-surface-400 tracking-wider">Triggers</div>
        <div
          v-for="tt in triggerTypes"
          :key="tt.type"
          draggable="true"
          class="mx-2 mb-1 cursor-grab rounded px-2 py-1.5 text-xs bg-amber-50 border border-amber-200 hover:bg-amber-100 select-none"
          @dragstart="(e) => { e.dataTransfer && e.dataTransfer.setData('oao/triggerType', tt.type) }"
          @click="beginCreateTriggerOfType(tt)"
        >
          <div class="font-medium text-amber-800">{{ tt.label }}</div>
          <div class="text-[10px] text-amber-600 truncate mt-0.5">{{ tt.category }}</div>
        </div>
        <div class="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase text-surface-400 tracking-wider">Blocks</div>
        <div
          v-for="nt in addableNodeTypes"
          :key="nt.value"
          draggable="true"
          class="mx-2 mb-1 cursor-grab rounded px-2 py-1.5 text-xs border border-surface-200 bg-white hover:bg-surface-100 select-none"
          :style="{ borderLeftColor: nodeTypeColor(nt.value), borderLeftWidth: '3px' }"
          @dragstart="(e) => { e.dataTransfer && e.dataTransfer.setData('oao/nodeType', nt.value) }"
          @click="addNodeAt(nt.value, 320 + regularNodes.length * 220, 200)"
        >
          <div class="font-medium text-surface-800">{{ nt.label }}</div>
          <div class="text-[10px] text-surface-400 mt-0.5">{{ nt.hint }}</div>
        </div>
      </div>

      <!-- Canvas container -->
      <div class="flex-1 relative overflow-hidden">
        <!-- Zoom controls -->
        <div class="absolute top-2 right-2 z-10 flex items-center gap-1 bg-white/90 border border-surface-200 rounded px-2 py-1 shadow-sm">
          <button class="text-surface-500 hover:text-primary px-1 font-bold text-base leading-none" @click="changeZoom(-0.15)">−</button>
          <span class="text-xs text-surface-600 w-10 text-center">{{ Math.round(zoomLevel * 100) }}%</span>
          <button class="text-surface-500 hover:text-primary px-1 font-bold text-base leading-none" @click="changeZoom(0.15)">+</button>
          <button class="text-[10px] text-surface-400 hover:text-primary px-1 ml-1" @click="resetView">Reset</button>
          <button class="text-[10px] text-surface-400 hover:text-primary px-1" @click="centerView" title="Fit & center the diagram">Center</button>
        </div>

        <!-- Scrollable canvas -->
        <div
          ref="canvasWrapper"
          class="overflow-auto w-full h-full"
          :class="isPanning ? 'cursor-grabbing' : 'cursor-grab'"
          @dragover.prevent
          @drop="onDrop"
          @wheel.prevent="onWheel"
        >
          <svg
            ref="canvasEl"
            :width="scaledWidth"
            :height="scaledHeight"
            :viewBox="`0 0 ${canvasWidth} ${canvasHeight}`"
            @mousedown="startCanvasPan"
            @mousemove="onSvgMouseMove"
            @mouseup="onSvgMouseUp"
            @click="onSvgClick"
          >
            <defs>
              <pattern id="vgrid" :width="gridSize" :height="gridSize" patternUnits="userSpaceOnUse">
                <path :d="`M ${gridSize} 0 L 0 0 0 ${gridSize}`" fill="none" stroke="#e8edf2" stroke-width="0.8" />
              </pattern>
              <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
              </marker>
              <marker id="wf-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
              </marker>
              <marker id="wf-arrow-draw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#f97316" />
              </marker>
            </defs>

            <!-- Grid background -->
            <rect width="100%" height="100%" fill="url(#vgrid)" />

            <!-- Edges -->
            <g v-for="(edge, idx) in edges" :key="`edge-${idx}`" class="cursor-pointer" @click.stop="selectEdge(idx)">
              <path
                v-if="edgePath(edge)"
                :d="edgePath(edge)"
                fill="none"
                :stroke="selectedEdgeIdx === idx ? '#3b82f6' : '#94a3b8'"
                stroke-width="2"
                :marker-end="selectedEdgeIdx === idx ? 'url(#wf-arrow-sel)' : 'url(#wf-arrow)'"
              />
              <text
                v-if="edge.branchKey && edgeMidpoint(edge)"
                :x="edgeMidpoint(edge).x"
                :y="edgeMidpoint(edge).y - 6"
                text-anchor="middle"
                style="font-size: 10px; fill: #64748b;"
              >{{ edge.branchKey }}</text>
            </g>

            <!-- Drawing edge preview -->
            <path
              v-if="drawingEdge"
              :d="drawingEdgePath"
              fill="none"
              stroke="#f97316"
              stroke-width="2"
              stroke-dasharray="6 3"
              marker-end="url(#wf-arrow-draw)"
            />

            <!-- Combined Start+Trigger block -->
            <g
              v-if="startNode"
              :transform="`translate(${startNode.positionX},${startNode.positionY})`"
              class="cursor-pointer"
              @mousedown.stop="startDrag(startNode, $event)"
              @click.stop="selectNode(startNode.nodeKey)"
            >
              <rect :width="startBlockWidth" :height="startBlockHeight" rx="10" fill="#00000015" transform="translate(3,4)" />
              <rect :width="startBlockWidth" :height="startBlockHeight" rx="10" fill="#fffbeb"
                :stroke="selectedNodeKey === startNode.nodeKey ? '#d97706' : '#fbbf24'"
                :stroke-width="selectedNodeKey === startNode.nodeKey ? 3 : 1.5" />
              <rect :width="startBlockWidth" height="32" rx="10" fill="#f59e0b" />
              <rect :width="startBlockWidth" y="22" height="10" fill="#f59e0b" />
              <text x="14" y="21" style="font-size: 11px; font-weight: 700; fill: white;">⚡ WORKFLOW TRIGGERS</text>
              <g v-for="(trigger, ti) in triggers" :key="trigger.id">
                <circle :cx="16" :cy="47 + ti * 30" r="5" :fill="trigger.isActive !== false ? '#22c55e' : '#94a3b8'" />
                <text :x="28" :y="52 + ti * 30" style="font-size: 11px; fill: #78350f;">
                  {{ formatTriggerType(trigger.triggerType) }}
                  <tspan style="font-size: 10px; fill: #a16207;">— {{ formatTriggerShort(trigger) }}</tspan>
                </text>
              </g>
              <text v-if="triggers.length === 0" x="14" y="55" style="font-size: 11px; fill: #a16207; font-style: italic;">No triggers — click to add</text>
              <g :transform="`translate(0, ${startBlockHeight - 30})`" @mousedown.stop @click.stop="beginCreateTrigger" class="cursor-pointer">
                <rect :width="startBlockWidth" height="26" rx="6" fill="#fef3c7" />
                <text :x="startBlockWidth / 2" y="17" text-anchor="middle" style="font-size: 11px; font-weight: 600; fill: #d97706;">+ Add Trigger</text>
              </g>
              <circle :cx="startBlockWidth" :cy="startBlockHeight / 2" r="7" fill="white" stroke="#f59e0b" stroke-width="2"
                class="cursor-crosshair"
                @mousedown.stop="startEdgeDraw(startNode.nodeKey, $event)" />
            </g>

            <!-- Regular nodes -->
            <g
              v-for="node in regularNodes"
              :key="node.nodeKey"
              :transform="`translate(${node.positionX},${node.positionY})`"
              class="cursor-pointer"
              @mousedown.stop="startDrag(node, $event)"
              @click.stop="selectNode(node.nodeKey)"
            >
              <rect :width="nodeWidth" :height="nodeHeight" rx="8" fill="#00000015" transform="translate(2,3)" />
              <rect :width="nodeWidth" :height="nodeHeight" rx="8" :fill="nodeFill(node.nodeType)"
                :stroke="selectedNodeKey === node.nodeKey ? '#2563eb' : '#94a3b8'"
                :stroke-width="selectedNodeKey === node.nodeKey ? 3 : 1.5" />
              <text :x="nodeWidth / 2" y="22" text-anchor="middle" style="font-size: 10px; font-weight: 700; fill: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">
                {{ node.nodeType.replace('_', ' ') }}
              </text>
              <text :x="nodeWidth / 2" y="46" text-anchor="middle" style="font-size: 13px; fill: #0f172a; font-weight: 500;">
                {{ truncate(node.name, 19) }}
              </text>
              <text :x="nodeWidth / 2" y="66" text-anchor="middle" style="font-size: 10px; fill: #94a3b8; font-family: monospace;">
                #{{ node.nodeKey }}
              </text>
              <circle cx="0" :cy="nodeHeight / 2" r="7" fill="white" :stroke="nodeTypeColor(node.nodeType)" stroke-width="2"
                class="cursor-crosshair" @mouseup.stop="completeEdgeDraw(node.nodeKey)" />
              <circle :cx="nodeWidth" :cy="nodeHeight / 2" r="7" fill="white" :stroke="nodeTypeColor(node.nodeType)" stroke-width="2"
                class="cursor-crosshair" @mousedown.stop="startEdgeDraw(node.nodeKey, $event)" />
            </g>
          </svg>
        </div>
      </div>

      <!-- Inspector panel -->
      <aside v-if="inspectorExpanded" class="w-72 flex-shrink-0 border-l border-surface-200 bg-white overflow-y-auto overflow-x-hidden">
        <div class="flex items-center justify-between gap-3 border-b border-surface-200 px-4 py-3">
          <div>
            <h2 class="text-base font-semibold">Inspector</h2>
            <p class="text-xs text-surface-500">Block, trigger, and edge controls.</p>
          </div>
          <Button icon="pi pi-times" text rounded size="small" @click="collapseInspector" />
        </div>

        <Tabs :value="activeInspectorTab" @update:value="activeInspectorTab = $event" class="px-1">
          <TabList>
            <Tab value="element">Element</Tab>
            <Tab value="edges">Edges</Tab>
            <Tab value="triggers">Triggers</Tab>
          </TabList>
          <TabPanels>
            <TabPanel value="element">
              <div class="p-3">
                <div v-if="selectedNode && selectedNode.nodeType !== 'start'" class="flex flex-col gap-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <Tag :value="selectedNode.nodeType" severity="info" />
                      <Tag :value="selectedNode.nodeKey" severity="secondary" />
                    </div>
                    <Button label="Delete" icon="pi pi-trash" severity="danger" outlined size="small" @click="deleteNode(selectedNode.nodeKey)" />
                  </div>
                  <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">Name</label>
                      <InputText v-model="selectedNode.name" size="small" fluid @input="markDirty" />
                  </div>
                  <div v-if="selectedNode.nodeType === 'agent_step'" class="flex flex-col gap-3">
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">Agent Override</label>
                      <Select :modelValue="getConfigString('agentId')" :options="agentOptions" optionLabel="name" optionValue="id" placeholder="Use workflow default" showClear fluid size="small" @update:modelValue="setConfigValue('agentId', $event)" />
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">Prompt Template *</label>
                      <Textarea :modelValue="getConfigText('promptTemplate')" rows="6" class="text-sm w-full" placeholder="Use {{ precedent_output }} or {{ inputs.KEY }}" @update:modelValue="setConfigValue('promptTemplate', $event)" />
                    </div>
                    <details class="cursor-pointer text-xs text-surface-500">
                      <summary class="select-none font-medium hover:text-primary">Template variables</summary>
                      <div class="mt-2 rounded border border-surface-200 bg-surface-50 p-3 text-xs">
                        <div class="grid grid-cols-2 gap-1">
                          <span class="font-mono text-primary-600" v-pre>{{ precedent_output }}</span><span class="text-surface-500">Previous step output</span>
                          <span class="font-mono text-primary-600" v-pre>{{ inputs.KEY }}</span><span class="text-surface-500">Trigger input</span>
                          <span class="font-mono text-primary-600" v-pre>{{ node_input }}</span><span class="text-surface-500">Graph node output</span>
                          <span class="font-mono text-primary-600" v-pre>{{ properties.KEY }}</span><span class="text-surface-500">Property value</span>
                          <span class="font-mono text-primary-600" v-pre>{{ credentials.KEY }}</span><span class="text-surface-500">Credential (server-side)</span>
                        </div>
                      </div>
                    </details>
                    <div class="flex flex-col gap-3">
                      <div class="flex flex-col gap-1">
                        <label class="text-xs font-medium text-surface-600">Model Override</label>
                        <Select :modelValue="getConfigString('model')" :options="modelOptions" optionLabel="name" optionValue="name" placeholder="Workflow default" showClear fluid size="small" @update:modelValue="setConfigValue('model', $event)" />
                      </div>
                      <div class="flex flex-col gap-1">
                        <label class="text-xs font-medium text-surface-600">Reasoning Effort</label>
                        <Select :modelValue="getConfigString('reasoningEffort')" :options="reasoningOptions" optionLabel="label" optionValue="value" placeholder="Workflow default" showClear fluid size="small" @update:modelValue="setConfigValue('reasoningEffort', $event)" />
                      </div>
                      <div class="flex flex-col gap-1">
                        <label class="text-xs font-medium text-surface-600">Worker Runtime</label>
                        <Select :modelValue="getConfigString('workerRuntime')" :options="runtimeOptions" optionLabel="label" optionValue="value" placeholder="Workflow default" showClear fluid size="small" @update:modelValue="setConfigValue('workerRuntime', $event)" />
                      </div>
                      <div class="flex flex-col gap-1">
                        <label class="text-xs font-medium text-surface-600">Timeout (sec)</label>
                        <InputNumber :modelValue="getConfigNumber('timeoutSeconds', 300)" :min="30" :max="3600" fluid size="small" @update:modelValue="setConfigValue('timeoutSeconds', $event || 300)" />
                      </div>
                    </div>
                  </div>
                  <div v-else class="flex flex-col gap-1">
                    <label class="text-xs font-medium text-surface-600">Config (JSON)</label>
                    <Textarea :modelValue="configJson" rows="7" class="font-mono text-xs w-full" @update:modelValue="onConfigJsonChange(String($event ?? ''))" />
                    <small v-if="configError" class="text-red-500">{{ configError }}</small>
                    <small v-else class="text-surface-400">{{ configHint(selectedNode.nodeType) }}</small>
                  </div>
                </div>
                <div v-else-if="selectedNode && selectedNode.nodeType === 'start'" class="flex flex-col gap-3">
                  <Tag value="START / TRIGGERS" severity="warn" />
                  <p class="text-sm text-surface-500">Entry point of your workflow. Manage triggers in the Triggers tab.</p>
                  <Button label="Manage Triggers" icon="pi pi-bolt" severity="secondary" outlined size="small" @click="activeInspectorTab = 'triggers'" />
                </div>
                <div v-else class="rounded-lg border border-dashed border-surface-300 px-4 py-6 text-center text-sm text-surface-400">
                  Click a block to inspect it, or drag from the palette to add one.
                </div>
              </div>
            </TabPanel>

            <TabPanel value="edges">
              <div class="flex flex-col gap-3 p-3">
                <div v-if="edges.length === 0" class="rounded-lg border border-dashed border-surface-300 px-4 py-4 text-center text-sm text-surface-400">
                  No edges. Drag from an output port (right circle) to an input port (left circle).
                </div>
                <div v-for="(edge, index) in edges" :key="`edge-row-${index}`"
                  class="flex flex-col gap-1.5 rounded-lg border border-surface-200 p-2 text-xs cursor-pointer"
                  :class="selectedEdgeIdx === index ? 'border-blue-300 bg-blue-50' : ''"
                  @click="selectEdge(index)">
                  <div class="flex items-center gap-2 min-w-0 overflow-hidden">
                    <Select v-model="edge.fromNodeKey" :options="nodeKeyOptions" optionLabel="label" optionValue="value" class="min-w-0 flex-1" fluid size="small" @change="markDirty" />
                    <span class="shrink-0 text-surface-400 font-bold">→</span>
                    <Select v-model="edge.toNodeKey" :options="nodeKeyOptions" optionLabel="label" optionValue="value" class="min-w-0 flex-1" fluid size="small" @change="markDirty" />
                  </div>
                  <div class="flex items-center gap-2">
                    <InputText v-model="edge.branchKey" placeholder="branch label (optional)" class="flex-1" @input="markDirty" />
                    <Button icon="pi pi-times" text severity="danger" size="small" @click.stop="removeEdge(index)" />
                  </div>
                </div>
                <Button label="Add Edge" icon="pi pi-plus" size="small" severity="secondary" outlined :disabled="nodes.length < 2" @click="addEdge" />
              </div>
            </TabPanel>

            <TabPanel value="triggers">
              <div class="flex flex-col gap-4 p-3">
                <div class="flex items-center justify-between gap-3">
                  <p class="text-sm font-semibold">Triggers <span class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-700 text-surface-300 text-[10px] leading-none">{{ triggers.length }}</span></p>
                  <Button label="Add" icon="pi pi-plus" size="small" @click="beginCreateTrigger" />
                </div>
                <div class="flex flex-col gap-2">
                  <button
                    v-for="trigger in triggers"
                    :key="trigger.id"
                    type="button"
                    class="rounded-lg border px-3 py-2 text-left transition-colors"
                    :class="selectedTriggerId === trigger.id ? 'border-primary bg-primary-50' : 'border-surface-200 bg-white hover:border-primary/40'"
                    @click="selectTrigger(trigger.id)"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <Tag :value="formatTriggerType(trigger.triggerType)" severity="info" />
                      <Tag :value="trigger.isActive ? 'Active' : 'Inactive'" :severity="trigger.isActive ? 'success' : 'secondary'" />
                    </div>
                    <p class="mt-2 text-sm text-surface-600">{{ formatTriggerConfiguration(trigger) }}</p>
                    <p v-if="formatTriggerRuntimeSummary(trigger)" class="mt-1 text-xs text-surface-400">{{ formatTriggerRuntimeSummary(trigger) }}</p>
                    <p v-if="triggerConnectivityResults[trigger.id]" class="mt-1 text-xs"
                      :class="triggerConnectivityResults[trigger.id].ok ? 'text-emerald-600' : 'text-rose-600'">
                      {{ formatTriggerConnectivityResult(triggerConnectivityResults[trigger.id]) }}
                    </p>
                  </button>
                  <div v-if="triggers.length === 0" class="rounded-lg border border-dashed border-surface-300 px-4 py-4 text-center text-sm text-surface-400">
                    No triggers configured.
                  </div>
                </div>
                <div v-if="triggerCreateMode" class="rounded-lg border border-surface-200 bg-surface-50 p-3">
                  <div class="flex items-center justify-between gap-3 mb-3">
                    <p class="text-sm font-semibold">{{ triggerPanelStep === 'catalog' ? 'Add Trigger' : `Add ${formatTriggerType(createTriggerForm.triggerType)}` }}</p>
                    <Button v-if="triggerPanelStep === 'form'" icon="pi pi-arrow-left" text rounded size="small" @click="showTriggerCatalog" />
                  </div>
                  <div v-if="triggerPanelStep === 'catalog'" class="flex max-h-[30rem] flex-col gap-2 overflow-y-auto">
                    <button v-for="triggerType in triggerTypes" :key="triggerType.type" type="button"
                      class="rounded-lg border border-surface-200 bg-white p-3 text-left transition-colors hover:border-primary/40"
                      @click="selectTriggerType(triggerType)">
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <p class="text-sm font-semibold">{{ triggerType.label }}</p>
                          <p class="mt-1 text-xs text-surface-500">{{ triggerType.description }}</p>
                        </div>
                        <Tag :value="triggerType.category" severity="secondary" class="text-[11px]" />
                      </div>
                    </button>
                  </div>
                  <div v-else>
                    <label class="mb-3 flex items-center gap-2 text-sm text-surface-600">
                      <Checkbox v-model="createTriggerForm.isActive" :binary="true" /> Active
                    </label>
                    <WorkflowTriggerFields :trigger="createTriggerForm" :credential-options="workflowCredentialOptions" />
                    <div class="mt-4 flex flex-wrap justify-end gap-2">
                      <Button label="Cancel" severity="secondary" size="small" @click="cancelCreateTrigger" />
                      <Button label="Save Trigger" icon="pi pi-check" size="small" :loading="savingTrigger" @click="handleCreateTrigger" />
                    </div>
                  </div>
                </div>
                <div v-if="selectedTrigger && editingTriggerId" class="rounded-lg border border-surface-200 p-3">
                  <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <Tag :value="formatTriggerType(editTriggerForm.triggerType)" severity="info" />
                      <Tag value="Editing" severity="warn" />
                    </div>
                    <label class="flex items-center gap-2 text-sm text-surface-600">
                      <Checkbox v-model="editTriggerForm.isActive" :binary="true" /> Active
                    </label>
                  </div>
                  <WorkflowTriggerFields :trigger="editTriggerForm" :credential-options="workflowCredentialOptions" />
                  <div class="mt-4 flex flex-wrap justify-end gap-2">
                    <Button label="Test" icon="pi pi-link" severity="secondary" outlined size="small" :loading="testingTriggerId === editingTriggerId" @click="handleTestTriggerConnectivity(editingTriggerId)" />
                    <Button label="Delete" icon="pi pi-trash" severity="danger" outlined size="small" @click="handleDeleteTrigger(editingTriggerId)" />
                    <Button label="Save" icon="pi pi-check" size="small" :loading="savingTrigger" @click="handleSaveEditedTrigger" />
                  </div>
                </div>
              </div>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  createTriggerDraft,
  formatTriggerConfiguration,
  formatTriggerRuntimeSummary,
  formatTriggerType,
  type TriggerCatalogEntry,
  type WorkflowTriggerLike,
} from '~/utils/triggers';

type NodeType = 'start' | 'agent_step' | 'http_request' | 'script' | 'conditional' | 'parallel' | 'join';
type InspectorTab = 'element' | 'edges' | 'triggers';

interface NodeRow {
  nodeKey: string;
  nodeType: NodeType;
  name: string;
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
}

interface EdgeRow {
  fromNodeKey: string;
  toNodeKey: string;
  branchKey: string | null;
  label: string | null;
}

interface WorkflowStepRow {
  id?: string;
  name: string;
  promptTemplate: string;
  stepOrder: number;
  agentId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  workerRuntime?: string | null;
  timeoutSeconds?: number | null;
}

interface GraphResponse {
  executionMode: 'sequential' | 'graph';
  nodes: NodeRow[];
  edges: EdgeRow[];
  steps?: WorkflowStepRow[];
  triggers?: WorkflowTriggerLike[];
}

const props = defineProps<{ workflowId: string }>();
const emit = defineEmits<{ saved: []; triggersChanged: [] }>();

const { authHeaders } = useAuth();
const headers = authHeaders();
const toast = useToast();
const confirm = useConfirm();
const { buildCredentialOptions } = useAgentCredentialOptions();

// Canvas state
const canvasWrapper = ref<HTMLDivElement | null>(null);
const canvasEl = ref<SVGSVGElement | null>(null);
const zoomLevel = ref(1.0);
const gridSize = 24;
const nodeWidth = 180;
const nodeHeight = 80;
const startBlockWidth = 220;
const isPanning = ref(false);

const startBlockHeight = computed(() => 40 + Math.max(1, triggers.value.length) * 30 + 34);
const canvasWidth = computed(() => Math.max(1300, ...nodes.value.map((n) => (n.positionX || 0) + nodeWidth + 200)));
const canvasHeight = computed(() => Math.max(720, ...nodes.value.map((n) => (n.positionY || 0) + nodeHeight + 200)));
const scaledWidth = computed(() => canvasWidth.value * zoomLevel.value);
const scaledHeight = computed(() => canvasHeight.value * zoomLevel.value);

// Workflow state
const executionMode = ref<'sequential' | 'graph'>('sequential');
const nodes = ref<NodeRow[]>([]);
const edges = ref<EdgeRow[]>([]);
const steps = ref<WorkflowStepRow[]>([]);
const triggers = ref<WorkflowTriggerLike[]>([]);
const loading = ref(true);
const dirty = ref(false);
const saving = ref(false);
const errorMsg = ref<string | null>(null);
const okMsg = ref<string | null>(null);

// Inspector state
const inspectorExpanded = ref(false);
const activeInspectorTab = ref<InspectorTab>('element');
const selectedNodeKey = ref<string | null>(null);
const selectedEdgeIdx = ref<number | null>(null);
const selectedTriggerId = ref<string | null>(null);
const selectedNode = computed(() => selectedNodeKey.value ? nodes.value.find((n) => n.nodeKey === selectedNodeKey.value) ?? null : null);
const selectedTrigger = computed(() => selectedTriggerId.value ? triggers.value.find((t) => t.id === selectedTriggerId.value) ?? null : null);
const configJson = ref('{}');
const configError = ref<string | null>(null);

// Node groups
const startNode = computed(() => nodes.value.find((n) => n.nodeType === 'start') ?? null);
const regularNodes = computed(() => nodes.value.filter((n) => n.nodeType !== 'start'));
const agentStepCount = computed(() => nodes.value.filter((n) => n.nodeType === 'agent_step').length);

const addableNodeTypes = [
  { label: 'Agent Step', value: 'agent_step' as NodeType, hint: 'AI-powered step' },
  { label: 'HTTP Request', value: 'http_request' as NodeType, hint: 'External API call' },
  { label: 'Script', value: 'script' as NodeType, hint: 'Custom JS logic' },
  { label: 'Conditional', value: 'conditional' as NodeType, hint: 'Branch by expression' },
  { label: 'Parallel', value: 'parallel' as NodeType, hint: 'Fan-out branches' },
  { label: 'Join', value: 'join' as NodeType, hint: 'Merge branches' },
];

const reasoningOptions = [
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
];
const runtimeOptions = [
  { label: 'Static', value: 'static' },
  { label: 'Ephemeral', value: 'ephemeral' },
];

const { data: agentsData } = await useFetch('/api/agents', { headers });
const agentOptions = computed(() => (agentsData.value as any)?.agents ?? []);
const { data: modelsData } = await useFetch('/api/models', { headers });
const modelOptions = computed(() => (modelsData.value as any)?.models ?? []);
const { data: triggerTypesData } = await useFetch('/api/triggers/types', { headers });
const triggerTypes = computed(() => (triggerTypesData.value as any)?.types ?? []);
const { data: userVarsData } = await useFetch('/api/variables?scope=user', { headers });
const { data: wsVarsData } = await useFetch('/api/variables?scope=workspace', { headers });
const workflowCredentialOptions = computed(() => buildCredentialOptions([
  { scope: 'user', scopeLabel: 'User', variables: (userVarsData.value as any)?.variables ?? [] },
  { scope: 'workspace', scopeLabel: 'Workspace', variables: (wsVarsData.value as any)?.variables ?? [] },
]));
const nodeKeyOptions = computed(() => nodes.value.map((n) => ({ label: `${n.nodeKey} — ${n.name}`, value: n.nodeKey })));

// Helpers
function svgCoords(event: MouseEvent | DragEvent) {
  const el = canvasEl.value;
  if (!el) return { x: 0, y: 0 };
  const rect = el.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvasWidth.value / rect.width),
    y: (event.clientY - rect.top) * (canvasHeight.value / rect.height),
  };
}

function nodeOutputPort(key: string) {
  const node = nodes.value.find((n) => n.nodeKey === key);
  if (!node) return null;
  return {
    x: node.positionX + (node.nodeType === 'start' ? startBlockWidth : nodeWidth),
    y: node.positionY + (node.nodeType === 'start' ? startBlockHeight.value / 2 : nodeHeight / 2),
  };
}

function nodeInputPort(key: string) {
  const node = nodes.value.find((n) => n.nodeKey === key);
  if (!node) return null;
  return { x: node.positionX, y: node.positionY + nodeHeight / 2 };
}

function edgePath(edge: EdgeRow) {
  const from = nodeOutputPort(edge.fromNodeKey);
  const to = nodeInputPort(edge.toNodeKey);
  if (!from || !to) return null;
  const cx = Math.abs(to.x - from.x) * 0.45 + 40;
  return `M ${from.x},${from.y} C ${from.x + cx},${from.y} ${to.x - cx},${to.y} ${to.x},${to.y}`;
}

function edgeMidpoint(edge: EdgeRow) {
  const from = nodeOutputPort(edge.fromNodeKey);
  const to = nodeInputPort(edge.toNodeKey);
  if (!from || !to) return { x: 0, y: 0 };
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

function nodeFill(type: NodeType) {
  return ({ start: '#fffbeb', agent_step: '#dbeafe', http_request: '#fef3c7', script: '#ede9fe', conditional: '#fef9c3', parallel: '#fce7f3', join: '#e0f2fe' } as Record<string, string>)[type] ?? '#e2e8f0';
}

function nodeTypeColor(type: string) {
  return ({ start: '#f59e0b', agent_step: '#3b82f6', http_request: '#f59e0b', script: '#8b5cf6', conditional: '#eab308', parallel: '#ec4899', join: '#0ea5e9' } as Record<string, string>)[type] ?? '#94a3b8';
}

function configHint(type: NodeType) {
  return ({ http_request: '{ "url": "...", "method": "GET" }', script: '{ "source": "return input" }', conditional: '{ "expression": "true" }', join: '{ "strategy": "all" }' } as Record<string, string>)[type] ?? '';
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function defaultConfigFor(type: NodeType): Record<string, unknown> {
  if (type === 'agent_step') return { promptTemplate: '', agentId: null, model: null, reasoningEffort: null, workerRuntime: null, timeoutSeconds: 300 };
  if (type === 'http_request') return { method: 'GET', url: '', timeoutMs: 15000 };
  if (type === 'script') return { source: 'return input;', timeoutMs: 5000 };
  if (type === 'conditional') return { expression: 'true' };
  if (type === 'join') return { strategy: 'all' };
  return {};
}

function formatTriggerShort(trigger: WorkflowTriggerLike) {
  const cfg = trigger.configuration as Record<string, any>;
  if (trigger.triggerType === 'time_schedule') return cfg.cronExpression || (cfg.intervalMinutes ? `${cfg.intervalMinutes}min` : '');
  if (trigger.triggerType === 'webhook') return cfg.path ? `/${cfg.path}` : '';
  return '';
}

function markDirty() { dirty.value = true; }

// Inspector
function toggleInspector() { inspectorExpanded.value = !inspectorExpanded.value; }

function collapseInspector() {
  inspectorExpanded.value = false;
  selectedNodeKey.value = null;
  selectedTriggerId.value = null;
  selectedEdgeIdx.value = null;
}

function selectNode(nodeKey: string) {
  selectedNodeKey.value = nodeKey;
  selectedTriggerId.value = null;
  selectedEdgeIdx.value = null;
  triggerCreateMode.value = false;
  inspectorExpanded.value = true;
  activeInspectorTab.value = 'element';
}

function selectEdge(idx: number) {
  selectedEdgeIdx.value = idx;
  selectedNodeKey.value = null;
  selectedTriggerId.value = null;
  inspectorExpanded.value = true;
  activeInspectorTab.value = 'edges';
}

function selectTrigger(triggerId: string) {
  const trigger = triggers.value.find((t) => t.id === triggerId);
  if (!trigger) return;
  selectedTriggerId.value = triggerId;
  selectedNodeKey.value = null;
  selectedEdgeIdx.value = null;
  triggerCreateMode.value = false;
  editingTriggerId.value = triggerId;
  Object.assign(editTriggerForm, { id: trigger.id ?? '', triggerType: trigger.triggerType, configuration: JSON.parse(JSON.stringify(trigger.configuration ?? {})), isActive: trigger.isActive !== false });
  inspectorExpanded.value = true;
  activeInspectorTab.value = 'triggers';
}

watch(selectedNode, (node) => { configJson.value = JSON.stringify(node?.config ?? {}, null, 2); configError.value = null; });

function getConfigString(key: string) { const v = selectedNode.value?.config?.[key]; return typeof v === 'string' && v ? v : null; }
function getConfigText(key: string) { const v = selectedNode.value?.config?.[key]; return typeof v === 'string' ? v : ''; }
function getConfigNumber(key: string, fallback: number) { const v = selectedNode.value?.config?.[key]; return typeof v === 'number' ? v : fallback; }
function setConfigValue(key: string, value: unknown) {
  if (!selectedNode.value) return;
  selectedNode.value.config = { ...(selectedNode.value.config ?? {}), [key]: value || null };
  configJson.value = JSON.stringify(selectedNode.value.config, null, 2);
  markDirty();
}
function onConfigJsonChange(value: string) {
  configJson.value = value;
  if (!selectedNode.value) return;
  try { selectedNode.value.config = JSON.parse(value); configError.value = null; markDirty(); }
  catch (e) { configError.value = e instanceof Error ? e.message : String(e); }
}

// Zoom
function changeZoom(delta: number) { zoomLevel.value = Math.min(2.5, Math.max(0.25, zoomLevel.value + delta)); }
function onWheel(event: WheelEvent) {
  // Zoom anchored at cursor position so the element under the pointer stays put.
  const wrapper = canvasWrapper.value;
  if (!wrapper) { changeZoom(event.deltaY > 0 ? -0.1 : 0.1); return; }
  const rect = wrapper.getBoundingClientRect();
  const cx = event.clientX - rect.left; // cursor in viewport
  const cy = event.clientY - rect.top;
  const oldZoom = zoomLevel.value;
  const delta = event.deltaY > 0 ? -0.1 : 0.1;
  const newZoom = Math.min(2.5, Math.max(0.25, oldZoom + delta));
  if (newZoom === oldZoom) return;
  // World coord under cursor at current zoom
  const worldX = (wrapper.scrollLeft + cx) / oldZoom;
  const worldY = (wrapper.scrollTop + cy) / oldZoom;
  zoomLevel.value = newZoom;
  // After zoom change, set scroll so that worldX/Y stays under cursor.
  nextTick(() => {
    if (!canvasWrapper.value) return;
    canvasWrapper.value.scrollLeft = worldX * newZoom - cx;
    canvasWrapper.value.scrollTop = worldY * newZoom - cy;
  });
}

function resetView() {
  zoomLevel.value = 1;
  nextTick(() => {
    if (!canvasWrapper.value) return;
    canvasWrapper.value.scrollLeft = 0;
    canvasWrapper.value.scrollTop = 0;
  });
}

function centerView() {
  const wrapper = canvasWrapper.value;
  if (!wrapper) return;
  const all = nodes.value;
  if (all.length === 0) { resetView(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of all) {
    const w = n.nodeType === 'start' ? startBlockWidth : nodeWidth;
    const h = n.nodeType === 'start' ? startBlockHeight.value : nodeHeight;
    minX = Math.min(minX, n.positionX);
    minY = Math.min(minY, n.positionY);
    maxX = Math.max(maxX, n.positionX + w);
    maxY = Math.max(maxY, n.positionY + h);
  }
  const padding = 60;
  const bboxW = (maxX - minX) + padding * 2;
  const bboxH = (maxY - minY) + padding * 2;
  const viewW = wrapper.clientWidth;
  const viewH = wrapper.clientHeight;
  const fitZ = Math.min(viewW / bboxW, viewH / bboxH);
  const newZoom = Math.min(2.5, Math.max(0.25, fitZ));
  zoomLevel.value = newZoom;
  nextTick(() => {
    if (!canvasWrapper.value) return;
    const cxWorld = (minX + maxX) / 2;
    const cyWorld = (minY + maxY) / 2;
    canvasWrapper.value.scrollLeft = Math.max(0, cxWorld * newZoom - viewW / 2);
    canvasWrapper.value.scrollTop = Math.max(0, cyWorld * newZoom - viewH / 2);
  });
}

// Pan
const wasPanning = ref(false);

function startCanvasPan(event: MouseEvent) {
  if (event.button !== 0 || !canvasWrapper.value) return;
  const sx = event.clientX; const sy = event.clientY;
  const sl = canvasWrapper.value.scrollLeft; const st = canvasWrapper.value.scrollTop;
  let moved = false;
  isPanning.value = true;
  function onMove(e: MouseEvent) {
    const dx = e.clientX - sx; const dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    canvasWrapper.value!.scrollLeft = sl - dx;
    canvasWrapper.value!.scrollTop = st - dy;
  }
  function onUp() { isPanning.value = false; wasPanning.value = moved; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function onSvgClick() {
  if (wasPanning.value) { wasPanning.value = false; return; }
  selectedNodeKey.value = null;
  selectedEdgeIdx.value = null;
}

// Node drag
function startDrag(node: NodeRow, event: MouseEvent) {
  event.preventDefault();
  selectNode(node.nodeKey);
  const { x: sx, y: sy } = svgCoords(event);
  const ox = node.positionX; const oy = node.positionY;
  function onMove(e: MouseEvent) {
    const { x, y } = svgCoords(e);
    node.positionX = Math.max(0, ox + (x - sx));
    node.positionY = Math.max(0, oy + (y - sy));
    markDirty();
  }
  function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// Edge drawing
const drawingEdge = ref<{ fromKey: string; x1: number; y1: number; x2: number; y2: number } | null>(null);
const drawingEdgePath = computed(() => {
  if (!drawingEdge.value) return '';
  const { x1, y1, x2, y2 } = drawingEdge.value;
  const cx = Math.abs(x2 - x1) * 0.45 + 40;
  return `M ${x1},${y1} C ${x1 + cx},${y1} ${x2 - cx},${y2} ${x2},${y2}`;
});

function startEdgeDraw(nodeKey: string, event: MouseEvent) {
  event.preventDefault();
  const port = nodeOutputPort(nodeKey);
  if (!port) return;
  drawingEdge.value = { fromKey: nodeKey, x1: port.x, y1: port.y, x2: port.x, y2: port.y };
}

function completeEdgeDraw(toNodeKey: string) {
  if (!drawingEdge.value) return;
  const fromKey = drawingEdge.value.fromKey;
  drawingEdge.value = null;
  if (fromKey === toNodeKey) return;
  if (!edges.value.some((e) => e.fromNodeKey === fromKey && e.toNodeKey === toNodeKey)) {
    edges.value.push({ fromNodeKey: fromKey, toNodeKey: toNodeKey, branchKey: null, label: null });
    markDirty();
  }
}

function onSvgMouseMove(event: MouseEvent) {
  if (!drawingEdge.value) return;
  const { x, y } = svgCoords(event);
  drawingEdge.value.x2 = x;
  drawingEdge.value.y2 = y;
}

function onSvgMouseUp() { drawingEdge.value = null; }

// Palette drop
function onDrop(event: DragEvent) {
  const nodeType = event.dataTransfer?.getData('oao/nodeType') as NodeType | undefined;
  if (nodeType) {
    const { x, y } = svgCoords(event);
    addNodeAt(nodeType, Math.max(10, x - nodeWidth / 2), Math.max(10, y - nodeHeight / 2));
  }
  const triggerType = event.dataTransfer?.getData('oao/triggerType');
  if (triggerType) {
    const found = (triggerTypes.value as TriggerCatalogEntry[]).find((t) => t.type === triggerType);
    if (found) beginCreateTriggerOfType(found);
  }
}

// Node management
function addNodeAt(nodeType: NodeType, x: number, y: number) {
  const prefix = nodeType.replace(/_./g, (m) => m[1].toUpperCase());
  let idx = regularNodes.value.filter((n) => n.nodeType === nodeType).length + 1;
  let key = `${prefix}_${idx}`;
  while (nodes.value.some((n) => n.nodeKey === key)) { idx++; key = `${prefix}_${idx}`; }
  const node: NodeRow = { nodeKey: key, nodeType, name: addableNodeTypes.find((n) => n.value === nodeType)?.label ?? nodeType, config: defaultConfigFor(nodeType), positionX: Math.round(x), positionY: Math.round(y) };
  nodes.value.push(node);
  selectNode(node.nodeKey);
  markDirty();
}

function deleteNode(nodeKey: string) {
  nodes.value = nodes.value.filter((n) => n.nodeKey !== nodeKey);
  edges.value = edges.value.filter((e) => e.fromNodeKey !== nodeKey && e.toNodeKey !== nodeKey);
  collapseInspector();
  markDirty();
}

function addEdge() {
  const fromKey = startNode.value?.nodeKey ?? regularNodes.value[0]?.nodeKey ?? '';
  const toKey = regularNodes.value.find((n) => n.nodeKey !== fromKey)?.nodeKey ?? '';
  if (!fromKey || !toKey) return;
  edges.value.push({ fromNodeKey: fromKey, toNodeKey: toKey, branchKey: null, label: null });
  markDirty();
}

function removeEdge(index: number) {
  edges.value.splice(index, 1);
  if (selectedEdgeIdx.value === index) selectedEdgeIdx.value = null;
  markDirty();
}

// Load/Save
async function loadGraph() {
  loading.value = true;
  errorMsg.value = null;
  okMsg.value = null;
  try {
    const result = await $fetch<GraphResponse>(`/api/workflow-graph/${props.workflowId}/graph`, { headers });
    executionMode.value = result.executionMode ?? 'sequential';
    nodes.value = (result.nodes ?? []).map((n) => ({ ...n, config: (n.config ?? {}) as Record<string, unknown>, positionX: n.positionX ?? 0, positionY: n.positionY ?? 0 }));
    if (!nodes.value.find((n) => n.nodeType === 'start')) {
      nodes.value.unshift({ nodeKey: 'start', nodeType: 'start', name: 'Start', config: {}, positionX: 40, positionY: 200 });
    }
    edges.value = result.edges ?? [];
    steps.value = result.steps ?? [];
    triggers.value = result.triggers ?? [];
    dirty.value = false;
    selectedNodeKey.value = null;
    selectedTriggerId.value = null;
    selectedEdgeIdx.value = null;
  } catch (error: any) {
    errorMsg.value = error?.data?.error || 'Failed to load visual workflow.';
  } finally {
    loading.value = false;
  }
}

function validateBeforeSave() {
  const startCount = nodes.value.filter((n) => n.nodeType === 'start').length;
  if (startCount !== 1) return `Graph must contain exactly 1 Start block (found ${startCount}).`;
  const nodeKeys = new Set(nodes.value.map((n) => n.nodeKey));
  for (const edge of edges.value) {
    if (!nodeKeys.has(edge.fromNodeKey) || !nodeKeys.has(edge.toNodeKey)) return `Edge ${edge.fromNodeKey}→${edge.toNodeKey} references a missing block.`;
  }
  for (const node of nodes.value) {
    if (node.nodeType === 'agent_step') {
      const pt = typeof node.config.promptTemplate === 'string' ? node.config.promptTemplate : '';
      if (!pt.trim()) return `Agent step "${node.name}" needs a Prompt Template.`;
    }
  }
  return null;
}

async function saveGraph() {
  const err = validateBeforeSave();
  if (err) { errorMsg.value = err; return; }
  errorMsg.value = null; okMsg.value = null; saving.value = true;
  try {
    const result = await $fetch<{ syncedSteps?: number }>(`/api/workflow-graph/${props.workflowId}/graph`, {
      method: 'PUT', headers, body: { nodes: nodes.value, edges: edges.value },
    });
    await loadGraph();
    executionMode.value = 'graph';
    okMsg.value = `Graph saved. ${result.syncedSteps ?? 0} agent step${result.syncedSteps === 1 ? '' : 's'} synced.`;
    dirty.value = false;
    emit('saved');
  } catch (error: unknown) {
    const e2 = error as { data?: { error?: string }; message?: string };
    errorMsg.value = `Save failed: ${e2?.data?.error || e2?.message || 'unknown'}`;
  } finally {
    saving.value = false;
  }
}

// Trigger management
const triggerCreateMode = ref(false);
const triggerPanelStep = ref<'catalog' | 'form'>('catalog');
const editingTriggerId = ref<string | null>(null);
const savingTrigger = ref(false);
const testingTriggerId = ref<string | null>(null);
const createTriggerForm = reactive<WorkflowTriggerLike>({ triggerType: '', configuration: {}, isActive: true });
const editTriggerForm = reactive<WorkflowTriggerLike & { id: string }>({ id: '', triggerType: '', configuration: {}, isActive: true });
const triggerConnectivityResults = reactive<Record<string, { ok: boolean; message?: string; summary?: string }>>({});

function resetCreateTriggerForm() { Object.assign(createTriggerForm, { triggerType: '', configuration: {}, isActive: true }); }

function beginCreateTrigger() {
  selectedNodeKey.value = null; selectedTriggerId.value = null; editingTriggerId.value = null;
  resetCreateTriggerForm(); triggerCreateMode.value = true; triggerPanelStep.value = 'catalog';
  inspectorExpanded.value = true; activeInspectorTab.value = 'triggers';
}

function beginCreateTriggerOfType(tt: TriggerCatalogEntry) { beginCreateTrigger(); selectTriggerType(tt); }
function cancelCreateTrigger() { triggerCreateMode.value = false; triggerPanelStep.value = 'catalog'; resetCreateTriggerForm(); }
function showTriggerCatalog() { triggerPanelStep.value = 'catalog'; resetCreateTriggerForm(); }
function selectTriggerType(triggerType: TriggerCatalogEntry) { Object.assign(createTriggerForm, createTriggerDraft(triggerType)); triggerPanelStep.value = 'form'; }

async function handleCreateTrigger() {
  savingTrigger.value = true;
  try {
    await $fetch('/api/triggers', { method: 'POST', headers, body: { workflowId: props.workflowId, triggerType: createTriggerForm.triggerType, configuration: createTriggerForm.configuration, isActive: createTriggerForm.isActive } });
    toast.add({ severity: 'success', summary: 'Trigger added', life: 3000 });
    cancelCreateTrigger(); await loadGraph(); emit('triggersChanged');
  } catch (error: any) {
    const details = Array.isArray(error?.data?.issues) ? error.data.issues.map((i: any) => i.message).filter(Boolean).join('; ') : '';
    toast.add({ severity: 'error', summary: 'Error', detail: details || error?.data?.error || 'Failed', life: 5000 });
  } finally { savingTrigger.value = false; }
}

async function handleSaveEditedTrigger() {
  if (!editingTriggerId.value) return;
  savingTrigger.value = true;
  try {
    await $fetch(`/api/triggers/${editingTriggerId.value}`, { method: 'PUT', headers, body: { triggerType: editTriggerForm.triggerType, configuration: editTriggerForm.configuration, isActive: editTriggerForm.isActive } });
    toast.add({ severity: 'success', summary: 'Trigger saved', life: 3000 });
    await loadGraph(); emit('triggersChanged');
  } catch (error: any) {
    const details = Array.isArray(error?.data?.issues) ? error.data.issues.map((i: any) => i.message).filter(Boolean).join('; ') : '';
    toast.add({ severity: 'error', summary: 'Error', detail: details || error?.data?.error || 'Failed', life: 5000 });
  } finally { savingTrigger.value = false; }
}

function formatTriggerConnectivityResult(result: { ok: boolean; message?: string; summary?: string }) {
  return result.summary || result.message || (result.ok ? 'Connectivity test passed.' : 'Test failed.');
}

async function handleTestTriggerConnectivity(triggerId: string) {
  testingTriggerId.value = triggerId;
  try {
    const result = await $fetch<any>(`/api/triggers/${triggerId}/test`, { method: 'POST', headers });
    triggerConnectivityResults[triggerId] = { ok: result?.ok !== false, message: result?.message, summary: result?.summary };
    toast.add({ severity: result?.ok === false ? 'error' : 'success', summary: result?.ok === false ? 'Failed' : 'OK', detail: result?.summary || result?.message || 'Done', life: 5000 });
  } catch (error: any) {
    const message = error?.data?.summary || error?.data?.message || error?.data?.error || 'Test failed.';
    triggerConnectivityResults[triggerId] = { ok: false, message };
    toast.add({ severity: 'error', summary: 'Connectivity Failed', detail: message, life: 5000 });
  } finally { testingTriggerId.value = null; }
}

async function handleDeleteTrigger(id: string) {
  confirm.require({
    message: 'Delete this trigger?', header: 'Confirm', icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/triggers/${id}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Deleted', life: 3000 });
      await loadGraph(); emit('triggersChanged');
    },
  });
}

await loadGraph();
</script>
