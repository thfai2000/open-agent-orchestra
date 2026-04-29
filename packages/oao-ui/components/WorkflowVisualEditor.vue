<template>
  <div :class="['flex flex-col gap-4', isFullscreen ? 'oao-wfeditor-fullscreen' : '']">
    <!-- Toolbar -->
    <div class="flex flex-col gap-3 rounded-lg border border-surface-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div class="flex flex-wrap items-center gap-1.5">
          <Tag :value="`${regularNodes.length} blocks`" severity="secondary" />
          <Tag :value="`${edges.length} edges`" severity="secondary" />
          <Tag :value="`${triggers.length} triggers`" severity="secondary" />
          <Tag v-if="readonly" value="Read-only" severity="secondary" />
          <Tag v-if="dirty && !readonly" value="Unsaved changes" severity="warn" />
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button :icon="isFullscreen ? 'pi pi-window-minimize' : 'pi pi-window-maximize'" :label="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" severity="secondary" outlined size="small" @click="toggleFullscreen" />
        <Button icon="pi pi-compass" label="Inspector" severity="secondary" outlined size="small" @click="toggleInspector" />
        <Button label="Reload" icon="pi pi-refresh" severity="secondary" outlined size="small" :disabled="saving" @click="loadGraph" />
        <Button v-if="!readonly" label="Save Graph" icon="pi pi-check" severity="primary" size="small" :loading="saving" :disabled="!dirty" @click="saveGraph" />
      </div>
    </div>

    <Message v-if="errorMsg" severity="error" :closable="true" @close="errorMsg = null">{{ errorMsg }}</Message>
    <Message v-if="okMsg" severity="success" :closable="true" @close="okMsg = null">{{ okMsg }}</Message>

    <div v-if="loading" class="rounded-lg border border-surface-200 bg-white py-10 text-center text-sm text-surface-400">
      Loading visual workflow...
    </div>

    <div v-else :class="['relative flex gap-0 rounded-lg border border-surface-200 bg-white overflow-hidden', isFullscreen ? 'flex-1' : '']" :style="isFullscreen ? '' : 'height: 720px'">
      <!-- Left palette (hidden in readonly) -->
      <div v-if="!readonly" class="w-44 flex-shrink-0 border-r border-surface-200 bg-surface-50 overflow-y-auto flex flex-col">
        <div class="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase text-surface-400 tracking-wider">Triggers</div>
        <div
          v-for="tt in triggerTypes"
          :key="tt.type"
          draggable="true"
          class="mx-2 mb-1 flex cursor-grab select-none items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs hover:bg-amber-100"
          @dragstart="(e) => { e.dataTransfer && e.dataTransfer.setData('oao/triggerType', tt.type) }"
          @click="beginCreateTriggerOfType(tt)"
        >
          <i :class="triggerTypeIcon(tt.type)" class="w-4 text-center text-amber-700" />
          <div class="min-w-0">
            <div class="truncate font-medium text-amber-800">{{ tt.label }}</div>
            <div class="mt-0.5 truncate text-[10px] text-amber-600">{{ tt.category }}</div>
          </div>
        </div>
        <div class="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase text-surface-400 tracking-wider">Blocks</div>
        <div
          v-for="nt in addableNodeTypes"
          :key="nt.value"
          draggable="true"
          class="mx-2 mb-1 flex cursor-grab select-none items-center gap-2 rounded border border-surface-200 bg-white px-2 py-1.5 text-xs hover:bg-surface-100"
          :style="{ borderLeftColor: nodeTypeColor(nt.value), borderLeftWidth: '3px' }"
          @dragstart="(e) => { e.dataTransfer && e.dataTransfer.setData('oao/nodeType', nt.value) }"
          @click="addNodeAt(nt.value, 320 + regularNodes.length * 220, 200)"
        >
          <i :class="nt.icon" class="w-4 text-center" :style="{ color: nodeTypeColor(nt.value) }" />
          <div class="min-w-0">
            <div class="truncate font-medium text-surface-800">{{ nt.label }}</div>
            <div class="mt-0.5 truncate text-[10px] text-surface-400">{{ nt.hint }}</div>
          </div>
        </div>
      </div>

      <!-- Canvas container -->
      <div class="flex-1 relative overflow-hidden">
        <!-- Zoom controls -->
        <div class="absolute top-2 right-2 z-10 flex items-center gap-1 bg-white/90 border border-surface-200 rounded px-2 py-1 shadow-sm">
          <button class="text-[10px] text-surface-500 hover:text-primary px-1 disabled:opacity-30" :disabled="undoStack.length === 0" @click="undo" title="Undo (⌘Z)">↶</button>
          <button class="text-[10px] text-surface-500 hover:text-primary px-1 disabled:opacity-30" :disabled="redoStack.length === 0" @click="redo" title="Redo (⌘⇧Z)">↷</button>
          <span class="w-px h-4 bg-surface-200 mx-1" />
          <button class="text-surface-500 hover:text-primary px-1 font-bold text-base leading-none" @click="changeZoom(-0.15)">−</button>
          <span class="text-xs text-surface-600 w-10 text-center">{{ Math.round(zoomLevel * 100) }}%</span>
          <button class="text-surface-500 hover:text-primary px-1 font-bold text-base leading-none" @click="changeZoom(0.15)">+</button>
          <button class="text-[10px] text-surface-400 hover:text-primary px-1 ml-1" @click="resetView">Reset</button>
          <button class="text-[10px] text-surface-400 hover:text-primary px-1" @click="centerView" title="Fit & center the diagram">Center</button>
          <span class="w-px h-4 bg-surface-200 mx-1" />
          <button class="text-[10px] px-1" :class="snapToGrid ? 'text-primary font-semibold' : 'text-surface-400 hover:text-primary'" @click="snapToGrid = !snapToGrid" title="Snap nodes to grid">Snap</button>
          <button class="text-[10px] px-1" :class="showMiniMap ? 'text-primary font-semibold' : 'text-surface-400 hover:text-primary'" @click="showMiniMap = !showMiniMap" title="Toggle mini-map">Map</button>
        </div>

        <!-- Mini-map -->
        <div v-if="showMiniMap && nodes.length > 0" class="absolute bottom-2 right-2 z-10 bg-white/95 border border-surface-200 rounded shadow-sm" style="width: 180px; height: 120px;">
          <svg :viewBox="`0 0 ${canvasWidth} ${canvasHeight}`" class="w-full h-full" preserveAspectRatio="xMidYMid meet">
            <rect :width="canvasWidth" :height="canvasHeight" fill="#f8fafc" />
            <rect v-for="node in nodes" :key="`mm-${node.nodeKey}`"
              :x="node.positionX" :y="node.positionY" :width="nodeWidth" :height="nodeHeight"
              :fill="nodeTypeColor(node.nodeType)" opacity="0.7" rx="6" />
            <rect v-if="canvasWrapper"
              :x="(canvasWrapper.scrollLeft || 0) / zoomLevel"
              :y="(canvasWrapper.scrollTop || 0) / zoomLevel"
              :width="(canvasWrapper.clientWidth || 0) / zoomLevel"
              :height="(canvasWrapper.clientHeight || 0) / zoomLevel"
              fill="none" stroke="#2563eb" stroke-width="20" />
          </svg>
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
              <marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
              </marker>
              <marker id="wf-arrow-sel" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
              </marker>
              <marker id="wf-arrow-draw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#f97316" />
              </marker>
            </defs>

            <!-- Grid background -->
            <rect width="100%" height="100%" fill="url(#vgrid)" />

            <!-- Edges -->
            <g v-for="(edge, idx) in edges" :key="`edge-${idx}`" class="cursor-pointer" @click.stop="selectEdge(idx)">
              <!-- Wide invisible hit-target so edges are easy to click. -->
              <path
                v-if="edgePath(edge)"
                :d="edgePath(edge) || undefined"
                fill="none"
                stroke="transparent"
                stroke-width="14"
                style="pointer-events: stroke;"
              />
              <path
                v-if="edgePath(edge)"
                :d="edgePath(edge) || undefined"
                fill="none"
                :stroke="selectedEdgeIdx === idx ? '#3b82f6' : '#94a3b8'"
                :stroke-width="selectedEdgeIdx === idx ? 3 : 2"
                :marker-end="selectedEdgeIdx === idx ? 'url(#wf-arrow-sel)' : 'url(#wf-arrow)'"
                style="pointer-events: none;"
              />
              <text
                v-if="edge.branchKey && edgeMidpoint(edge)"
                :x="edgeMidpoint(edge).x"
                :y="edgeMidpoint(edge).y - 6"
                text-anchor="middle"
                style="font-size: 10px; fill: #64748b; pointer-events: none;"
              >{{ edge.branchKey }}</text>
              <!-- Inline delete affordance shown only on the selected edge. -->
              <g v-if="selectedEdgeIdx === idx && edgeMidpoint(edge)"
                :transform="`translate(${edgeMidpoint(edge).x - 9},${edgeMidpoint(edge).y - 9})`"
                class="cursor-pointer"
                @click.stop="removeEdge(idx)">
                <circle cx="9" cy="9" r="9" fill="#ef4444" />
                <text x="9" y="13" text-anchor="middle" style="font-size: 12px; font-weight: 700; fill: white;">×</text>
              </g>
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

            <!-- Alignment guides (shown while dragging) -->
            <line v-if="alignmentGuides.vertical !== null"
              :x1="alignmentGuides.vertical" :y1="0"
              :x2="alignmentGuides.vertical" :y2="canvasHeight"
              stroke="#2563eb" stroke-width="1" stroke-dasharray="4 4" opacity="0.6" />
            <line v-if="alignmentGuides.horizontal !== null"
              :x1="0" :y1="alignmentGuides.horizontal"
              :x2="canvasWidth" :y2="alignmentGuides.horizontal"
              stroke="#2563eb" stroke-width="1" stroke-dasharray="4 4" opacity="0.6" />

            <!-- Trigger entry connections (dashed orange) -->
            <g v-for="(line, idx) in triggerEntryLines" :key="`tentry-${idx}`">
              <path
                v-if="line.path"
                :d="line.path"
                fill="none"
                stroke="#f59e0b"
                stroke-width="2"
                stroke-dasharray="6 3"
                marker-end="url(#wf-arrow-draw)"
              />
            </g>

            <!-- Drawing trigger entry preview -->
            <path
              v-if="drawingTriggerEntry"
              :d="drawingTriggerEntryPath"
              fill="none"
              stroke="#f59e0b"
              stroke-width="2"
              stroke-dasharray="6 3"
              marker-end="url(#wf-arrow-draw)"
            />

            <!-- Trigger blocks (one per saved or draft trigger, draggable) -->
            <g
              v-for="trigger in canvasTriggers"
              :key="triggerCanvasKey(trigger)"
              :transform="`translate(${triggerPos(trigger).x},${triggerPos(trigger).y})`"
              class="cursor-pointer"
              @mousedown.stop="startTriggerDrag(trigger, $event)"
              @click.stop="selectCanvasTrigger(trigger)"
            >
              <rect :width="triggerWidth" :height="triggerHeight" rx="8" fill="#00000015" transform="translate(2,3)" />
              <rect :width="triggerWidth" :height="triggerHeight" rx="8" fill="#fffbeb"
                :stroke="isCanvasTriggerSelected(trigger) ? '#d97706' : '#fbbf24'"
                :stroke-width="isCanvasTriggerSelected(trigger) ? 3 : 1.5"
                :stroke-dasharray="isDraftTrigger(trigger) ? '5 3' : ''" />
              <circle :cx="14" cy="18" r="4" :fill="trigger.isActive !== false ? '#22c55e' : '#94a3b8'" />
              <text x="26" y="21" style="font-size: 10px; font-weight: 700; fill: #92400e;">
                {{ formatTriggerType(trigger.triggerType) }}
              </text>
              <text x="14" y="40" style="font-size: 10px; fill: #78350f; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
                {{ truncate(formatTriggerShort(trigger) || 'Not configured', 25) }}
              </text>
              <text v-if="trigger.entryNodeKey" x="14" y="56" style="font-size: 9px; fill: #a16207;">
                Entry: {{ truncate(trigger.entryNodeKey, 22) }}
              </text>
              <!-- Output port: drag to a node to set entryNodeKey -->
              <circle :cx="triggerWidth" :cy="triggerHeight / 2" r="6" fill="white" stroke="#f59e0b" stroke-width="2"
                class="cursor-crosshair"
                @mousedown.stop="startTriggerEntryDraw(trigger, $event)" />
            </g>

              <!-- Triggers are visible entry-point blocks. Each selected trigger
                configures its own `entryNodeKey` in the inspector. -->

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
              <circle cx="20" cy="18" r="6" :fill="nodeTypeColor(node.nodeType)" opacity="0.9" />
              <text x="36" y="22" style="font-size: 10px; font-weight: 700; fill: #64748b; text-transform: uppercase;">
                {{ nodeTypeLabel(node.nodeType) }}
              </text>
              <text x="14" y="48" style="font-size: 13px; fill: #0f172a; font-weight: 600;">
                {{ truncate(node.name, 24) }}
              </text>
              <text x="14" y="67" style="font-size: 10px; fill: #475569; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
                {{ truncate(blockSummary(node), 30) }}
              </text>
              <text x="14" y="84" style="font-size: 9px; fill: #94a3b8; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
                #{{ node.nodeKey }}
              </text>
              <circle cx="0" :cy="nodeHeight / 2" r="7" fill="white" :stroke="nodeTypeColor(node.nodeType)" stroke-width="2"
                class="cursor-crosshair"
                @mouseup.stop="onNodeInputMouseUp(node.nodeKey)" />
              <circle :cx="nodeWidth" :cy="nodeHeight / 2" r="7" fill="white" :stroke="nodeTypeColor(node.nodeType)" stroke-width="2"
                class="cursor-crosshair" @mousedown.stop="startEdgeDraw(node.nodeKey, $event)" />
            </g>
          </svg>
        </div>
      </div>

      <!-- Inspector panel — n8n-style slide-over drawer overlaying the canvas -->
      <transition name="oao-drawer">
        <aside
          v-if="inspectorExpanded"
          class="oao-inspector-drawer absolute top-0 right-0 bottom-0 w-[380px] max-w-[90vw] flex-shrink-0 border-l border-surface-200 bg-white shadow-xl overflow-y-auto overflow-x-hidden text-xs z-20"
        >
        <div class="flex items-center justify-between gap-2 border-b border-surface-200 px-3 py-2">
          <div>
            <h2 class="text-sm font-semibold">Inspector</h2>
            <p class="text-[10px] text-surface-500">Block, trigger, edge controls.</p>
          </div>
          <Button icon="pi pi-times" text rounded size="small" @click="collapseInspector" />
        </div>

        <div class="p-3">
                <div v-if="selectedNode" class="flex flex-col gap-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <Tag :value="selectedNode.nodeType" severity="info" />
                      <Tag :value="selectedNode.nodeKey" severity="secondary" />
                    </div>
                    <Button label="Delete" icon="pi pi-trash" severity="danger" outlined size="small" @click="deleteNode(selectedNode.nodeKey)" />
                  </div>
                  <p class="rounded border border-surface-200 bg-surface-50 px-3 py-2 text-[11px] text-surface-600">
                    {{ blockDescription(selectedNode.nodeType) }}
                  </p>
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
                      <Textarea :modelValue="getConfigText('promptTemplate')" rows="6" class="w-full font-mono text-xs leading-snug" placeholder="Use {{ precedent_output }} or {{ inputs.KEY }}" @update:modelValue="setConfigValue('promptTemplate', $event)" />
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
                  <!-- HTTP Request: structured fields. -->
                  <div v-else-if="selectedNode.nodeType === 'http_request'" class="flex flex-col gap-3">
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">Method</label>
                      <Select :modelValue="getConfigString('method') || 'GET'" :options="httpMethodOptions" fluid size="small" @update:modelValue="setConfigValue('method', $event)" />
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">URL *</label>
                      <InputText :modelValue="getConfigText('url')" placeholder="https://api.example.com/endpoint" size="small" fluid @update:modelValue="setConfigValue('url', $event)" />
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">Headers (YAML object)</label>
                      <Textarea :modelValue="httpHeadersYaml" rows="5" class="w-full font-mono text-xs leading-snug" placeholder="Authorization: Bearer {{ credentials.API_TOKEN }}&#10;Content-Type: application/json" @update:modelValue="onHttpYamlConfigChange('headers', String($event ?? ''))" />
                      <small v-if="yamlConfigErrors.headers" class="text-red-500 text-[10px]">{{ yamlConfigErrors.headers }}</small>
                      <small v-else class="text-[10px] text-surface-400">Enter one header per line as YAML key/value pairs.</small>
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">Body (YAML object, optional)</label>
                      <Textarea :modelValue="httpBodyYaml" rows="6" class="w-full font-mono text-xs leading-snug" placeholder="ticketId: {{ inputs.ticketId }}&#10;message: Hello" @update:modelValue="onHttpYamlConfigChange('body', String($event ?? ''))" />
                      <small v-if="yamlConfigErrors.body" class="text-red-500 text-[10px]">{{ yamlConfigErrors.body }}</small>
                      <small v-else class="text-[10px] text-surface-400">Objects and arrays are sent as JSON. Plain strings are sent as text.</small>
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">Timeout (ms)</label>
                      <InputNumber :modelValue="getConfigNumber('timeoutMs', 15000)" :min="500" :max="120000" fluid size="small" @update:modelValue="setConfigValue('timeoutMs', $event || 15000)" />
                    </div>
                  </div>

                  <!-- Script: JavaScript code editor. -->
                  <div v-else-if="selectedNode.nodeType === 'script'" class="flex flex-col gap-3">
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">JavaScript Source *</label>
                      <CodeEditor :modelValue="getConfigText('source')" language="javascript" height="260px" @update:modelValue="setConfigValue('source', $event)" />
                      <small class="text-[10px] text-surface-400">Function body. Use <code>input</code> for the previous output and <code>return</code> the result.</small>
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">Timeout (ms)</label>
                      <InputNumber :modelValue="getConfigNumber('timeoutMs', 5000)" :min="100" :max="60000" fluid size="small" @update:modelValue="setConfigValue('timeoutMs', $event || 5000)" />
                    </div>
                  </div>

                  <!-- Conditional: simple expression. -->
                  <div v-else-if="selectedNode.nodeType === 'conditional'" class="flex flex-col gap-3">
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">Expression *</label>
                      <InputText :modelValue="getConfigText('expression')" placeholder="input.score > 0.5" size="small" fluid @update:modelValue="setConfigValue('expression', $event)" />
                      <small class="text-[10px] text-surface-400">JavaScript expression evaluated against <code>input</code>. Outgoing edges may set a <em>Branch label</em> (true/false) to pick the path.</small>
                    </div>
                  </div>

                  <!-- Join: strategy. -->
                  <div v-else-if="selectedNode.nodeType === 'join'" class="flex flex-col gap-3">
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">Strategy</label>
                      <Select :modelValue="getConfigString('strategy') || 'all'" :options="joinStrategyOptions" optionLabel="label" optionValue="value" fluid size="small" @update:modelValue="setConfigValue('strategy', $event)" />
                      <small class="text-[10px] text-surface-400">How to wait on incoming branches before continuing.</small>
                    </div>
                  </div>

                  <div v-else-if="selectedNode.nodeType === 'parallel'" class="flex flex-col gap-3">
                    <div class="rounded border border-surface-200 bg-surface-50 px-3 py-2 text-[11px] text-surface-600">
                      Parallel blocks have no configuration. Connect two or more outgoing edges; every outgoing branch runs when this block is reached.
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium text-surface-600">Outgoing Branches</label>
                      <div class="rounded border border-surface-200 bg-white px-3 py-2 font-mono text-xs text-surface-600">
                        {{ outgoingEdgeCount(selectedNode.nodeKey) }} branch{{ outgoingEdgeCount(selectedNode.nodeKey) === 1 ? '' : 'es' }}
                      </div>
                    </div>
                  </div>

                  <!-- Parallel / fallback. -->
                  <div v-else class="flex flex-col gap-1">
                    <label class="text-xs font-medium text-surface-600">Configuration (YAML)</label>
                    <CodeEditor :modelValue="configYaml" language="yaml" height="180px" @update:modelValue="onConfigYamlChange($event)" />
                    <small v-if="configError" class="text-red-500 text-[10px]">{{ configError }}</small>
                    <small v-else class="text-[10px] text-surface-400">Connect outgoing edges to define parallel branches.</small>
                  </div>
                </div>
                <div v-else-if="selectedEdgeIdx !== null && edges[selectedEdgeIdx]" class="flex flex-col gap-3">
                  <div class="flex items-center justify-between">
                    <Tag value="Edge" severity="info" />
                    <Button label="Delete" icon="pi pi-trash" severity="danger" outlined size="small" @click="removeEdge(selectedEdgeIdx)" />
                  </div>
                  <div class="text-[11px] text-surface-500">
                    {{ edges[selectedEdgeIdx].fromNodeKey }} <span class="text-surface-400">→</span> {{ edges[selectedEdgeIdx].toNodeKey }}
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-medium text-surface-600">Branch label (optional)</label>
                    <InputText v-model="edges[selectedEdgeIdx].branchKey" placeholder="e.g. true / yes / approved" size="small" fluid @input="markDirty" />
                    <small class="text-[10px] text-surface-400">Used by conditional nodes to pick this branch.</small>
                  </div>
                </div>
                <div v-else-if="triggerCreateMode && selectedDraftTrigger" class="flex flex-col gap-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <Tag :value="formatTriggerType(createTriggerForm.triggerType)" severity="info" />
                      <Tag value="New trigger" severity="warn" />
                    </div>
                    <Button label="Remove" icon="pi pi-trash" severity="secondary" outlined size="small" @click="cancelCreateTrigger" />
                  </div>
                  <p class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    Configure this trigger block, then save it to create the workflow trigger.
                  </p>
                  <label class="flex items-center gap-2 text-sm text-surface-600">
                    <Checkbox v-model="createTriggerForm.isActive" :binary="true" /> Active
                  </label>
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-medium text-surface-600">Entry Node</label>
                    <Select v-model="createTriggerForm.entryNodeKey"
                      :options="triggerEntryOptions"
                      optionLabel="label" optionValue="value"
                      placeholder="First block (default)"
                      showClear fluid size="small" />
                    <small class="text-[10px] text-surface-400">Workflow block where this trigger begins execution.</small>
                  </div>
                  <WorkflowTriggerFields :trigger="createTriggerForm" :credential-options="workflowCredentialOptions" compact />
                  <div class="mt-1 flex flex-wrap justify-end gap-2">
                    <Button label="Cancel" severity="secondary" size="small" @click="cancelCreateTrigger" />
                    <Button label="Save This Trigger" icon="pi pi-check" size="small" :loading="savingTrigger" @click="handleCreateTrigger" />
                  </div>
                </div>
                <div v-else-if="selectedTrigger && editingTriggerId" class="flex flex-col gap-3">
                  <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <Tag :value="formatTriggerType(editTriggerForm.triggerType)" severity="info" />
                      <Tag :value="editTriggerForm.isActive ? 'Active' : 'Inactive'" :severity="editTriggerForm.isActive ? 'success' : 'secondary'" />
                    </div>
                    <label class="flex items-center gap-2 text-sm text-surface-600">
                      <Checkbox v-model="editTriggerForm.isActive" :binary="true" /> Active
                    </label>
                  </div>
                  <p class="rounded border border-surface-200 bg-surface-50 px-3 py-2 text-[11px] text-surface-600">
                    {{ formatTriggerConfiguration(selectedTrigger) }}
                  </p>
                  <p v-if="formatTriggerRuntimeSummary(selectedTrigger)" class="text-xs text-surface-400">{{ formatTriggerRuntimeSummary(selectedTrigger) }}</p>
                  <p v-if="triggerConnectivityResults[editingTriggerId]" class="text-xs"
                    :class="triggerConnectivityResults[editingTriggerId].ok ? 'text-emerald-600' : 'text-rose-600'">
                    {{ formatTriggerConnectivityResult(triggerConnectivityResults[editingTriggerId]) }}
                  </p>
                  <div class="mb-3 flex flex-col gap-1">
                    <label class="text-xs font-medium text-surface-600">Entry Node</label>
                    <Select v-model="editTriggerForm.entryNodeKey"
                      :options="triggerEntryOptions"
                      optionLabel="label" optionValue="value"
                      placeholder="First block (default)"
                      showClear fluid size="small" />
                    <small class="text-[10px] text-surface-400">Workflow node where this trigger begins execution.</small>
                  </div>
                  <WorkflowTriggerFields :trigger="editTriggerForm" :credential-options="workflowCredentialOptions" compact />
                  <div class="mt-4 flex flex-wrap justify-end gap-2">
                    <Button label="Test" icon="pi pi-link" severity="secondary" outlined size="small" :loading="testingTriggerId === editingTriggerId" @click="handleTestTriggerConnectivity(editingTriggerId)" />
                    <Button label="Delete" icon="pi pi-trash" severity="danger" outlined size="small" @click="handleDeleteTrigger(editingTriggerId)" />
                    <Button label="Save" icon="pi pi-check" size="small" :loading="savingTrigger" @click="handleSaveEditedTrigger" />
                  </div>
                </div>
                <div v-else class="rounded-lg border border-dashed border-surface-300 px-4 py-6 text-center text-sm text-surface-400">
                  Click a block, trigger, or edge to inspect it, or drag from the palette to add one.
                </div>
        </div>
        </aside>
      </transition>
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
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';

