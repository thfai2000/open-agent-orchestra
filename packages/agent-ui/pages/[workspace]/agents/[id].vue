<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink href="/agents">Agents</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>{{ agent?.name || 'Agent' }}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div v-if="agent" class="space-y-6 mt-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-bold">{{ agent.name }}</h1>
          <p v-if="agent.description && !editing" class="text-muted-foreground mt-1">{{ agent.description }}</p>
        </div>
        <div class="flex items-center gap-3">
          <Button v-if="!editing" @click="startEdit">✏️ Edit Agent</Button>
          <Button variant="outline" @click="toggleStatus"
            :class="agent.status === 'active' ? 'border-yellow-500 text-yellow-600' : 'border-green-500 text-green-600'">
            {{ agent.status === 'active' ? 'Pause' : 'Activate' }}
          </Button>
          <Button variant="destructive" size="sm" @click="handleDelete">Delete</Button>
          <Badge :variant="agent.status === 'active' ? 'default' : agent.status === 'paused' ? 'secondary' : 'destructive'">
            {{ agent.status }}
          </Badge>
          <Badge v-if="agent.scope === 'workspace'" variant="outline">Workspace</Badge>
          <Badge v-else variant="outline" class="text-muted-foreground">Personal</Badge>
        </div>
      </div>

      <!-- Inline Edit Form -->
      <Card v-if="editing" class="border-primary/30">
        <CardHeader><CardTitle>Edit Agent</CardTitle></CardHeader>
        <CardContent>
          <div v-if="editError" class="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">{{ editError }}</div>
          <form @submit.prevent="handleSave" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="space-y-2">
                <Label>Name *</Label>
                <Input v-model="editForm.name" required />
              </div>
              <div class="space-y-2">
                <Label>Source Type</Label>
                <select v-model="editForm.sourceType" disabled
                  class="w-full px-3 py-2 rounded-md border border-input bg-muted text-sm">
                  <option value="github_repo">GitHub Repository</option>
                  <option value="database">Database Storage</option>
                </select>
                <p class="text-xs text-muted-foreground">Source type cannot be changed after creation.</p>
              </div>
            </div>
            <template v-if="editForm.sourceType === 'github_repo'">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-2">
                  <Label>Git Repository URL *</Label>
                  <Input v-model="editForm.gitRepoUrl" type="url" required />
                </div>
                <div class="space-y-2">
                  <Label>Git Branch</Label>
                  <Input v-model="editForm.gitBranch" />
                </div>
                <div class="space-y-2">
                  <Label>Agent File Path *</Label>
                  <Input v-model="editForm.agentFilePath" required />
                </div>
                <div class="space-y-2">
                  <Label>Skills Directory</Label>
                  <Input v-model="editForm.skillsDirectory" placeholder="skills/" />
                  <p class="text-xs text-muted-foreground">Directory containing .md skill files (relative to repo root)</p>
                </div>
              </div>
              <div class="space-y-2">
                <Label>GitHub Token</Label>
                <select v-model="editForm.githubTokenSource"
                  class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring max-w-md">
                  <option value="">No credential / Enter manually</option>
                  <option v-for="cred in credentials" :key="cred.id" :value="cred.id">{{ cred.key }} ({{ cred.scopeLabel }})</option>
                </select>
                <Input v-if="!editForm.githubTokenSource" v-model="editForm.githubToken" type="password" class="max-w-md" placeholder="Leave blank to keep current, or enter new token (ghp_...)" />
                <p v-if="editForm.githubTokenSource" class="text-xs text-muted-foreground">Token will be read from the selected credential at execution time.</p>
              </div>
            </template>
            <div class="space-y-2">
              <Label>Description</Label>
              <Textarea v-model="editForm.description" rows="2" />
            </div>
            <div class="flex gap-3 pt-2">
              <Button type="submit" :disabled="saving">{{ saving ? 'Saving...' : 'Save Changes' }}</Button>
              <Button variant="outline" type="button" @click="editing = false">Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <!-- View Configuration -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle class="text-base">Configuration</CardTitle></CardHeader>
          <CardContent>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between"><dt class="text-muted-foreground">Source Type</dt><dd><Badge variant="outline">{{ (agent as any).sourceType === 'database' ? 'Database' : 'GitHub Repo' }}</Badge></dd></div>
              <template v-if="(agent as any).sourceType !== 'database'">
                <div class="flex justify-between"><dt class="text-muted-foreground">Git Repo</dt><dd class="font-mono text-xs truncate max-w-[250px]">{{ agent.gitRepoUrl }}</dd></div>
                <div class="flex justify-between"><dt class="text-muted-foreground">Branch</dt><dd class="font-mono text-xs">{{ agent.gitBranch || 'main' }}</dd></div>
                <div class="flex justify-between"><dt class="text-muted-foreground">Agent File</dt><dd class="font-mono text-xs">{{ agent.agentFilePath }}</dd></div>
                <div v-if="(agent as any).skillsDirectory" class="flex justify-between"><dt class="text-muted-foreground">Skills Dir</dt><dd class="font-mono text-xs">{{ (agent as any).skillsDirectory }}</dd></div>
              </template>
              <div class="flex justify-between"><dt class="text-muted-foreground">Last Session</dt><dd>{{ agent.lastSessionAt ? new Date(agent.lastSessionAt).toLocaleString() : 'Never' }}</dd></div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle class="text-base">Info</CardTitle></CardHeader>
          <CardContent>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between"><dt class="text-muted-foreground">ID</dt><dd class="font-mono text-xs">{{ agent.id?.substring(0, 8) }}…</dd></div>
              <div class="flex justify-between"><dt class="text-muted-foreground">Scope</dt><dd><Badge :variant="agent.scope === 'workspace' ? 'default' : 'secondary'">{{ agent.scope === 'workspace' ? 'Workspace' : 'Personal' }}</Badge></dd></div>
              <div class="flex justify-between"><dt class="text-muted-foreground">Created</dt><dd>{{ new Date(agent.createdAt).toLocaleDateString() }}</dd></div>
              <div class="flex justify-between"><dt class="text-muted-foreground">Updated</dt><dd>{{ new Date(agent.updatedAt).toLocaleDateString() }}</dd></div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <!-- Agent Files Section (Database source only) -->
      <Card v-if="(agent as any).sourceType === 'database'">
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>Agent Files</CardTitle>
              <CardDescription>Markdown files stored in database. The first root-level .md file is the main agent instruction.</CardDescription>
            </div>
            <Button size="sm" @click="showFileForm = true">+ Add File</Button>
          </div>
        </CardHeader>
        <CardContent>
          <!-- New File Form -->
          <div v-if="showFileForm" class="mb-4 p-4 rounded-lg border border-border bg-muted/30">
            <div v-if="fileError" class="mb-3 p-2 rounded-md bg-destructive/10 text-destructive text-sm">{{ fileError }}</div>
            <form @submit.prevent="handleCreateFile" class="space-y-3">
              <div class="space-y-1.5">
                <Label class="text-xs">File Path *</Label>
                <Input v-model="fileForm.filePath" required placeholder="agent.md or skills/research.md" class="font-mono" />
                <p class="text-xs text-muted-foreground">Use forward slashes for subdirectories.</p>
              </div>
              <div class="space-y-1.5">
                <Label class="text-xs">Content *</Label>
                <Textarea v-model="fileForm.content" required rows="8" class="font-mono text-xs" placeholder="# Agent Instructions&#10;&#10;Your markdown content..." />
              </div>
              <div class="flex gap-2">
                <Button type="submit" size="sm" :disabled="savingFile">{{ savingFile ? 'Creating...' : 'Create File' }}</Button>
                <Button variant="outline" size="sm" type="button" @click="showFileForm = false; fileError = ''">Cancel</Button>
              </div>
            </form>
          </div>

          <!-- File List -->
          <div class="space-y-2">
            <div v-for="f in agentFiles" :key="f.id"
              class="rounded-lg border border-border overflow-hidden">
              <div class="flex items-center justify-between p-3 bg-muted/30 cursor-pointer" @click="toggleFileExpand(f.id)">
                <div class="flex items-center gap-2">
                  <span class="text-xs">{{ expandedFileId === f.id ? '▼' : '▶' }}</span>
                  <span class="font-mono text-sm font-medium">{{ f.filePath }}</span>
                  <Badge v-if="isMainAgentFile(f.filePath)" variant="default" class="text-[10px]">Main</Badge>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-muted-foreground">{{ new Date(f.updatedAt).toLocaleDateString() }}</span>
                  <Button variant="ghost" size="sm" class="h-7 text-xs" @click.stop="startEditFile(f)">Edit</Button>
                  <Button variant="ghost" size="sm" class="text-destructive h-7 text-xs" @click.stop="handleDeleteFile(f.id, f.filePath)">Delete</Button>
                </div>
              </div>
              <!-- Preview / Edit area -->
              <div v-if="expandedFileId === f.id" class="border-t border-border">
                <div v-if="editingFileId === f.id" class="p-3">
                  <Textarea v-model="editFileContent" rows="12" class="font-mono text-xs" />
                  <div class="flex gap-2 mt-2">
                    <Button size="sm" :disabled="savingFile" @click="handleUpdateFile(f.id)">{{ savingFile ? 'Saving...' : 'Save' }}</Button>
                    <Button variant="outline" size="sm" @click="editingFileId = ''">Cancel</Button>
                  </div>
                </div>
                <div v-else class="p-3 max-h-64 overflow-auto">
                  <pre class="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{{ f.content }}</pre>
                </div>
              </div>
            </div>
            <p v-if="agentFiles.length === 0 && !showFileForm" class="text-muted-foreground text-sm">
              No agent files yet. Add your main agent instruction file to get started.
            </p>
          </div>
        </CardContent>
      </Card>

      <!-- Built-in Tools Section -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>Built-in Tools</CardTitle>
              <CardDescription>Toggle which built-in tools this agent can use during Copilot sessions.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label v-for="tool in BUILTIN_TOOLS" :key="tool.name"
              class="flex items-center gap-2 p-2 rounded-md border border-border hover:bg-muted/50 cursor-pointer">
              <Checkbox :checked="isToolEnabled(tool.name)" @update:checked="toggleBuiltinTool(tool.name, $event)" />
              <div>
                <p class="text-sm font-medium">{{ tool.label }}</p>
                <p class="text-xs text-muted-foreground">{{ tool.description }}</p>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      <!-- Agent Variables Section -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>Agent Variables</CardTitle>
              <CardDescription>Agent-level variables available to all workflow steps using this agent. They override user-level variables with the same key.</CardDescription>
            </div>
            <Button size="sm" @click="showVarForm = true">+ Add Variable</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div v-if="showVarForm" class="mb-4 p-4 rounded-lg border border-border bg-muted/30">
            <div v-if="varError" class="mb-3 p-2 rounded-md bg-destructive/10 text-destructive text-sm">{{ varError }}</div>
            <form @submit.prevent="handleAddVar" class="space-y-3">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <Label class="text-xs">Key (UPPER_SNAKE_CASE) *</Label>
                  <Input v-model="varForm.key" required pattern="^[A-Z_][A-Z0-9_]*$" class="font-mono" placeholder="API_KEY" />
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">Value *</Label>
                  <Input v-model="varForm.value" type="password" required placeholder="Secret value (encrypted at rest)" />
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <Label class="text-xs">Type *</Label>
                  <select v-model="varForm.variableType"
                    class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="credential">Credential (secret, masked)</option>
                    <option value="property">Property (can be used in prompts)</option>
                  </select>
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">Description</Label>
                  <Input v-model="varForm.description" placeholder="What is this variable for?" />
                </div>
              </div>
              <div class="flex items-center gap-3">
                <Switch :checked="varForm.injectAsEnvVariable" @update:checked="varForm.injectAsEnvVariable = $event" />
                <Label class="text-xs">Inject as .env variable in Copilot session workspace</Label>
              </div>
              <div v-if="varForm.variableType === 'property'" class="p-3 rounded-md bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-700 dark:text-blue-300">
                💡 <strong>Tip:</strong> Properties can be referenced in agent prompt templates using <code class="bg-blue-100 dark:bg-blue-900 px-1 rounded">{{ propertyHint }}</code>
              </div>
              <div class="flex gap-2">
                <Button type="submit" size="sm" :disabled="savingVar">{{ savingVar ? 'Saving...' : 'Save Variable' }}</Button>
                <Button variant="outline" size="sm" type="button" @click="showVarForm = false">Cancel</Button>
              </div>
            </form>
          </div>

          <div class="space-y-2">
            <div v-for="v in agentVariables" :key="v.id"
              class="p-3 rounded-lg border border-border flex items-center justify-between">
              <div class="flex items-center gap-3">
                <Badge :variant="v.variableType === 'credential' ? 'destructive' : 'secondary'" class="text-[10px]">{{ v.variableType }}</Badge>
                <div>
                  <p class="font-mono font-semibold text-sm">{{ v.key }}</p>
                  <p v-if="v.description" class="text-xs text-muted-foreground">{{ v.description }}</p>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <Badge v-if="v.injectAsEnvVariable" variant="outline" class="text-[10px]">.env</Badge>
                <span class="text-xs text-muted-foreground font-mono">••••••••</span>
                <Button variant="ghost" size="sm" class="text-destructive h-7 text-xs" @click="handleDeleteVar(v.id, v.key)">Delete</Button>
              </div>
            </div>
            <p v-if="agentVariables.length === 0 && !showVarForm" class="text-muted-foreground text-sm">No agent-level variables stored.</p>
          </div>
        </CardContent>
      </Card>

      <!-- MCP Servers Section -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>MCP Servers</CardTitle>
              <CardDescription>Model Context Protocol servers that provide custom tools to this agent during Copilot sessions.</CardDescription>
            </div>
            <Button size="sm" @click="showMcpForm = true; mcpEditId = ''">+ Add MCP Server</Button>
          </div>
        </CardHeader>
        <CardContent>
          <!-- MCP Server Form (Add / Edit) -->
          <div v-if="showMcpForm" class="mb-4 p-4 rounded-lg border border-border bg-muted/30">
            <div v-if="mcpError" class="mb-3 p-2 rounded-md bg-destructive/10 text-destructive text-sm">{{ mcpError }}</div>
            <form @submit.prevent="handleSaveMcp" class="space-y-3">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <Label class="text-xs">Name *</Label>
                  <Input v-model="mcpForm.name" required placeholder="e.g. playwright-mcp" />
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">Command *</Label>
                  <Input v-model="mcpForm.command" required placeholder="e.g. npx, node, python" class="font-mono" />
                </div>
              </div>
              <div class="space-y-1.5">
                <Label class="text-xs">Arguments (one per line)</Label>
                <Textarea v-model="mcpForm.argsText" rows="2" placeholder="@anthropic/mcp-playwright&#10;--headless" class="font-mono text-xs" />
                <p class="text-xs text-muted-foreground">Each line becomes a separate argument passed to the command.</p>
              </div>
              <div class="space-y-1.5">
                <Label class="text-xs">Description</Label>
                <Input v-model="mcpForm.description" placeholder="What does this MCP server do?" />
              </div>
              <div class="space-y-1.5">
                <Label class="text-xs">Environment Variable Mapping (JSON)</Label>
                <Textarea v-model="mcpForm.envMappingText" rows="3" placeholder='{ "CREDENTIAL_KEY": "ENV_VAR_NAME" }' class="font-mono text-xs" />
                <p class="text-xs text-muted-foreground">Maps agent credential keys (left) to environment variable names (right) passed to the MCP server process.</p>
              </div>
              <div class="space-y-1.5">
                <Label class="text-xs">Write Tools (comma-separated)</Label>
                <Input v-model="mcpForm.writeToolsText" placeholder="execute_trade, delete_record" class="font-mono text-xs" />
                <p class="text-xs text-muted-foreground">Tool names that require explicit permission approval before execution.</p>
              </div>
              <div class="flex items-center gap-3">
                <Switch :checked="mcpForm.isEnabled" @update:checked="mcpForm.isEnabled = $event" />
                <Label class="text-xs">Enabled</Label>
              </div>
              <div class="flex gap-2">
                <Button type="submit" size="sm" :disabled="savingMcp">{{ savingMcp ? 'Saving...' : (mcpEditId ? 'Update Server' : 'Add Server') }}</Button>
                <Button variant="outline" size="sm" type="button" @click="showMcpForm = false; mcpError = ''">Cancel</Button>
              </div>
            </form>
          </div>

          <div class="space-y-2">
            <div v-for="mcp in mcpServers" :key="mcp.id" class="p-3 rounded-lg border border-border">
              <div class="flex items-center justify-between">
                <div>
                  <p class="font-semibold text-sm">{{ mcp.name }}</p>
                  <p v-if="mcp.description" class="text-xs text-muted-foreground">{{ mcp.description }}</p>
                  <p class="text-xs text-muted-foreground font-mono mt-1">{{ mcp.command }} {{ (mcp.args || []).join(' ') }}</p>
                  <div class="flex gap-2 mt-1">
                    <Badge v-if="Object.keys(mcp.envMapping || {}).length" variant="outline" class="text-[10px]">
                      {{ Object.keys(mcp.envMapping).length }} env vars
                    </Badge>
                    <Badge v-if="(mcp.writeTools || []).length" variant="outline" class="text-[10px]">
                      {{ mcp.writeTools.length }} write tools
                    </Badge>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <Badge :variant="mcp.isEnabled ? 'default' : 'secondary'">{{ mcp.isEnabled ? 'Enabled' : 'Disabled' }}</Badge>
                  <Button variant="ghost" size="sm" class="h-7 text-xs" @click="startEditMcp(mcp)">Edit</Button>
                  <Button variant="ghost" size="sm" class="text-destructive h-7 text-xs" @click="handleDeleteMcp(mcp.id, mcp.name)">Delete</Button>
                </div>
              </div>
            </div>
          </div>
          <p v-if="mcpServers.length === 0 && !showMcpForm" class="text-muted-foreground text-sm">No MCP servers configured. Add an MCP server to extend this agent's capabilities.</p>
        </CardContent>
      </Card>

      <!-- MCP JSON Template Section -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>MCP JSON Template</CardTitle>
              <CardDescription>Jinja2 template that renders to a <code class="bg-muted px-1 rounded text-xs">mcp.json</code> configuration. MCP servers defined here are spawned alongside DB-configured servers. Use <code class="bg-muted px-1 rounded text-xs">{{ templateHintProps }}</code> and <code class="bg-muted px-1 rounded text-xs">{{ templateHintCreds }}</code> for variable substitution.</CardDescription>
            </div>
            <div class="flex items-center gap-2">
              <Button v-if="!editingMcpTemplate" size="sm" variant="outline" @click="startEditMcpTemplate">{{ (agent as any)?.mcpJsonTemplate ? 'Edit' : 'Add Template' }}</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <!-- Edit form -->
          <div v-if="editingMcpTemplate" class="space-y-3">
            <div v-if="mcpTemplateError" class="p-2 rounded-md bg-destructive/10 text-destructive text-sm">{{ mcpTemplateError }}</div>
            <Textarea v-model="mcpTemplateContent" rows="14" class="font-mono text-xs"
              :placeholder='mcpTemplatePlaceholder' />
            <div class="p-3 rounded-md bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-700 dark:text-blue-300 space-y-1">
              <p><strong>Jinja2 Variables:</strong></p>
              <p><code class="bg-blue-100 dark:bg-blue-900 px-1 rounded">{{ templateHintProps }}</code> — Agent/user/workspace properties</p>
              <p><code class="bg-blue-100 dark:bg-blue-900 px-1 rounded">{{ templateHintCreds }}</code> — Agent/user/workspace credentials</p>
              <p>The rendered output must be valid JSON with a <code class="bg-blue-100 dark:bg-blue-900 px-1 rounded">mcpServers</code> key mapping server names to <code class="bg-blue-100 dark:bg-blue-900 px-1 rounded">{ command, args?, env? }</code> objects.</p>
            </div>
            <div class="flex gap-2">
              <Button size="sm" :disabled="savingMcpTemplate" @click="handleSaveMcpTemplate">{{ savingMcpTemplate ? 'Saving...' : 'Save Template' }}</Button>
              <Button variant="outline" size="sm" @click="editingMcpTemplate = false; mcpTemplateError = ''">Cancel</Button>
              <Button v-if="(agent as any)?.mcpJsonTemplate" variant="ghost" size="sm" class="text-destructive" @click="handleClearMcpTemplate">Remove Template</Button>
            </div>
          </div>
          <!-- View -->
          <div v-else-if="(agent as any)?.mcpJsonTemplate" class="max-h-64 overflow-auto">
            <pre class="whitespace-pre-wrap font-mono text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">{{ (agent as any).mcpJsonTemplate }}</pre>
          </div>
          <p v-else class="text-muted-foreground text-sm">No MCP JSON template configured. Add a Jinja2 template to dynamically configure MCP servers with variable substitution.</p>
        </CardContent>
      </Card>

      <!-- Plugins Section -->
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Plugins</CardTitle>
            <CardDescription>Enable or disable available plugins for this agent. Plugins add tools, skills, and MCP servers to Copilot sessions.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div v-if="pluginsLoading" class="text-muted-foreground text-sm">Loading plugins...</div>
          <div class="space-y-2">
            <div v-for="p in agentPlugins" :key="p.id"
              class="p-3 rounded-lg border border-border flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div>
                  <p class="font-semibold text-sm">{{ p.name }}</p>
                  <p v-if="p.description" class="text-xs text-muted-foreground">{{ p.description }}</p>
                  <div class="flex gap-2 mt-1">
                    <Badge v-if="(p.manifestCache as any)?.tools?.length" variant="outline" class="text-[10px]">
                      {{ (p.manifestCache as any).tools.length }} tools
                    </Badge>
                    <Badge v-if="(p.manifestCache as any)?.skills?.length" variant="outline" class="text-[10px]">
                      {{ (p.manifestCache as any).skills.length }} skills
                    </Badge>
                    <Badge v-if="(p.manifestCache as any)?.mcpServers?.length" variant="outline" class="text-[10px]">
                      {{ (p.manifestCache as any).mcpServers.length }} MCP servers
                    </Badge>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <Switch :checked="p.isEnabled" @update:checked="togglePlugin(p.id, $event)" />
                <Badge :variant="p.isEnabled ? 'default' : 'secondary'" class="w-16 justify-center">
                  {{ p.isEnabled ? 'On' : 'Off' }}
                </Badge>
              </div>
            </div>
          </div>
          <p v-if="agentPlugins.length === 0 && !pluginsLoading" class="text-muted-foreground text-sm">
            No plugins available. Admin must register and allow plugins first.
          </p>
        </CardContent>
      </Card>
    </div>
    <p v-else class="text-muted-foreground mt-4">Agent not found.</p>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const ws = computed(() => (route.params.workspace as string) || 'default');