type NodeType = 'agent_step' | 'http_request' | 'script' | 'conditional' | 'parallel' | 'join';

interface DraftTrigger extends WorkflowTriggerLike {
  draftId: string;
}

type CanvasTrigger = WorkflowTriggerLike | DraftTrigger;

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
  nodes: NodeRow[];
  edges: EdgeRow[];
  steps?: WorkflowStepRow[];
  triggers?: WorkflowTriggerLike[];
}

const props = withDefaults(defineProps<{
  workflowId: string;
  readonly?: boolean;
  versionData?: { nodes?: any[]; edges?: any[]; steps?: any[]; triggers?: any[] } | null;
}>(), { readonly: false, versionData: null });
const emit = defineEmits<{ saved: []; triggersChanged: [] }>();
const isFullscreen = ref(false);
function toggleFullscreen() { isFullscreen.value = !isFullscreen.value; }

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
const nodeWidth = 210;
const nodeHeight = 96;
const isPanning = ref(false);

const startNodeWidth = 100;
const startNodeHeight = 44;
const triggerWidth = 180;
const triggerHeight = 64;
// v4.0.0: snap-to-grid + alignment guides + undo/redo
const snapToGrid = ref(true);
const alignmentGuides = ref<{ horizontal: number | null; vertical: number | null }>({ horizontal: null, vertical: null });
const showMiniMap = ref(true);
function snap(value: number) {
  return snapToGrid.value ? Math.round(value / gridSize) * gridSize : value;
}