const agentId = route.params.id as string;

const BUILTIN_TOOLS = [
  { name: 'schedule_next_workflow_execution', label: 'Schedule Next Workflow Execution', description: 'Self-scheduling via exact datetime triggers' },
  { name: 'manage_webhook_trigger', label: 'Manage Webhook Trigger', description: 'Webhook lifecycle management' },
  { name: 'record_decision', label: 'Record Decision', description: 'Audit trail for agent decisions' },
  { name: 'memory_store', label: 'Memory Store', description: 'Store semantic memories (pgvector)' },
  { name: 'memory_retrieve', label: 'Memory Retrieve', description: 'Retrieve memories via similarity search' },
  { name: 'edit_workflow', label: 'Edit Workflow', description: 'Edit triggers and steps' },
  { name: 'read_variables', label: 'Read Variables', description: 'Read properties and credentials' },
  { name: 'edit_variables', label: 'Edit Variables', description: 'Create/update/delete variables' },
  { name: 'simple_http_request', label: 'Simple HTTP Request', description: 'Curl-like HTTP requests with Jinja2 templating on all arguments' },
];

const { data: agentData, refresh: refreshAgent } = await useFetch(`/api/agents/${agentId}`, { headers });
const { data: varData, refresh: refreshVars } = await useFetch(`/api/variables?agentId=${agentId}`, { headers });
const { data: mcpData, refresh: refreshMcp } = await useFetch(`/api/mcp-servers?agentId=${agentId}`, { headers });
const { data: pluginData, pending: pluginsLoading, refresh: refreshPlugins } = await useFetch(`/api/plugins/agent/${agentId}`, { headers });

// Agent files for database source
const { data: filesData, refresh: refreshFiles } = await useFetch(`/api/agent-files/${agentId}`, { headers });

const agent = computed(() => agentData.value?.agent);
const agentVariables = computed(() => varData.value?.variables ?? []);
const mcpServers = computed(() => mcpData.value?.servers ?? []);
const agentPlugins = computed(() => (pluginData.value as any)?.plugins ?? []);
const agentFiles = computed(() => (filesData.value as any)?.files ?? []);

// Credentials for GitHub token selector
const { data: userVarData } = await useFetch('/api/variables?scope=user', { headers });
const { data: wsVarData } = await useFetch('/api/variables?scope=workspace', { headers });
const credentials = computed(() => {
  const userCreds = (userVarData.value as any)?.variables?.filter((v: any) => v.variableType === 'credential') ?? [];
  const wsCreds = (wsVarData.value as any)?.variables?.filter((v: any) => v.variableType === 'credential') ?? [];
  return [
    ...userCreds.map((v: any) => ({ ...v, scopeLabel: 'Personal' })),
    ...wsCreds.map((v: any) => ({ ...v, scopeLabel: 'Workspace' })),
  ];
});

// ── Inline Edit ─────────────────────────────────────────────────
const editing = ref(false);
const saving = ref(false);
const editError = ref('');
const editForm = reactive({ name: '', description: '', sourceType: 'github_repo' as string, gitRepoUrl: '', gitBranch: '', agentFilePath: '', skillsDirectory: '', githubToken: '', githubTokenSource: '' as string });