// Undo/redo: snapshots of {nodes, edges} JSON pushed before mutating actions.
interface GraphSnapshot { nodes: string; edges: string; }
const undoStack = ref<GraphSnapshot[]>([]);
const redoStack = ref<GraphSnapshot[]>([]);
const UNDO_LIMIT = 50;
function pushUndo() {
  undoStack.value.push({ nodes: JSON.stringify(nodes.value), edges: JSON.stringify(edges.value) });
  if (undoStack.value.length > UNDO_LIMIT) undoStack.value.shift();
  redoStack.value = [];
}
function applySnapshot(snap: GraphSnapshot) {
  nodes.value = JSON.parse(snap.nodes);
  edges.value = JSON.parse(snap.edges);
}
function undo() {
  const prev = undoStack.value.pop();
  if (!prev) return;
  redoStack.value.push({ nodes: JSON.stringify(nodes.value), edges: JSON.stringify(edges.value) });
  applySnapshot(prev);
  markDirty();
}
function redo() {
  const next = redoStack.value.pop();
  if (!next) return;
  undoStack.value.push({ nodes: JSON.stringify(nodes.value), edges: JSON.stringify(edges.value) });
  applySnapshot(next);
  markDirty();
}
const canvasWidth = computed(() => Math.max(
  1300,
  ...nodes.value.map((n) => (n.positionX || 0) + nodeWidth + 200),
  ...canvasTriggers.value.map((trigger) => (trigger.positionX ?? 40) + triggerWidth + 200),
));
const canvasHeight = computed(() => Math.max(
  720,
  ...nodes.value.map((n) => (n.positionY || 0) + nodeHeight + 200),
  ...canvasTriggers.value.map((trigger, idx) => (trigger.positionY ?? (40 + idx * (triggerHeight + 12))) + triggerHeight + 200),
));
const scaledWidth = computed(() => canvasWidth.value * zoomLevel.value);
const scaledHeight = computed(() => canvasHeight.value * zoomLevel.value);