function startEdit() {
  Object.assign(editForm, {
    name: agent.value?.name || '', description: agent.value?.description || '',
    sourceType: (agent.value as any)?.sourceType || 'github_repo',
    gitRepoUrl: agent.value?.gitRepoUrl || '', gitBranch: agent.value?.gitBranch || 'main',
    agentFilePath: agent.value?.agentFilePath || '', skillsDirectory: (agent.value as any)?.skillsDirectory || '',
    githubToken: '', githubTokenSource: (agent.value as any)?.githubTokenCredentialId || '',
  });
  editError.value = '';
  editing.value = true;
}

async function handleSave() {
  editError.value = '';
  saving.value = true;
  try {
    const body: Record<string, unknown> = {
      name: editForm.name, description: editForm.description || undefined,
    };
    if (editForm.sourceType === 'github_repo') {
      body.gitRepoUrl = editForm.gitRepoUrl;
      body.gitBranch = editForm.gitBranch;
      body.agentFilePath = editForm.agentFilePath;
      body.skillsDirectory = editForm.skillsDirectory || null;
      if (editForm.githubTokenSource) {
        body.githubTokenCredentialId = editForm.githubTokenSource;
      } else if (editForm.githubToken) {
        body.githubToken = editForm.githubToken;
      } else if ((agent.value as any)?.githubTokenCredentialId) {
        // Credential was cleared — explicitly send null to remove the reference
        body.githubTokenCredentialId = null;
      }
    }
    await $fetch(`/api/agents/${agentId}`, { method: 'PUT', headers, body });
    editing.value = false;
    await refreshAgent();
  } catch (e: any) { editError.value = e?.data?.error || 'Failed to save agent'; }
  finally { saving.value = false; }
}