// Workflow state
const nodes = ref<NodeRow[]>([]);
const edges = ref<EdgeRow[]>([]);
const steps = ref<WorkflowStepRow[]>([]);
const triggers = ref<WorkflowTriggerLike[]>([]);
const draftTriggers = ref<DraftTrigger[]>([]);
const loading = ref(true);
const dirty = ref(false);
const saving = ref(false);
const errorMsg = ref<string | null>(null);
const okMsg = ref<string | null>(null);

// Inspector state
const inspectorExpanded = ref(false);
const selectedNodeKey = ref<string | null>(null);
const selectedEdgeIdx = ref<number | null>(null);
const selectedTriggerId = ref<string | null>(null);
const selectedDraftTriggerId = ref<string | null>(null);
const selectedNode = computed(() => selectedNodeKey.value ? nodes.value.find((n) => n.nodeKey === selectedNodeKey.value) ?? null : null);
const selectedTrigger = computed(() => selectedTriggerId.value ? triggers.value.find((t) => t.id === selectedTriggerId.value) ?? null : null);
const selectedDraftTrigger = computed(() => selectedDraftTriggerId.value ? draftTriggers.value.find((t) => t.draftId === selectedDraftTriggerId.value) ?? null : null);
const canvasTriggers = computed<CanvasTrigger[]>(() => [...triggers.value, ...draftTriggers.value]);
const draftTriggerStorageKey = computed(() => `oao:workflow:${props.workflowId}:trigger-drafts`);
const configJson = ref('{}');
const configError = ref<string | null>(null);

// Node groups
const regularNodes = computed(() => nodes.value);
const agentStepCount = computed(() => nodes.value.filter((n) => n.nodeType === 'agent_step').length);

const addableNodeTypes = [
  { label: 'Agent Step', value: 'agent_step' as NodeType, hint: 'AI-powered step', icon: 'pi pi-sparkles' },
  { label: 'HTTP Request', value: 'http_request' as NodeType, hint: 'External API call', icon: 'pi pi-send' },
  { label: 'Script', value: 'script' as NodeType, hint: 'Custom JS logic', icon: 'pi pi-code' },
  { label: 'Conditional', value: 'conditional' as NodeType, hint: 'Branch by expression', icon: 'pi pi-question-circle' },
  { label: 'Parallel', value: 'parallel' as NodeType, hint: 'Fan-out branches', icon: 'pi pi-share-alt' },
  { label: 'Join', value: 'join' as NodeType, hint: 'Merge branches', icon: 'pi pi-sitemap' },
];

const BLOCK_DESCRIPTIONS: Record<string, string> = {
  agent_step: 'Runs a Copilot agent with the configured prompt template. Outputs the assistant’s final message and is available to downstream blocks as {{ precedent_output }}.',
  http_request: 'Performs an outbound HTTP call. The response body becomes the block’s output and is JSON-decoded automatically when content-type is JSON.',
  script: 'Executes a sandboxed JavaScript snippet. Receives the upstream value as `input` and returns a value for downstream blocks.',
  conditional: 'Evaluates a JavaScript expression against `input` and routes execution along the outgoing edge whose branch label matches the result (true / false / custom).',
  parallel: 'Fans out to every outgoing edge concurrently. Use a Join block to merge the branches.',
  join: 'Waits for incoming branches before continuing. Strategy controls whether to wait for all branches or any one branch.',
};
function blockDescription(type: string) {
  return BLOCK_DESCRIPTIONS[type] ?? 'Custom block.';
}

const httpMethodOptions = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const joinStrategyOptions = [
  { label: 'All branches must complete', value: 'all' },
  { label: 'Any one branch', value: 'any' },
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
  return { x: node.positionX + nodeWidth, y: node.positionY + nodeHeight / 2 };
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
  const target = shortenPathEnd(from, to, 13);
  const cx = Math.abs(to.x - from.x) * 0.45 + 40;
  return `M ${from.x},${from.y} C ${from.x + cx},${from.y} ${target.x - cx},${target.y} ${target.x},${target.y}`;
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

function shortenPathEnd(from: { x: number; y: number }, to: { x: number; y: number }, distance: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length <= distance || length === 0) return to;
  return { x: to.x - (dx / length) * distance, y: to.y - (dy / length) * distance };
}

function nodeTypeLabel(type: NodeType) {
  return addableNodeTypes.find((nodeType) => nodeType.value === type)?.label ?? type.replace('_', ' ');
}

function triggerTypeIcon(triggerType?: string) {
  return ({
    time_schedule: 'pi pi-clock',
    exact_datetime: 'pi pi-calendar-clock',
    webhook: 'pi pi-link',
    event: 'pi pi-bolt',
    jira_changes_notification: 'pi pi-bell',
    jira_polling: 'pi pi-refresh',
    manual: 'pi pi-play',
  } as Record<string, string>)[triggerType || ''] ?? 'pi pi-bolt';
}