async function toggleStatus() {
  const newStatus = agent.value?.status === 'active' ? 'paused' : 'active';
  try { await $fetch(`/api/agents/${agentId}`, { method: 'PUT', headers, body: { status: newStatus } }); await refreshAgent(); }
  catch { alert('Failed to update agent status'); }
}

async function handleDelete() {
  if (!confirm(`Delete agent "${agent.value?.name}"? This cannot be undone.`)) return;
  try { await $fetch(`/api/agents/${agentId}`, { method: 'DELETE', headers }); router.push(`/${ws.value}/agents`); }
  catch { alert('Failed to delete agent'); }
}

// ── Variable management ─────────────────────────────────────────
const showVarForm = ref(false);
const savingVar = ref(false);
const varError = ref('');
const varForm = reactive({ key: '', value: '', description: '', variableType: 'credential' as string, injectAsEnvVariable: false });
const propertyHint = computed(() => `{{ properties.${varForm.key || 'KEY_NAME'} }}`);

async function handleAddVar() {
  varError.value = '';
  savingVar.value = true;
  try {
    await $fetch('/api/variables', {
      method: 'POST', headers,
      body: { agentId, key: varForm.key, value: varForm.value, description: varForm.description || undefined, variableType: varForm.variableType, injectAsEnvVariable: varForm.injectAsEnvVariable },
    });
    showVarForm.value = false;
    Object.assign(varForm, { key: '', value: '', description: '', variableType: 'credential', injectAsEnvVariable: false });
    await refreshVars();
  } catch (e: any) { varError.value = e?.data?.error || 'Failed to save variable'; }
  finally { savingVar.value = false; }
}

async function handleDeleteVar(id: string, key: string) {
  if (!confirm(`Delete variable "${key}"?`)) return;
  try { await $fetch(`/api/variables/${id}`, { method: 'DELETE', headers }); await refreshVars(); }
  catch { alert('Failed to delete variable'); }
}

// ── Plugin management ───────────────────────────────────────────
async function togglePlugin(pluginId: string, enabled: boolean) {
  try {
    await $fetch(`/api/plugins/agent/${agentId}/${pluginId}`, {
      method: 'PUT',
      headers,
      body: { isEnabled: enabled },
    });
    await refreshPlugins();
  } catch {
    alert('Failed to update plugin');
  }
}

// ── MCP Server management ───────────────────────────────────────
const showMcpForm = ref(false);
const savingMcp = ref(false);
const mcpError = ref('');
const mcpEditId = ref('');

// ── MCP JSON Template management ────────────────────────────────
const editingMcpTemplate = ref(false);
const savingMcpTemplate = ref(false);
const mcpTemplateError = ref('');
const mcpTemplateContent = ref('');
const templateHintProps = '{{ properties.KEY }}';
const templateHintCreds = '{{ credentials.KEY }}';
const mcpTemplatePlaceholder = `{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@some/mcp-server"],
      "env": {
        "API_KEY": "{{ credentials.API_KEY }}"
      }
    }
  }
}`;