function configString(config: Record<string, unknown>, key: string) {
  const value = config?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function outgoingEdgeCount(nodeKey: string) {
  return edges.value.filter((edge) => edge.fromNodeKey === nodeKey).length;
}

function incomingEdgeCount(nodeKey: string) {
  return edges.value.filter((edge) => edge.toNodeKey === nodeKey).length;
}

function blockSummary(node: NodeRow) {
  const config = node.config ?? {};
  if (node.nodeType === 'agent_step') {
    const model = configString(config, 'model');
    const prompt = configString(config, 'promptTemplate');
    return model ? `Model: ${model}` : (prompt ? `Prompt: ${prompt.replace(/\s+/g, ' ')}` : 'Prompt not configured');
  }
  if (node.nodeType === 'http_request') {
    const method = configString(config, 'method') || 'GET';
    const url = configString(config, 'url');
    return url ? `${method} ${url}` : `${method} URL not set`;
  }
  if (node.nodeType === 'script') {
    const source = configString(config, 'source').replace(/\s+/g, ' ');
    return source || 'Script not configured';
  }
  if (node.nodeType === 'conditional') {
    return configString(config, 'expression') || 'Expression not configured';
  }
  if (node.nodeType === 'parallel') {
    const count = outgoingEdgeCount(node.nodeKey);
    return `${count} outgoing branch${count === 1 ? '' : 'es'}`;
  }
  if (node.nodeType === 'join') {
    const strategy = configString(config, 'strategy') || 'all';
    return `Strategy: ${strategy} • ${incomingEdgeCount(node.nodeKey)} incoming`;
  }
  return 'Configured block';
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
  if (trigger.triggerType === 'time_schedule') return cfg.cron || (cfg.intervalMinutes ? `Every ${cfg.intervalMinutes}m` : 'Cron not set');
  if (trigger.triggerType === 'exact_datetime') return cfg.datetime || 'Date/time not set';
  if (trigger.triggerType === 'webhook') {
    const p = (cfg.path || '').toString();
    const path = p ? (p.startsWith('/') ? p : `/${p}`) : 'Path not set';
    const paramCount = Array.isArray(cfg.parameters) ? cfg.parameters.length : 0;
    return paramCount > 0 ? `${path} • ${paramCount} param${paramCount === 1 ? '' : 's'}` : path;
  }
  if (trigger.triggerType === 'event') return cfg.eventName ? `${cfg.eventName}${cfg.eventScope ? ` • ${cfg.eventScope}` : ''}` : 'Event not set';
  if (trigger.triggerType === 'jira_changes_notification') return cfg.jql ? `JQL: ${cfg.jql}` : 'JQL not set';
  if (trigger.triggerType === 'jira_polling') {
    const interval = cfg.intervalMinutes ? `Every ${cfg.intervalMinutes}m` : 'Interval not set';
    return cfg.jql ? `${interval} • ${cfg.jql}` : interval;
  }
  return formatTriggerConfiguration(trigger);
}

function isDraftTrigger(trigger: CanvasTrigger): trigger is DraftTrigger {
  return 'draftId' in trigger;
}

function triggerCanvasKey(trigger: CanvasTrigger) {
  return isDraftTrigger(trigger) ? `draft:${trigger.draftId}` : `saved:${trigger.id ?? ''}`;
}

function findCanvasTriggerByKey(key: string) {
  if (key.startsWith('draft:')) {
    const draftId = key.slice('draft:'.length);
    return draftTriggers.value.find((trigger) => trigger.draftId === draftId) ?? null;
  }

  if (key.startsWith('saved:')) {
    const triggerId = key.slice('saved:'.length);
    return triggers.value.find((trigger) => trigger.id === triggerId) ?? null;
  }

  return null;
}

function isCanvasTriggerSelected(trigger: CanvasTrigger) {
  return isDraftTrigger(trigger)
    ? selectedDraftTriggerId.value === trigger.draftId
    : selectedTriggerId.value === trigger.id;
}

function selectCanvasTrigger(trigger: CanvasTrigger) {
  if (isDraftTrigger(trigger)) {
    selectDraftTrigger(trigger.draftId);
    return;
  }

  if (trigger.id) selectTrigger(trigger.id);
}

function cloneDraftTrigger(trigger: DraftTrigger): DraftTrigger {
  return {
    draftId: trigger.draftId,
    triggerType: trigger.triggerType,
    configuration: JSON.parse(JSON.stringify(trigger.configuration ?? {})),
    isActive: trigger.isActive !== false,
    entryNodeKey: trigger.entryNodeKey ?? null,
    positionX: trigger.positionX,
    positionY: trigger.positionY,
  };
}

function persistDraftTriggers(drafts = draftTriggers.value) {
  if (typeof window === 'undefined') return;
  const serializableDrafts = drafts.map((trigger) => cloneDraftTrigger(trigger));
  if (serializableDrafts.length === 0) {
    window.sessionStorage.removeItem(draftTriggerStorageKey.value);
    return;
  }
  window.sessionStorage.setItem(draftTriggerStorageKey.value, JSON.stringify(serializableDrafts));
}

function restoreDraftTriggers() {
  if (typeof window === 'undefined') return [] as DraftTrigger[];
  const raw = window.sessionStorage.getItem(draftTriggerStorageKey.value);
  if (!raw) return [] as DraftTrigger[];
  try {
    const parsed = JSON.parse(raw) as Partial<DraftTrigger>[];
    return parsed
      .filter((trigger): trigger is DraftTrigger => Boolean(trigger?.draftId && trigger.triggerType))
      .map((trigger) => cloneDraftTrigger({
        draftId: trigger.draftId,
        triggerType: trigger.triggerType,
        configuration: trigger.configuration ?? {},
        isActive: trigger.isActive !== false,
        entryNodeKey: trigger.entryNodeKey ?? null,
        positionX: typeof trigger.positionX === 'number' ? trigger.positionX : undefined,
        positionY: typeof trigger.positionY === 'number' ? trigger.positionY : undefined,
      }));
  } catch {
    window.sessionStorage.removeItem(draftTriggerStorageKey.value);
    return [] as DraftTrigger[];
  }
}

function replaceDraftTriggers(drafts: DraftTrigger[]) {
  draftTriggers.value = drafts.map((trigger) => cloneDraftTrigger(trigger));
  persistDraftTriggers();
}

function markDirty() { if (props.readonly) return; dirty.value = true; }

// Inspector
function toggleInspector() { inspectorExpanded.value = !inspectorExpanded.value; }

function collapseInspector() {
  inspectorExpanded.value = false;
  selectedNodeKey.value = null;
  selectedTriggerId.value = null;
  selectedDraftTriggerId.value = null;
  selectedEdgeIdx.value = null;
}

function selectNode(nodeKey: string) {
  selectedNodeKey.value = nodeKey;
  selectedTriggerId.value = null;
  selectedDraftTriggerId.value = null;
  selectedEdgeIdx.value = null;
  triggerCreateMode.value = false;
  editingTriggerId.value = null;
  inspectorExpanded.value = true;
}

function selectEdge(idx: number) {
  selectedEdgeIdx.value = idx;
  selectedNodeKey.value = null;
  selectedTriggerId.value = null;
  selectedDraftTriggerId.value = null;
  editingTriggerId.value = null;
  triggerCreateMode.value = false;
  inspectorExpanded.value = true;
}

function selectTrigger(triggerId: string) {
  const trigger = triggers.value.find((t) => t.id === triggerId);
  if (!trigger) return;
  selectedTriggerId.value = triggerId;
  selectedDraftTriggerId.value = null;
  selectedNodeKey.value = null;
  selectedEdgeIdx.value = null;
  triggerCreateMode.value = false;
  editingTriggerId.value = triggerId;
  Object.assign(editTriggerForm, {
    id: trigger.id ?? '',
    triggerType: trigger.triggerType,
    configuration: JSON.parse(JSON.stringify(trigger.configuration ?? {})),
    isActive: trigger.isActive !== false,
    entryNodeKey: trigger.entryNodeKey ?? null,
  });
  inspectorExpanded.value = true;
}

function selectDraftTrigger(draftId: string) {
  const draft = draftTriggers.value.find((t) => t.draftId === draftId);
  if (!draft) return;
  selectedDraftTriggerId.value = draftId;
  selectedTriggerId.value = null;
  selectedNodeKey.value = null;
  selectedEdgeIdx.value = null;
  editingTriggerId.value = null;
  Object.assign(createTriggerForm, {
    triggerType: draft.triggerType,
    configuration: JSON.parse(JSON.stringify(draft.configuration ?? {})),
    isActive: draft.isActive !== false,
    entryNodeKey: draft.entryNodeKey ?? null,
    positionX: draft.positionX,
    positionY: draft.positionY,
  });
  triggerCreateMode.value = true;
  inspectorExpanded.value = true;
}

watch(selectedNode, (node) => {
  configJson.value = JSON.stringify(node?.config ?? {}, null, 2);
  configYaml.value = node ? yamlStringify(node.config ?? {}, { lineWidth: 100 }) : '';
  httpHeadersYaml.value = yamlForValue(node?.config?.headers);
  httpBodyYaml.value = yamlForValue(node?.config?.body);
  yamlConfigErrors.headers = null;
  yamlConfigErrors.body = null;
  configError.value = null;
});

// YAML view of the current node's config (used for Parallel / fallback editor).
const configYaml = ref('');
function onConfigYamlChange(value: string) {
  configYaml.value = value;
  if (!selectedNode.value) return;
  try {
    selectedNode.value.config = (value.trim() ? (yamlParse(value) as Record<string, unknown>) : {}) ?? {};
    configError.value = null;
    configJson.value = JSON.stringify(selectedNode.value.config, null, 2);
    markDirty();
  } catch (e) {
    configError.value = e instanceof Error ? e.message : String(e);
  }
}

// Per-key YAML editing for HTTP (headers / body) so each value gets its own pane.
const yamlConfigErrors = reactive<Record<string, string | null>>({});
const httpHeadersYaml = ref('');
const httpBodyYaml = ref('');

function yamlForValue(v: unknown) {
  if (v === undefined || v === null || v === '') return '';
  return yamlStringify(v, { lineWidth: 100 });
}

function onHttpYamlConfigChange(key: 'headers' | 'body', value: string) {
  if (key === 'headers') httpHeadersYaml.value = value;
  if (key === 'body') httpBodyYaml.value = value;
  if (!selectedNode.value) return;
  if (!value.trim()) {
    yamlConfigErrors[key] = null;
    setConfigValue(key, null);
    return;
  }
  try {
    const parsed = yamlParse(value);
    yamlConfigErrors[key] = null;
    setConfigValue(key, parsed as unknown);
  } catch (e) {
    yamlConfigErrors[key] = e instanceof Error ? e.message : String(e);
  }
}

function getConfigString(key: string) { const v = selectedNode.value?.config?.[key]; return typeof v === 'string' && v ? v : null; }
function getConfigText(key: string) { const v = selectedNode.value?.config?.[key]; return typeof v === 'string' ? v : ''; }
function getConfigNumber(key: string, fallback: number) { const v = selectedNode.value?.config?.[key]; return typeof v === 'number' ? v : fallback; }
function setConfigValue(key: string, value: unknown) {
  if (!selectedNode.value) return;
  selectedNode.value.config = { ...(selectedNode.value.config ?? {}), [key]: value === undefined || value === '' ? null : value };
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
    const w = nodeWidth;
    const h = nodeHeight;
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
  selectedTriggerId.value = null;
  selectedDraftTriggerId.value = null;
  editingTriggerId.value = null;
  triggerCreateMode.value = false;
}

// Keyboard: Delete / Backspace removes the selected edge or node when the
// canvas is focused (i.e. user is not typing in an input).
function onKeydownDelete(event: KeyboardEvent) {
  if (props.readonly) return;
  const target = event.target as HTMLElement | null;
  const inField = target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);
  // Undo / Redo
  if (!inField && (event.metaKey || event.ctrlKey) && (event.key === 'z' || event.key === 'Z')) {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
    return;
  }
  if (!inField && (event.metaKey || event.ctrlKey) && (event.key === 'y' || event.key === 'Y')) {
    event.preventDefault();
    redo();
    return;
  }
  if (event.key !== 'Delete' && event.key !== 'Backspace') return;
  if (inField) return;
  if (selectedEdgeIdx.value !== null) {
    event.preventDefault();
    removeEdge(selectedEdgeIdx.value);
  } else if (selectedNode.value) {
    event.preventDefault();
    deleteNode(selectedNode.value.nodeKey);
  }
}
onMounted(() => { window.addEventListener('keydown', onKeydownDelete); });
onBeforeUnmount(() => { window.removeEventListener('keydown', onKeydownDelete); });