function startEditMcpTemplate() {
  mcpTemplateContent.value = (agent.value as any)?.mcpJsonTemplate || '';
  mcpTemplateError.value = '';
  editingMcpTemplate.value = true;
}

async function handleSaveMcpTemplate() {
  mcpTemplateError.value = '';
  savingMcpTemplate.value = true;
  try {
    await $fetch(`/api/agents/${agentId}`, {
      method: 'PUT', headers,
      body: { mcpJsonTemplate: mcpTemplateContent.value || null },
    });
    editingMcpTemplate.value = false;
    await refreshAgent();
  } catch (e: any) {
    mcpTemplateError.value = e?.data?.error || 'Failed to save MCP JSON template';
  } finally {
    savingMcpTemplate.value = false;
  }
}

async function handleClearMcpTemplate() {
  if (!confirm('Remove the MCP JSON template?')) return;
  savingMcpTemplate.value = true;
  try {
    await $fetch(`/api/agents/${agentId}`, {
      method: 'PUT', headers,
      body: { mcpJsonTemplate: null },
    });
    editingMcpTemplate.value = false;
    await refreshAgent();
  } catch {
    alert('Failed to remove template');
  } finally {
    savingMcpTemplate.value = false;
  }
}
const mcpForm = reactive({
  name: '',
  command: '',
  argsText: '',
  description: '',
  envMappingText: '{}',
  writeToolsText: '',
  isEnabled: true,
});

function resetMcpForm() {
  Object.assign(mcpForm, { name: '', command: '', argsText: '', description: '', envMappingText: '{}', writeToolsText: '', isEnabled: true });
  mcpEditId.value = '';
}

function startEditMcp(mcp: any) {
  mcpEditId.value = mcp.id;
  Object.assign(mcpForm, {
    name: mcp.name,
    command: mcp.command,
    argsText: (mcp.args || []).join('\n'),
    description: mcp.description || '',
    envMappingText: JSON.stringify(mcp.envMapping || {}, null, 2),
    writeToolsText: (mcp.writeTools || []).join(', '),
    isEnabled: mcp.isEnabled ?? true,
  });
  showMcpForm.value = true;
  mcpError.value = '';
}

async function handleSaveMcp() {
  mcpError.value = '';
  // Parse envMapping JSON
  let envMapping: Record<string, string> = {};
  try {
    envMapping = JSON.parse(mcpForm.envMappingText || '{}');
  } catch {
    mcpError.value = 'Invalid JSON in Environment Variable Mapping';
    return;
  }
  const args = mcpForm.argsText.split('\n').map(a => a.trim()).filter(Boolean);
  const writeTools = mcpForm.writeToolsText.split(',').map(t => t.trim()).filter(Boolean);

  savingMcp.value = true;
  try {
    const body = {
      agentId,
      name: mcpForm.name,
      command: mcpForm.command,
      args,
      description: mcpForm.description || undefined,
      envMapping,
      writeTools,
      isEnabled: mcpForm.isEnabled,
    };

    if (mcpEditId.value) {
      await $fetch(`/api/mcp-servers/${mcpEditId.value}`, { method: 'PUT', headers, body });
    } else {
      await $fetch('/api/mcp-servers', { method: 'POST', headers, body });
    }
    showMcpForm.value = false;
    resetMcpForm();
    await refreshMcp();
  } catch (e: any) { mcpError.value = e?.data?.error || 'Failed to save MCP server'; }
  finally { savingMcp.value = false; }
}

async function handleDeleteMcp(id: string, name: string) {
  if (!confirm(`Delete MCP server "${name}"?`)) return;
  try {
    await $fetch(`/api/mcp-servers/${id}`, { method: 'DELETE', headers });
    await refreshMcp();
  } catch { alert('Failed to delete MCP server'); }
}

// ── Built-in Tools management ───────────────────────────────────
function isToolEnabled(name: string): boolean {
  const enabled = (agent.value as any)?.builtinToolsEnabled;
  if (!enabled || !Array.isArray(enabled)) return true; // default: all enabled
  return enabled.includes(name);
}

async function toggleBuiltinTool(name: string, checked: boolean | string) {
  const current: string[] = Array.isArray((agent.value as any)?.builtinToolsEnabled)
    ? [...(agent.value as any).builtinToolsEnabled]
    : BUILTIN_TOOLS.map(t => t.name);
  const updated = checked
    ? [...new Set([...current, name])]
    : current.filter(t => t !== name);
  try {
    await $fetch(`/api/agents/${agentId}`, { method: 'PUT', headers, body: { builtinToolsEnabled: updated } });
    await refreshAgent();
  } catch {
    alert('Failed to update built-in tools');
  }
}

// ── Agent Files management (database source) ─────────────────────
const showFileForm = ref(false);
const savingFile = ref(false);
const fileError = ref('');
const fileForm = reactive({ filePath: '', content: '' });
const expandedFileId = ref('');
const editingFileId = ref('');
const editFileContent = ref('');

function isMainAgentFile(filePath: string): boolean {
  const rootMdFiles = agentFiles.value
    .filter((f: any) => f.filePath.endsWith('.md') && !f.filePath.includes('/'))
    .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return rootMdFiles.length > 0 && rootMdFiles[0].filePath === filePath;
}

function toggleFileExpand(id: string) {
  expandedFileId.value = expandedFileId.value === id ? '' : id;
  if (expandedFileId.value !== id) editingFileId.value = '';
}

function startEditFile(f: any) {
  expandedFileId.value = f.id;
  editingFileId.value = f.id;
  editFileContent.value = f.content;
}

async function handleCreateFile() {
  fileError.value = '';
  savingFile.value = true;
  try {
    await $fetch(`/api/agent-files/${agentId}`, {
      method: 'POST', headers,
      body: { filePath: fileForm.filePath, content: fileForm.content },
    });
    showFileForm.value = false;
    Object.assign(fileForm, { filePath: '', content: '' });
    await refreshFiles();
  } catch (e: any) { fileError.value = e?.data?.error || 'Failed to create file'; }
  finally { savingFile.value = false; }
}

async function handleUpdateFile(fileId: string) {
  savingFile.value = true;
  try {
    await $fetch(`/api/agent-files/${agentId}/${fileId}`, {
      method: 'PUT', headers,
      body: { content: editFileContent.value },
    });
    editingFileId.value = '';
    await refreshFiles();
  } catch { alert('Failed to update file'); }
  finally { savingFile.value = false; }
}

async function handleDeleteFile(fileId: string, filePath: string) {
  if (!confirm(`Delete "${filePath}"?`)) return;
  try {
    await $fetch(`/api/agent-files/${agentId}/${fileId}`, { method: 'DELETE', headers });
    if (expandedFileId.value === fileId) expandedFileId.value = '';
    await refreshFiles();
  } catch { alert('Failed to delete file'); }
}
</script>