// Node drag
function startDrag(node: NodeRow, event: MouseEvent) {
  if (props.readonly) return;
  event.preventDefault();
  selectNode(node.nodeKey);
  pushUndo();
  const { x: sx, y: sy } = svgCoords(event);
  const ox = node.positionX; const oy = node.positionY;
  function onMove(e: MouseEvent) {
    const { x, y } = svgCoords(e);
    let nx = Math.max(0, ox + (x - sx));
    let ny = Math.max(0, oy + (y - sy));
    // Alignment guides: snap to other nodes' centers within tolerance
    const tol = 6;
    let alignH: number | null = null;
    let alignV: number | null = null;
    for (const other of nodes.value) {
      if (other.nodeKey === node.nodeKey) continue;
      if (Math.abs(other.positionX - nx) < tol) { nx = other.positionX; alignV = nx; }
      if (Math.abs(other.positionY - ny) < tol) { ny = other.positionY; alignH = ny; }
    }
    if (snapToGrid.value && alignH === null && alignV === null) {
      nx = snap(nx);
      ny = snap(ny);
    }
    alignmentGuides.value = { horizontal: alignH, vertical: alignV };
    node.positionX = nx;
    node.positionY = ny;
    markDirty();
  }
  function onUp() {
    alignmentGuides.value = { horizontal: null, vertical: null };
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
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

// --- Trigger geometry / dragging ---
function triggerPos(t: CanvasTrigger) {
  const key = triggerCanvasKey(t);
  const idx = canvasTriggers.value.findIndex((x) => triggerCanvasKey(x) === key);
  return {
    x: typeof t.positionX === 'number' ? t.positionX : 40,
    y: typeof t.positionY === 'number' ? t.positionY : 40 + Math.max(0, idx) * (triggerHeight + 12),
  };
}
function triggerOutputPort(t: CanvasTrigger) {
  const p = triggerPos(t);
  return { x: p.x + triggerWidth, y: p.y + triggerHeight / 2 };
}

const triggerEntryLines = computed(() => {
  return canvasTriggers.value.map((t) => {
    const from = triggerOutputPort(t);
    // Default entry: first non-start regular node when entryNodeKey is unset.
    const fallbackKey = regularNodes.value[0]?.nodeKey ?? null;
    const targetKey = (t.entryNodeKey && nodes.value.find((n) => n.nodeKey === t.entryNodeKey))
      ? t.entryNodeKey
      : fallbackKey;
    if (!targetKey) return { path: null };
    const to = nodeInputPort(targetKey);
    if (!to) return { path: null };
    const target = shortenPathEnd(from, to, 13);
    const cx = Math.abs(to.x - from.x) * 0.45 + 40;
    return { path: `M ${from.x},${from.y} C ${from.x + cx},${from.y} ${target.x - cx},${target.y} ${target.x},${target.y}` };
  });
});

const triggerEntryOptions = computed(() => nodes.value
  .map((n) => ({ label: `${n.nodeKey} — ${n.name}`, value: n.nodeKey })));

function startTriggerDrag(trigger: CanvasTrigger, event: MouseEvent) {
  if (props.readonly) return;
  event.preventDefault();
  selectCanvasTrigger(trigger);
  const startSvg = svgCoords(event);
  const start = triggerPos(trigger);
  let moved = false;
  function onMove(e: MouseEvent) {
    const cur = svgCoords(e);
    const nx = Math.max(0, Math.round(start.x + (cur.x - startSvg.x)));
    const ny = Math.max(0, Math.round(start.y + (cur.y - startSvg.y)));
    if (nx !== trigger.positionX || ny !== trigger.positionY) {
      trigger.positionX = nx;
      trigger.positionY = ny;
      moved = true;
    }
  }
  async function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (moved && !isDraftTrigger(trigger) && trigger.id) {
      try {
        await $fetch(`/api/triggers/${trigger.id}`, { method: 'PUT', headers, body: { positionX: trigger.positionX, positionY: trigger.positionY } });
      } catch (err: any) {
        toast.add({ severity: 'error', summary: 'Failed to save trigger position', detail: err?.data?.error || String(err), life: 4000 });
      }
    } else if (moved && isDraftTrigger(trigger) && selectedDraftTriggerId.value === trigger.draftId) {
      createTriggerForm.positionX = trigger.positionX;
      createTriggerForm.positionY = trigger.positionY;
      persistDraftTriggers();
    }
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// Trigger -> node entry connection drawing
const drawingTriggerEntry = ref<{ triggerKey: string; x1: number; y1: number; x2: number; y2: number } | null>(null);
const drawingTriggerEntryPath = computed(() => {
  if (!drawingTriggerEntry.value) return '';
  const { x1, y1, x2, y2 } = drawingTriggerEntry.value;
  const cx = Math.abs(x2 - x1) * 0.45 + 40;
  return `M ${x1},${y1} C ${x1 + cx},${y1} ${x2 - cx},${y2} ${x2},${y2}`;
});

function startTriggerEntryDraw(trigger: CanvasTrigger, event: MouseEvent) {
  if (props.readonly) return;
  event.preventDefault();
  const port = triggerOutputPort(trigger);
  drawingTriggerEntry.value = { triggerKey: triggerCanvasKey(trigger), x1: port.x, y1: port.y, x2: port.x, y2: port.y };
}

async function completeTriggerEntryDraw(targetNodeKey: string) {
  if (!drawingTriggerEntry.value) return;
  const triggerKey = drawingTriggerEntry.value.triggerKey;
  drawingTriggerEntry.value = null;
  const trigger = findCanvasTriggerByKey(triggerKey);
  if (!trigger) return;
  const entryNodeKey = targetNodeKey;
  if ((trigger.entryNodeKey ?? null) === entryNodeKey) return;
  trigger.entryNodeKey = entryNodeKey;
  if (isDraftTrigger(trigger)) {
    if (selectedDraftTriggerId.value === trigger.draftId) createTriggerForm.entryNodeKey = entryNodeKey;
    persistDraftTriggers();
    return;
  }
  if (!trigger.id) return;

  try {
    await $fetch(`/api/triggers/${trigger.id}`, { method: 'PUT', headers, body: { entryNodeKey } });
    toast.add({ severity: 'success', summary: 'Entry point updated', life: 2000 });
  } catch (err: any) {
    toast.add({ severity: 'error', summary: 'Failed to set entry node', detail: err?.data?.error || String(err), life: 4000 });
  }
}

function onNodeInputMouseUp(nodeKey: string) {
  if (drawingTriggerEntry.value) { completeTriggerEntryDraw(nodeKey); return; }
  completeEdgeDraw(nodeKey);
}

function startEdgeDraw(nodeKey: string, event: MouseEvent) {
  if (props.readonly) return;
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
  if (drawingEdge.value) {
    const { x, y } = svgCoords(event);
    drawingEdge.value.x2 = x;
    drawingEdge.value.y2 = y;
  }
  if (drawingTriggerEntry.value) {
    const { x, y } = svgCoords(event);
    drawingTriggerEntry.value.x2 = x;
    drawingTriggerEntry.value.y2 = y;
  }
}

function onSvgMouseUp() {
  drawingEdge.value = null;
  drawingTriggerEntry.value = null;
}

// Palette drop
async function onDrop(event: DragEvent) {
  if (props.readonly) return;
  const nodeType = event.dataTransfer?.getData('oao/nodeType') as NodeType | undefined;
  if (nodeType) {
    const { x, y } = svgCoords(event);
    addNodeAt(nodeType, Math.max(10, x - nodeWidth / 2), Math.max(10, y - nodeHeight / 2));
    return;
  }
  const triggerType = event.dataTransfer?.getData('oao/triggerType');
  if (triggerType) {
    const found = (triggerTypes.value as TriggerCatalogEntry[]).find((t) => t.type === triggerType);
    if (!found) return;
    const { x, y } = svgCoords(event);
    createDraftTrigger(found, {
      x: Math.max(10, Math.round(x - triggerWidth / 2)),
      y: Math.max(10, Math.round(y - triggerHeight / 2)),
    });
  }
}

// Node management
function addNodeAt(nodeType: NodeType, x: number, y: number) {
  pushUndo();
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
  if (props.readonly) return;
  pushUndo();
  nodes.value = nodes.value.filter((n) => n.nodeKey !== nodeKey);
  edges.value = edges.value.filter((e) => e.fromNodeKey !== nodeKey && e.toNodeKey !== nodeKey);
  collapseInspector();
  markDirty();
}

function addEdge() {
  pushUndo();
  const fromKey = regularNodes.value[0]?.nodeKey ?? '';
  const toKey = regularNodes.value.find((n) => n.nodeKey !== fromKey)?.nodeKey ?? '';
  if (!fromKey || !toKey) return;
  edges.value.push({ fromNodeKey: fromKey, toNodeKey: toKey, branchKey: null, label: null });
  markDirty();
}

function removeEdge(index: number) {
  pushUndo();
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
    const result = props.versionData
      ? (props.versionData as GraphResponse)
      : await $fetch<GraphResponse>(`/api/workflow-graph/${props.workflowId}/graph`, { headers });
    nodes.value = (result.nodes ?? [])
      .map((n) => ({ ...n, config: (n.config ?? {}) as Record<string, unknown>, positionX: n.positionX ?? 0, positionY: n.positionY ?? 0 }));
    edges.value = result.edges ?? [];
    steps.value = result.steps ?? [];
    triggers.value = result.triggers ?? [];
    draftTriggers.value = props.readonly ? [] : restoreDraftTriggers();
    dirty.value = false;
    selectedNodeKey.value = null;
    selectedTriggerId.value = null;
    selectedDraftTriggerId.value = null;
    selectedEdgeIdx.value = null;
    editingTriggerId.value = null;
    triggerCreateMode.value = false;
    undoStack.value = [];
    redoStack.value = [];
  } catch (error: any) {
    errorMsg.value = error?.data?.error || 'Failed to load visual workflow.';
  } finally {
    loading.value = false;
  }
}

function validateBeforeSave() {
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
  if (props.readonly) return;
  const err = validateBeforeSave();
  if (err) { errorMsg.value = err; return; }
  errorMsg.value = null; okMsg.value = null; saving.value = true;
  try {
    const result = await $fetch<{ syncedSteps?: number }>(`/api/workflow-graph/${props.workflowId}/graph`, {
      method: 'PUT', headers, body: { nodes: nodes.value, edges: edges.value },
    });
    await loadGraph();
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
const editingTriggerId = ref<string | null>(null);
const savingTrigger = ref(false);
const testingTriggerId = ref<string | null>(null);
const createTriggerForm = reactive<WorkflowTriggerLike>({ triggerType: '', configuration: {}, isActive: true, entryNodeKey: null });
const editTriggerForm = reactive<WorkflowTriggerLike & { id: string }>({ id: '', triggerType: '', configuration: {}, isActive: true, entryNodeKey: null });
const triggerConnectivityResults = reactive<Record<string, { ok: boolean; message?: string; summary?: string }>>({});
let draftTriggerCounter = 0;

function resetCreateTriggerForm() { Object.assign(createTriggerForm, { triggerType: '', configuration: {}, isActive: true, entryNodeKey: null, positionX: undefined, positionY: undefined }); }

function beginCreateTrigger() {
  const firstType = (triggerTypes.value as TriggerCatalogEntry[])[0];
  if (firstType) createDraftTrigger(firstType);
}

function beginCreateTriggerOfType(tt: TriggerCatalogEntry) { createDraftTrigger(tt); }

function nextDraftTriggerPosition() {
  return {
    x: 40,
    y: 40 + canvasTriggers.value.length * (triggerHeight + 12),
  };
}

function createDraftTrigger(triggerType: TriggerCatalogEntry, position = nextDraftTriggerPosition()) {
  const draft = createTriggerDraft(triggerType) as WorkflowTriggerLike;
  draftTriggerCounter += 1;
  const trigger: DraftTrigger = {
    draftId: `draft-${Date.now()}-${draftTriggerCounter}`,
    triggerType: draft.triggerType,
    configuration: draft.configuration,
    isActive: draft.isActive,
    entryNodeKey: null,
    positionX: position.x,
    positionY: position.y,
  };
  draftTriggers.value.push(trigger);
  persistDraftTriggers();
  selectDraftTrigger(trigger.draftId);
}

function cancelCreateTrigger() {
  const draftId = selectedDraftTriggerId.value;
  if (draftId) {
    draftTriggers.value = draftTriggers.value.filter((trigger) => trigger.draftId !== draftId);
  }
  persistDraftTriggers();
  selectedDraftTriggerId.value = null;
  triggerCreateMode.value = false;
  resetCreateTriggerForm();
}

async function loadGraphKeepingDrafts(drafts = draftTriggers.value) {
  const preservedDrafts = drafts.map((trigger) => cloneDraftTrigger(trigger));
  persistDraftTriggers(preservedDrafts);
  await loadGraph();
  draftTriggers.value = preservedDrafts;
  persistDraftTriggers(preservedDrafts);
}

watch(createTriggerForm, (form) => {
  const draft = selectedDraftTrigger.value;
  if (!draft || !triggerCreateMode.value) return;
  draft.triggerType = form.triggerType;
  draft.configuration = JSON.parse(JSON.stringify(form.configuration ?? {}));
  draft.isActive = form.isActive !== false;
  draft.entryNodeKey = form.entryNodeKey ?? null;
  if (typeof form.positionX === 'number') draft.positionX = form.positionX;
  if (typeof form.positionY === 'number') draft.positionY = form.positionY;
  persistDraftTriggers();
}, { deep: true });

async function handleCreateTrigger() {
  const draft = selectedDraftTrigger.value ? cloneDraftTrigger(selectedDraftTrigger.value) : null;
  const remainingDrafts = draftTriggers.value
    .map((trigger) => cloneDraftTrigger(trigger))
    .filter((trigger) => !draft || trigger.draftId !== draft.draftId);
  savingTrigger.value = true;
  try {
    const body: Record<string, any> = {
      workflowId: props.workflowId,
      triggerType: createTriggerForm.triggerType,
      configuration: createTriggerForm.configuration,
      isActive: createTriggerForm.isActive,
      entryNodeKey: createTriggerForm.entryNodeKey ?? null,
    };
    if (typeof draft?.positionX === 'number') body.positionX = draft.positionX;
    if (typeof draft?.positionY === 'number') body.positionY = draft.positionY;
    const result = await $fetch<{ trigger?: WorkflowTriggerLike }>('/api/triggers', { method: 'POST', headers, body });
    replaceDraftTriggers(remainingDrafts);
    selectedDraftTriggerId.value = null;
    triggerCreateMode.value = false;
    resetCreateTriggerForm();
    toast.add({ severity: 'success', summary: 'Trigger added', life: 3000 });
    if (result.trigger?.id) {
      triggers.value = [...triggers.value.filter((trigger) => trigger.id !== result.trigger?.id), result.trigger];
      selectTrigger(result.trigger.id);
    } else {
      await loadGraphKeepingDrafts(remainingDrafts);
    }
    persistDraftTriggers(remainingDrafts);
    emit('triggersChanged');
    await nextTick();
    persistDraftTriggers(remainingDrafts);
  } catch (error: any) {
    const details = Array.isArray(error?.data?.issues) ? error.data.issues.map((i: any) => i.message).filter(Boolean).join('; ') : '';
    toast.add({ severity: 'error', summary: 'Error', detail: details || error?.data?.error || 'Failed', life: 5000 });
  } finally { savingTrigger.value = false; }
}

async function handleSaveEditedTrigger() {
  if (!editingTriggerId.value) return;
  const triggerId = editingTriggerId.value;
  savingTrigger.value = true;
  try {
    await $fetch(`/api/triggers/${triggerId}`, { method: 'PUT', headers, body: { triggerType: editTriggerForm.triggerType, configuration: editTriggerForm.configuration, isActive: editTriggerForm.isActive, entryNodeKey: editTriggerForm.entryNodeKey ?? null } });
    toast.add({ severity: 'success', summary: 'Trigger saved', life: 3000 });
    await loadGraphKeepingDrafts();
    selectTrigger(triggerId);
    emit('triggersChanged');
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
      await loadGraphKeepingDrafts(); emit('triggersChanged');
    },
  });
}

await loadGraph();
</script>

<style scoped>
/* ─── n8n-inspired editor polish ──────────────────────────────────── */

/* Fullscreen overlay: cover the full viewport with a clean white surface so
   the editor feels like a true workspace (n8n-style). */
.oao-wfeditor-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 1000;
  padding: 12px;
  background: #f8fafc;
  overflow: auto;
}
.oao-wfeditor-fullscreen :deep(svg) {
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}

/* Slide-over inspector drawer animation. */
.oao-drawer-enter-active,
.oao-drawer-leave-active {
  transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease;
}
.oao-drawer-enter-from,
.oao-drawer-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.oao-inspector-drawer {
  /* Subtle backdrop separation when overlaying the canvas. */
  box-shadow: -8px 0 24px -12px rgba(15, 23, 42, 0.18);
}

/* Tighten typography in the inspector to match n8n information density. */
.oao-inspector-drawer :deep(label) {
  font-size: 11px;
  letter-spacing: 0.01em;
}
.oao-inspector-drawer :deep(.p-inputtext),
.oao-inspector-drawer :deep(.p-select) {
  font-size: 12.5px;
}
</style>
