# Public types: kiwipow-agent

1076 public types.

## src/agent/agent-dir-ignore.ts
export async function ensureAgentDirIgnored(cwd: string): Promise<" " | " " | " "> (line 12)
## src/agent/cleanup/breach.ts
export type Measure = " " | " " (line 2)
export type Breach = { measure: Measure; value: number; limit: number } (line 5)
export function describeBreaches(breaches: Breach[]): string (line 8)
## src/agent/cleanup/oversized.ts
export type Thresholds = { functionLines: number; functionComplexity: number; typeLines: number; fileLines: number } (line 11)
export type Limits = { source: Thresholds; tests: Thresholds; testGlobs: string[] } (line 17)
export const DEFAULT_TEST_GLOBS = [" ", " ", " ", " ", " "] (line 25)
export type Oversized = Unit & { path: string; breaches: Breach[] } (line 32)
export const anyLimit = (limits: Limits): boolean => anyOf(limits.source) || anyOf(limits.tests) (line 43)
export function oversized(path: string, units: Unit[], thresholds: Thresholds): Oversized[] (line 57)
export async function oversizedFiles(cwd: string, files: string[], limits: Limits, ignore: string[]): Promise<Oversized[]> (line 69)
export function sizeReport(cwd: string, items: Oversized[]): string (line 94)
## src/agent/cleanup/unit-complexity.ts
export function cognitiveComplexity(name: string, body: CodeItem[], family: Language[" "]): number (line 11)
## src/agent/cleanup/unit-size.ts
export type UnitKind = " " | " " | " " (line 6)
export type Unit = { kind: UnitKind; name: string; line: number; lines: number; complexity?: number } (line 12)
export function measureUnits(path: string, text: string): Unit[] (line 20)
  measure(declarations)
## src/agent/code-outline/code-outline-gate.ts
export const OUTLINE_THRESHOLD_LINES = 200 (line 11)
export const CODE_READING = " " (line 14)
export class CodeOutlineGate implements SessionHooks (line 24)
  constructor(private readonly cwd: string) {}
  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome>
  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome>
## src/agent/code-outline/code-outline-tool.ts
export const CODE_OUTLINE_TOOL = " " (line 18)
export const codeOutlineTool: Tool<typeof schema> = (line 21)
  name: CODE_OUTLINE_TOOL
## src/agent/code-outline/code-search.ts
export const CODE_SEARCH_TOOL = " " (line 10)
export function codeSearchTool(canRead: (relPath: string) => boolean = () => true): Tool<typeof schema> (line 31)
## src/agent/code-outline/outline.ts
export type CodeNode = Declaration (line 5)
export function outlineCode(path: string, text: string): CodeNode[] (line 8)
export type Outline = { nodes: CodeNode[] } | { tests: TestNode[] } (line 13)
export function outlineFile(path: string, text: string): Outline | undefined (line 15)
export const rangeStart = (node: CodeNode): number => Math.min(node.line, node.doc?.line ?? node.line) (line 23)
export type Location = { chain: CodeNode[]; inDoc: boolean } (line 26)
export function declarationAt(nodes: CodeNode[], line: number): Location | undefined (line 28)
export const qualifiedName = (chain: CodeNode[]): string => chain.map((n) => n.name).join(" ") (line 38)
export type SymbolMatch = { qualified: string; node: CodeNode } (line 40)
export function findSymbols(nodes: CodeNode[], query: string): SymbolMatch[] (line 43)
  visit(nodes, [])
## src/agent/code-outline/render.ts
export type FileOutline = { path: string; nodes: CodeNode[] } | { path: string; tests: TestNode[] } (line 7)
export function summaryOf(doc: string): string (line 15)
export function renderNodes(nodes: CodeNode[], options: { maxDepth?: number; docs?: boolean } = {}, depth = 0): string[] (line 23)
export function renderFiles(files: FileOutline[], nestedRepositories: string[], budget = DEFAULT_BUDGET): string (line 43)
export type SymbolHit = { path: string; qualified: string; node: CodeNode } (line 61)
export function renderSymbols(hits: SymbolHit[]): string (line 64)
## src/agent/code-structure/declarations.ts
export type Declaration = { kind: " " | " "; name: string; line: number; endLine: number; doc?: Doc; children: Declaration[] } (line 10)
export type FileDeclarations = { declarations: Declaration[]; code: string[]; family: Language[" "]; bodies: Map<Declaration, CodeItem[]> } (line 13)
export function readDeclarations(path: string, text: string): FileDeclarations (line 15)
## src/agent/code-structure/language.ts
export type Language = (line 7)
  family: " " | " "
  lineComments: string[]
  blockComments: " " | " " | " "
  singleQuoteStrings: boolean
  backtick: " " | " " | " "
  tripleQuotes: boolean
  dollarHoles: boolean
  csharpStrings: boolean
  rustStrings: boolean
  cRawStrings: boolean
  preprocessor: boolean
  swiftStrings: boolean
  objectLiterals: boolean
export const GENERIC: Language = (line 79)
export function languageOf(path: string): Language | undefined (line 115)
## src/agent/code-structure/strip-literals.ts
export function stripLiterals(text: string, lang: Language): string (line 10)
## src/agent/docs-map/build.ts
export type DocsMapPlan = DocsDiff & (line 18)
  current: boolean
export type DocsMapResult = (line 23)
  summary: string
  described: string[]
  undescribed: string[]
export async function planDocsMap(cwd: string, ignored: string[] = []): Promise<DocsMapPlan> (line 30)
export async function startDocsMap(cwd: string, ignored: string[] = []): Promise<DocsMapPlan> (line 41)
export async function docsMapIsStale(cwd: string, ignored: string[] = []): Promise<boolean> (line 48)
export const readDocsSummary = (cwd: string): Promise<string | undefined> => readMapFile(cwd, SUMMARY_FILE) (line 54)
export async function finishDocsMap(cwd: string, ignored: string[] = []): Promise<DocsMapResult> (line 61)
## src/agent/docs-map/doc-index.ts
export type ScannedDoc = { path: string; hash: string } (line 18)
export type DocsIndex = Record<string, string> (line 21)
export type DocsDiff = { changed: string[]; removed: string[] } (line 24)
export const hashDoc = (text: string): string => (line 27)
export async function scanDocs(cwd: string, ignored: string[] = []): Promise<ScannedDoc[]> (line 34)
export async function docPaths(cwd: string, ignored: string[] = []): Promise<string[]> (line 45)
export function diffDocs(scanned: ScannedDoc[], index: DocsIndex): DocsDiff (line 51)
export async function readDocsIndex(cwd: string): Promise<DocsIndex> (line 61)
export async function writeDocsIndex(cwd: string, index: DocsIndex): Promise<void> (line 77)
## src/agent/docs-map/entry.ts
export type MappedHeading = { heading: string; line: string } (line 20)
export type DocsMapEntry = (line 22)
  doc: string
  summary: string
  headings: MappedHeading[]
  problems: string[]
export function docHeadings(text: string): string[] (line 42)
export function parseEntry(text: string): DocsMapEntry (line 49)
export function checkEntry(entry: DocsMapEntry, headings: string[]): string[] (line 83)
export function docOfEntry(path: string): string | undefined (line 103)
export class DocsMapContract implements SessionHooks (line 113)
  constructor(private readonly cwd: string) {}
  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome>
export function entryProblems(file: string, problems: string[]): string (line 137)
## src/agent/docs-map/map-files.ts
export const DOCS_MAP_ROOT = " " (line 18)
export const ENTRY_DIR = " " (line 21)
export const SUMMARY_FILE = " " (line 24)
export const INDEX_FILE = " " (line 27)
export const docsMapRoot = (cwd: string): string => join(cwd, ...DOCS_MAP_ROOT.split(" ")) (line 29)
export const entryPath = (doc: string): string => " " (line 32)
export const entryFile = (doc: string): string => " " (line 35)
export const indexFile = (cwd: string): string => join(docsMapRoot(cwd), INDEX_FILE) (line 37)
export const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0) (line 40)
export const mapText = (text: string): string => " " (line 46)
export const readMapFile = (cwd: string, path: string): Promise<string | undefined> => (line 49)
export async function writeMapFile(cwd: string, path: string, text: string): Promise<void> (line 56)
export async function listEntries(cwd: string): Promise<string[]> (line 65)
export async function removeEntry(cwd: string, doc: string): Promise<void> (line 81)
## src/agent/docs-map/outline-map.ts
export const OPENING_LIMIT = 300 (line 14)
export async function renderOutlineMap(cwd: string, ignored: string[] = []): Promise<string | undefined> (line 16)
export function outlineEntry(path: string, text: string): string (line 25)
## src/agent/docs-map/session-context.ts
export const wantsDocsMap = (mode: string): boolean => (line 32)
export type DocsMapSource = GeneratedSource (line 35)
export type DocsMapContext = GeneratedContext (line 36)
export type DocsMapStyle = " " | " " (line 43)
export type DocsMapOptions = ContextOptions & { style?: DocsMapStyle } (line 45)
export const workspaceDocsMap = ( (line 51)
export const outlineDocsMap = (read: () => Promise<string | undefined>): DocsMapSource => ( (line 62)
export const docsMapContext = (source: DocsMapSource, options: DocsMapOptions = {}): Promise<DocsMapContext> => (line 68)
export function docsMapSection(context: DocsMapContext, style: DocsMapStyle = " "): string (line 72)
export async function withDocsMap( (line 96)
## src/agent/docs-map/summary.ts
export type Undescribed = string (line 11)
export function renderDocsSummary(entries: DocsMapEntry[], undescribed: Undescribed[]): string (line 13)
## src/agent/edits/edit-tools.ts
export function isFileEdit(toolName: string): boolean (line 13)
export function isDiffable(toolName: string): boolean (line 17)
export function editedPath(input: unknown): string | undefined (line 22)
export function applyEdits(before: string, toolName: string, input: unknown): string[] | undefined (line 34)
## src/agent/edits/edited-files.ts
export function editedFiles(events: SessionEvent[]): string[] (line 9)
## src/agent/edits/file-edit-diff.ts
export const DIFF_LINE_BUDGET = 15 (line 4)
export const DIFF_CONTEXT = 3 (line 7)
export type FileEditChange = (line 15)
  path: string
  label: string
  diffs: string[]
  omitted: number
  summary?: string
  line?: number
  snapshot?: string
  added?: number
  removed?: number
export type FileEditChangeInput = (line 34)
  path: string
  label: string
  states?: string[]
  unreadable?: string
  snapshot?: string
export function omittedNotice(omitted: number): string (line 48)
export function fileEditChange(input: FileEditChangeInput): FileEditChange (line 57)
export function capDiffs(diffs: string[][], budget: number): { diffs: string[][]; omitted: number } (line 92)
## src/agent/edits/file-edit-recorder.ts
export type FileEditRecorderOptions = (line 30)
  cwd: string
  runDir: string
export class FileEditRecorder implements SessionHooks (line 47)
  constructor(private readonly options: FileEditRecorderOptions) {}
  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome>
  async decorate(event: SessionEvent): Promise<SessionEvent>
## src/agent/edits/open-edit.ts
export function runsRoot(workspaceRoot: string): string (line 11)
export function isRunSnapshot(root: string, snapshot: string): boolean (line 20)
export function editLine(line: number | undefined, lineCount: number): number (line 30)
export function editDiffTitle(label: string): string (line 36)
## src/agent/edits/unified-diff.ts
export type DiffStats = { added: number; removed: number } (line 17)
export function splitLines(text: string): string[] (line 20)
export function unifiedDiff(before: string, after: string, context = 3): string[] (line 32)
export function diffStats(before: string, after: string): DiffStats (line 55)
export function firstChangedLine(before: string, after: string): number | undefined (line 69)
## src/agent/instructions/agents-md-tidy.ts
export const TIDY_WORDS = 1500 (line 9)
export function ownWords(agentsText: string): number (line 12)
export function agentsMdTidyKickoff(scope: BundleScope, agentsPath: string): string (line 17)
## src/agent/instructions/bundle-sources.ts
export const PRODUCT_CATALOG_SOURCE = " " (line 12)
export const CATALOG_FILE = " " (line 15)
export function bundleSources(personSources: readonly string[], workspaceSources: readonly string[]): string[] (line 18)
export function pendingSources(sources: readonly string[], accepted: ReadonlySet<string>): string[] (line 29)
export function fetchableSources(sources: readonly string[], accepted: ReadonlySet<string>): string[] (line 34)
export type SourceCatalog = { bundles: Bundle[]; required: string[] } (line 66)
export function parseCatalogSource(text: string, source: string): SourceCatalog (line 69)
export type GitPort = { fetchCatalogText(repo: string): Promise<string | undefined> } (line 85)
export type SourceCachePort = (line 88)
  read(source: string): Promise<{ text: string; fetchedAt: string } | undefined>
export type FetchedSource = { source: string; bundles: Bundle[]; required: string[]; reachable: boolean; asOf?: string } (line 94)
export async function fetchSource(source: string, git: GitPort, cache: SourceCachePort, now: () => string = () => new Date().toISOString()): Promise<FetchedSource> (line 102)
export function catalogBundles(fetched: readonly FetchedSource[]): Bundle[] (line 117)
export type RequiredBundle = { source: string; name: string } (line 122)
export function requiredBundles(fetched: readonly FetchedSource[]): RequiredBundle[] (line 125)
export function missingRequiredBundles(required: readonly RequiredBundle[], applied: readonly AppliedBundle[]): RequiredBundle[] (line 130)
export function requiredBundleText(source: string, text: string): string (line 135)
export async function applyRequiredBundles(fetched: readonly FetchedSource[], applied: readonly AppliedBundle[], cwd: string, home?: string): Promise<AppliedBundle[]> (line 144)
export function isNewerVersion(candidate: string, current: string): boolean (line 157)
export function hashBundleText(text: string): string (line 170)
export type HandEditCheck = { scope: BundleScope; source: string; name: string; writtenHash?: string | undefined; currentText?: string | undefined } (line 175)
export type BundleUpdate = { source: string; name: string; scope: BundleScope; from: string; to: string; handEdited: boolean } (line 178)
export function bundleUpdates( (line 187)
export const gitPort: GitPort = (line 211)
  async fetchCatalogText(repo)
export function fileSourceCache(home: string): SourceCachePort (line 233)
## src/agent/instructions/bundles.ts
export type BundleScope = " " | " " (line 8)
export type BundleTarget = { kind: " " } | { kind: " "; name: string } | { kind: " "; name: string } (line 11)
export type Bundle = (line 14)
  source: string
  name: string
  version: string
  target: BundleTarget
  text: string
  asOf?: string
export type AppliedBundle = { source: string; name: string; version: string; scope: BundleScope } (line 25)
export type BundleCatalogPort = (line 28)
  available(): Promise<Bundle[]>
export function bundleFilePath(scope: BundleScope, cwd: string, home: string = homedir()): string (line 39)
export function ownText(text: string): string (line 68)
export function parseAppliedBundles(text: string, scope: BundleScope): AppliedBundle[] (line 75)
export function applyBundleText(text: string, bundle: Bundle): string (line 84)
export function removeBundleText(text: string, source: string, name: string): { text: string; removed: boolean } (line 95)
export async function appliedBundleText(scope: BundleScope, source: string, name: string, cwd: string, home: string = homedir()): Promise<string | undefined> (line 109)
export async function appliedBundles(cwd: string, home: string = homedir()): Promise<AppliedBundle[]> (line 118)
export async function applyBundle(scope: BundleScope, bundle: Bundle, cwd: string, home: string = homedir()): Promise<void> (line 125)
export async function removeBundle(scope: BundleScope, source: string, name: string, cwd: string, home: string = homedir()): Promise<void> (line 132)
export type WorkspaceSignals = { languages: ReadonlySet<string>; frameworks: ReadonlySet<string> } (line 141)
export async function workspaceSignals(cwd: string): Promise<WorkspaceSignals> (line 151)
export function bundleMatches(target: BundleTarget, holds: WorkspaceSignals): boolean (line 180)
export function matchingBundles(bundles: readonly Bundle[], holds: WorkspaceSignals): Bundle[] (line 187)
## src/agent/instructions/claude-md-move.ts
export function claudeMdPath(scope: BundleScope, cwd: string, home: string = homedir()): string (line 8)
export function mergedAgentsText(claudeText: string, existingAgentsText: string | undefined): string (line 21)
export type PendingMove = (line 29)
  scope: BundleScope
  claudePath: string
  agentsPath: string
  claudeText: string
  agentsText: string | undefined
  mergedText: string
export async function pendingMove(scope: BundleScope, cwd: string, home: string = homedir()): Promise<PendingMove | undefined> (line 39)
export function moveOfferDue(move: PendingMove | undefined, alreadyDeclined: boolean): boolean (line 55)
export async function applyMove(move: PendingMove): Promise<void> (line 64)
## src/agent/instructions/instruction-files.ts
export type InstructionFile = (line 5)
  path: string
  text: string
export function instructionFilePaths(cwd: string, home = homedir()): string[] (line 18)
export async function readInstructionFiles(cwd: string, home = homedir()): Promise<InstructionFile[]> (line 30)
export const CLASH_WITH_CORE = (line 45)
export function instructionsText(files: InstructionFile[]): string (line 49)
export const wantsInstructions = (mode: string): boolean => mode !== " " (line 54)
export async function withInstructionFiles(mode: string, systemPrompt: string, cwd: string, home: string = homedir()): Promise<string> (line 63)
## src/agent/kiwi-dir.ts
export const KIWI_DIR = " " (line 6)
export type LayoutMove = { from: string; to: string } (line 9)
export type LayoutReport = (line 11)
  moved: LayoutMove[]
  blocked: string[]
export async function migrateLayout(cwd: string, home: string): Promise<LayoutReport> (line 37)
## src/agent/mcp/mcp-connect.ts
export function connectMcp(cwd: string, onStderr: (server: string, chunk: string) => void): McpConnector (line 16)
## src/agent/mcp/mcp-connection.ts
export type McpToolInfo = { name: string; description?: string; inputSchema: Record<string, unknown> } (line 6)
export interface McpConnection (line 9)
  listTools(): Promise<McpToolInfo[]>
export type McpConnector = (name: string, config: McpServerConfig) => Promise<McpConnection> (line 16)
export function mcpTool(server: string, info: McpToolInfo, connection: McpConnection): Tool (line 26)
## src/agent/mcp/mcp-servers.ts
export class McpServerSet (line 9)
  current(): Promise<McpServers>
  async refresh(): Promise<void>
## src/agent/mcp/mcp-tool-host.ts
export class McpToolHost (line 18)
  constructor(private readonly connect: McpConnector) {}
  async load(servers: McpServers): Promise<void>
  async reconnect(name: string): Promise<void>
  tools(): Tool[]
  statuses(): McpServerState[]
  async close(): Promise<void>
## src/agent/mcp/migrate-claude-mcp.ts
export async function migrateClaudeMcpServers(home: string = homedir()): Promise<string[]> (line 21)
## src/agent/memory/memories.ts
export type MemoryScope = " " | " " (line 9)
export const MEMORY_CAP = 50 (line 12)
export function projectMemoryDir(cwd: string, home: string = homedir()): string (line 31)
export function userMemoryFile(home: string = homedir()): string (line 43)
export type MemoryEntry = { title: string; file: string; summary: string } (line 48)
export type DroppedNote = { title: string; file: string } (line 49)
export async function rebuildProjectIndex(dir: string): Promise<{ entries: MemoryEntry[]; dropped: DroppedNote[] }> (line 71)
export function enforceUserMemoryCap(text: string): { text: string; dropped: string[]; changed: boolean } (line 110)
export function userMemorySection(text: string): string | undefined (line 133)
export function removeUserMemoryBullet(text: string, title: string): string (line 155)
export function memoryPath(scope: MemoryScope, file: string, cwd: string, home: string = homedir()): string (line 169)
export async function listMemories(cwd: string, home: string = homedir()): Promise<{ project: MemoryEntry[]; user: MemoryEntry[] }> (line 179)
export async function forgetMemory(scope: MemoryScope, title: string, cwd: string, home: string = homedir()): Promise<void> (line 193)
export class MemoryContract implements SessionHooks (line 235)
  constructor(
  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome>
export function memoryWritingInstructions(cwd: string, home: string = homedir()): string (line 272)
## src/agent/memory/session-context.ts
export const wantsMemories = (mode: string): boolean => mode !== " " (line 17)
export type MemorySources = { project: string | undefined } (line 19)
export async function readMemorySources(cwd: string, home: string = homedir()): Promise<MemorySources> (line 22)
export function memorySection(sources: MemorySources): string | undefined (line 28)
export async function withMemories(mode: string, systemPrompt: string, cwd: string, home: string = homedir()): Promise<string> (line 46)
export async function chatMemorySection(cwd: string, home: string = homedir()): Promise<string | undefined> (line 60)
## src/agent/openai-session/chat-messages.ts
export type ToolCall = { id: string; name: string; arguments: string } (line 3)
export type ChatMessage = (line 5)
export type ToolDefinition = (line 11)
  name: string
  description: string
  parameters: Record<string, unknown>
export type Usage = { promptTokens: number; completionTokens: number; cachedTokens: number } (line 17)
export type CompletionDelta = (line 20)
export type CompletionRequest = (line 27)
  model: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
  maxTokens: number
  reasoningEffort?: " " | " " | " "
  signal: AbortSignal
export interface ChatCompletionClient (line 38)
  stream(request: CompletionRequest): AsyncIterable<CompletionDelta>
## src/agent/openai-session/compaction.ts
export const DEFAULT_CONTEXT_WINDOW = 128_000 (line 4)
export const COMPACT_AT = 0.9 (line 7)
export const KEEP_SHARE = 0.3 (line 10)
export const SUMMARY_MAX_TOKENS = 4096 (line 13)
export const SUMMARY_PROMPT = [ (line 15)
export function estimateTokens(message: ChatMessage): number (line 27)
export function keepFrom(messages: ChatMessage[], budget: number): number (line 38)
export function transcriptFor(messages: ChatMessage[]): string (line 56)
export async function compact( (line 81)
export function pathsReadIn(messages: ChatMessage[]): string[] (line 105)
export function isContextTooLong(error: unknown): boolean (line 123)
## src/agent/openai-session/file-ledger.ts
export type LineRange = { from: number; to: number } (line 4)
export const LEDGER_LIMIT = 60 (line 9)
export class FileLedger (line 18)
  read(path: string, offset?: number, limit?: number): void
  edited(path: string, range: LineRange): void
  written(path: string): void
  forget(path: string): void
  paths(): string[]
  render(cwd: string, limit = LEDGER_LIMIT): string
## src/agent/openai-session/history.ts
export const UNANSWERED_TOOL_RESULT = " " (line 5)
## src/agent/openai-session/openai-client.ts
export type OpenAiClientOptions = (line 3)
  baseUrl: string
  apiKey: string
  fetch?: typeof fetch
export class OpenAiClient implements ChatCompletionClient (line 14)
  constructor(private readonly options: OpenAiClientOptions)
  async listModels(): Promise<string[]>
export class ApiError extends Error (line 96)
  constructor(
export class NetworkError extends Error (line 110)
  constructor(
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> (line 184)
## src/agent/openai-session/openai-session.ts
export type OpenAiSessionOptions = (line 28)
  id: string
  profile: ModelProfile
  cwd: string
  client: ChatCompletionClient
  tools: Tool[]
  systemPrompt: string
  resume?: { engineSessionId: string; history: ChatMessage[] }
  hooks?: SessionHooks
  maxRoundsPerTurn?: number
  contextWindow?: number
  compactAtTokens?: number
  reasoningEffort?: CompletionRequest[" "]
  mcp?: { host: McpToolHost; servers: McpServers }
export class OpenAiSession implements CodeSession (line 55)
  readonly id: string
  readonly profile: ModelProfile
  readonly mcp: McpControl | undefined
  constructor(private readonly options: OpenAiSessionOptions)
  send(text: string): void
  compact(): void
  events(): AsyncIterable<SessionEvent>
  respondToPermission(requestId: string, decision: PermissionDecision): void
  respondToQuestion(requestId: string, outcome: QuestionOutcome): boolean
  async interrupt(): Promise<void>
  async dispose(): Promise<void>
  shown: { title?: string; edits?: FileEditChange[] } = {}
## src/agent/openai-session/system-prompt.ts
export async function buildSystemPrompt(cwd: string, profilePromptFile?: string, home = homedir()): Promise<string> (line 23)
## src/agent/openai-session/tools/ask-user.ts
export const askUserSchema = z.object( (line 23)
export const ASK_USER_TOOL = " " (line 27)
export const askUserTool: Tool<typeof askUserSchema> = (line 29)
  name: ASK_USER_TOOL
## src/agent/openai-session/tools/bash.ts
export function bashTool(bashPath: string = findBash()): Tool<typeof schema> (line 11)
## src/agent/openai-session/tools/edit.ts
export const EDIT_WRITING = (line 12)
export const filePath = z.string().describe(" ") (line 15)
export const textEdit = z.object( (line 17)
export type TextEdit = z.infer<typeof textEdit> (line 23)
export const editTool: Tool<typeof schema> = (line 27)
  name: " "
export type AppliedEdit = { updated: string; occurrences: number; lines: LineRange } (line 46)
export function applyEdit(content: string, edit: TextEdit, path: string): AppliedEdit | { error: string } (line 49)
## src/agent/openai-session/tools/glob.ts
export const IGNORED_DIRS = new Set([" ", " ", " ", " ", " ", " ", " ", " "]) (line 7)
export const globTool: Tool<typeof schema> = (line 14)
  name: " "
## src/agent/openai-session/tools/json.ts
export const jsonSchemaTool: Tool<typeof schemaInput> = (line 39)
  name: " "
export const jsonQueryTool: Tool<typeof queryInput> = (line 88)
  name: " "
## src/agent/openai-session/tools/json/errors.ts
export class DataError extends Error (line 2)
  constructor(
## src/agent/openai-session/tools/json/expr.ts
export type PathStep = (line 14)
export type CompareOp = " " | " " | " " | " " | " " | " " | " " | " " | " " (line 19)
export type Predicate = (line 21)
export interface ProjectionField (line 28)
  name: string
  path: PathStep[]
export type Stage = (line 33)
export interface Expression (line 40)
  path: PathStep[]
  stages: Stage[]
export class ExpressionError extends Error (line 47)
  constructor(message: string, readonly source: string, readonly offset: number)
export const MISSING = Symbol(" ") (line 55)
export function parseExpression(source: string): Expression (line 426)
export function parsePath(source: string, label: string): PathStep[] (line 433)
export function resolvePath(value: unknown, steps: readonly PathStep[]): unknown | typeof MISSING (line 451)
export function evaluatePredicate(item: unknown, predicate: Predicate): boolean (line 516)
export interface StageResult (line 536)
  kept: boolean
  value: unknown
export function applyStages(item: unknown, stages: readonly Stage[]): StageResult (line 542)
## src/agent/openai-session/tools/json/loader.ts
export const MAX_CAPTURE_NODES = 200_000 (line 15)
export type DataFormat = " " | " " (line 17)
export interface DataFile (line 19)
  relativePath: string
  format: DataFormat
  open(): Promise<Readable>
export interface Selected (line 26)
  path: PathSegment[]
  value: unknown
export type TokenHandler = (token: Token, path: readonly PathSegment[]) => void (line 31)
export function detectFormat(relativePath: string): DataFormat (line 33)
export async function scanTokens(file: DataFile, handler: TokenHandler): Promise<void> (line 42)
export function matchesPath(path: readonly PathSegment[], steps: readonly PathStep[]): boolean (line 174)
export class ValueBuilder (line 189)
  value: unknown
  done = false
  constructor(private readonly file: string) {}
  add(token: Token): boolean
export async function selectItems( (line 263)
## src/agent/openai-session/tools/json/output.ts
export interface Truncation (line 9)
  reason: " " | " "
  rows_omitted: number
export function byteLength(value: unknown): number (line 14)
export function clipStrings(value: unknown, maxString: number): unknown (line 22)
export function fitRows<T>(rows: readonly T[], budgetBytes: number): { kept: T[]; omitted: number } (line 50)
export function describeTruncation( (line 65)
## src/agent/openai-session/tools/json/scanner.ts
export type JsonPrimitive = string | number | boolean | null (line 10)
export const MAX_SCANNED_STRING = 64 * 1024 (line 13)
export const MAX_SCAN_DEPTH = 200 (line 16)
export class LongString (line 19)
  constructor(
  toString(): string
export type ScannedValue = JsonPrimitive | LongString (line 30)
export type Token = (line 32)
export type PathSegment = string | number (line 40)
export class JsonSyntaxError extends Error (line 42)
  readonly offset: number
  readonly jsonPath: string
  constructor(message: string, offset: number, jsonPath: string)
export function formatPath(segments: readonly PathSegment[]): string (line 55)
export interface TokenizerOptions (line 86)
  onToken: (token: Token) => void
export class JsonTokenizer (line 91)
  readonly path: PathSegment[] = []
  constructor(options: TokenizerOptions)
  write(text: string): void
  end(): void
## src/agent/openai-session/tools/json/shape.ts
export const SAMPLE_ITEMS = 20 (line 12)
export const SAMPLE_STRING_LENGTH = 60 (line 15)
export class ShapeBuilder (line 56)
  constructor(private readonly depthLimit: number) {}
  handle(token: Token): void
  render(maxDepth: number, withSamples: boolean): unknown
## src/agent/openai-session/tools/markdown-search.ts
export const MARKDOWN_SEARCH_TOOL = " " (line 9)
export function markdownSearchTool(canRead: (relPath: string) => boolean = () => true): Tool<typeof schema> (line 31)
## src/agent/openai-session/tools/markdown/outline-gate.ts
export const OUTLINE_THRESHOLD_LINES = 200 (line 7)
export const DOC_READING = (line 10)
export class OutlineGate implements SessionHooks (line 24)
  constructor(
  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome>
## src/agent/openai-session/tools/markdown/outline.ts
export type Section = (line 7)
  level: number
  heading: string
  line: number
  endLine: number
export const MARKDOWN_EXTENSIONS = [" ", " ", " "] (line 17)
export const isMarkdown = (path: string): boolean => MARKDOWN_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext)) (line 19)
## src/agent/openai-session/tools/move-copy.ts
export const moveTool: Tool<typeof schema> = (line 12)
  name: " "
export const copyTool: Tool<typeof schema> = (line 20)
  name: " "
## src/agent/openai-session/tools/multi-edit.ts
export const multiEditTool: Tool<typeof schema> = (line 18)
  name: " "
## src/agent/openai-session/tools/read-tracker.ts
export class ReadTracker (line 8)
  async markRead(path: string): Promise<void>
  async staleness(path: string): Promise<string | undefined>
  forget(path: string): void
  forgetExcept(paths: Iterable<string>): void
## src/agent/openai-session/tools/read.ts
export const readTool: Tool<typeof schema> = (line 12)
  name: " "
## src/agent/openai-session/tools/run-script.ts
export function runScriptTool(): Tool<typeof schema> (line 59)
## src/agent/openai-session/tools/search-text.ts
export type SearchQuery = { query: string; regex?: boolean | undefined; case_sensitive?: boolean | undefined } (line 3)
export function searchPattern(input: SearchQuery): RegExp (line 6)
export function clip(line: string, at: number): string (line 15)
## src/agent/openai-session/tools/skill.ts
export function skillTool(skills: SkillEntry[]): Tool<typeof schema> (line 14)
## src/agent/openai-session/tools/task-board.ts
export const READ_TASKS_TOOL = " " (line 16)
export const UPDATE_TASK_TOOL = " " (line 17)
export function marker(task: Task): string (line 22)
export function detail(task: Task): string (line 31)
export function taskBoardTools(feature: string, hands?: FileHands): Tool[] (line 160)
export class TaskBoardGuard implements SessionHooks (line 168)
  constructor(
  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome>
## src/agent/openai-session/tools/tool.ts
export type QuestionAsker = (request: UserQuestionRequest) => Promise<QuestionOutcome> (line 14)
  cwd: string
  signal: AbortSignal
  files: ReadTracker
  ledger?: FileLedger
  ask?: QuestionAsker
  call?: (name: string, input: unknown) => Promise<ToolOutput>
export type ToolOutput = { text: string; isError: boolean; items?: unknown[] } (line 39)
export interface Tool<S extends z.ZodObject = z.ZodObject> (line 41)
  readonly name: string
  readonly description: string
  readonly schema: S
  readonly parameters?: Record<string, unknown>
  execute(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutput>
export function toDefinition(tool: Tool): ToolDefinition (line 52)
export const ok = (text: string, items?: unknown[]): ToolOutput => ({ text, isError: false, ...(items ? { items } : {}) }) (line 58)
export const fail = (text: string): ToolOutput => ({ text, isError: true }) (line 59)
export const MAX_OUTPUT_CHARS = 30_000 (line 62)
export type Detail = { body: () => string; note: string } (line 65)
export function mostDetailFitting(levels: Detail[], budget: number): { body: string; note: string } (line 68)
export function truncate(text: string): string (line 77)
## src/agent/openai-session/tools/write.ts
export const writeTool: Tool<typeof schema> = (line 12)
  name: " "
## src/agent/permissions/command-wrappers.ts
export const commandName = (command: string): string => command.replace(/\\/g, " ").split(" ").pop()!.replace(/\.exe$/i, "") (line 18)
export type RunCommand = (line 87)
  tokens: string[]
  argumentsFromInput: boolean
export function runCommand(tokens: string[]): RunCommand (line 101)
export const unwrapCommand = (tokens: string[]): string[] => runCommand(tokens).tokens (line 118)
## src/agent/permissions/gate.ts
export type PermissionShown = { title?: string; edits?: FileEditChange[] } (line 6)
export type AskPermission = (toolUseId: string, toolName: string, input: unknown, shown?: PermissionShown) => Promise<PermissionDecision> (line 9)
export async function denyReason(hooks: SessionHooks | undefined, use: ToolUse): Promise<string | undefined> (line 33)
export async function confirmReason(hooks: SessionHooks | undefined, ask: AskPermission, use: ToolUse): Promise<string | undefined> (line 39)
export async function reviewEdits(hooks: SessionHooks | undefined, ask: AskPermission, use: ToolUse, shown: PermissionShown): Promise<PermissionDecision> (line 50)
## src/agent/permissions/package-scripts.ts
export function projectScriptsInstruction(cwd: string): string (line 10)
export function packageScripts(cwd: string): ReadonlySet<string> (line 22)
## src/agent/permissions/permission-policy.ts
export type PermissionRules = (line 12)
  allow: string[]
  deny: string[]
  denyGitWrites?: boolean
export type PolicyContext = (line 20)
  readOnly?: ReadOnlyTools
  project?: () => ProjectCommands
  writesAllowed?: () => boolean
  scratch?: string
export class PermissionPolicy implements SessionHooks (line 39)
  constructor(
  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome>
  decorate(event: SessionEvent): SessionEvent
## src/agent/permissions/project-commands.ts
export type ProjectCommands = (line 12)
  scripts: ReadonlySet<string>
export const NO_PROJECT_COMMANDS: ProjectCommands = { scripts: new Set(), verify: [] } (line 19)
export function scriptOf(tokens: string[], scripts: ReadonlySet<string>): string | undefined (line 46)
export function templatePrefix(template: string): string[] (line 72)
## src/agent/permissions/project-paths.ts
export type ProjectPaths = (line 8)
  relative(path: string): string
  inside(path: string): boolean
  below(path: string): boolean
  under(directory: string, path: string): boolean
export function projectPaths(root: string): ProjectPaths (line 19)
## src/agent/permissions/read-only-commands.ts
export type ReadOnlyContext = (line 124)
  canEnter?: (path: string) => boolean
export function isCdCommand(tokens: string[]): boolean (line 134)
export function cdTarget(tokens: string[]): string | undefined (line 144)
export function isReadOnlySegment(segment: ShellSegment, context: ReadOnlyContext = {}): boolean (line 169)
export function isGitWrite(segment: ShellSegment): boolean (line 203)
export function isReadOnlyCommand(command: string, context: ReadOnlyContext = {}): boolean (line 209)
## src/agent/permissions/tool-classes.ts
export const TRANSFER_TOOLS: ReadonlySet<string> = new Set([" ", " "]) (line 9)
export const WRITE_TOOLS: ReadonlySet<string> = new Set([" ", " ", " ", " ", " ", ...TRANSFER_TOOLS]) (line 12)
export const WRITES_NAMED_FILE: ReadonlySet<string> = new Set([" ", " ", " "]) (line 15)
export const isShellTool = (toolName: string): boolean => SHELL_TOOLS.has(toolName) (line 24)
export const FILE_TOOLS: ReadonlySet<string> = new Set([ (line 27)
export const WITHIN_PROJECT_TOOLS: ReadonlySet<string> = new Set([" ", " "]) (line 40)
export type ReadOnlyTools = (toolName: string) => boolean (line 50)
export function readOnlyTools(own: () => readonly { name: string; readOnly: boolean }[]): ReadOnlyTools (line 59)
## src/agent/phases/blind-plan.ts
export const DOCS_DIR = " " (line 12)
export const SPECS_DIR = " " (line 13)
export const WORK_DIR = " " (line 16)
export function featureSlug(feature: string): string (line 18)
export function specPath(cwd: string, feature: string): string (line 30)
export const README_GLOB = " " (line 35)
export const SPECS_GLOB = " " (line 38)
export const SPEC_READING = " " (line 41)
export function blindPlanScope(feature: string, ignored: string[] = []): Scope (line 44)
export const BLIND_PLAN_TOOLS = [" ", " ", MARKDOWN_SEARCH_TOOL, " ", " ", " ", " ", " ", ASK_USER_TOOL] (line 64)
export function blindPlanPrompt(feature: string, cwd: string): string (line 71)
export function resumePlanPrompt(feature: string): string (line 109)
export function migrateSpecPrompt(feature: string, problems: string[]): string (line 125)
export function decisionsHandoffPrompt(feature: string, titles: string[]): string (line 144)
export function rulingsHandoffPrompt(feature: string, rulings: { title: string; ruling: string }[]): string (line 161)
export function docsReviewPrompt(feature: string): string (line 185)
export function docsCutPrompt(feature: string): string (line 204)
export function docsAfterApprovalPrompt(feature: string, cutCoveredDocs: boolean): string (line 218)
## src/agent/phases/cleanup.ts
export const CLEANUP_TOOLS = [" ", " ", " ", " ", " ", " ", " ", " ", " ", ASK_USER_TOOL] (line 17)
export const MOVES_FILE = " " (line 24)
export function cleanupScope(files: string[]): Scope (line 26)
export function cleanupKickoff(report: string, continued: boolean): string (line 41)
export function cleanupPrompt(feature: string, cwd: string, limits: Limits): string (line 56)
## src/agent/phases/code-plan.ts
export const CODE_PLAN_TOOLS = [" ", " ", " ", " ", " ", MARKDOWN_SEARCH_TOOL, CODE_OUTLINE_TOOL, CODE_SEARCH_TOOL, " ", ASK_USER_TOOL] (line 10)
export function codePlanPrompt(cwd: string): string (line 19)
export function codePlanBuildKickoff(): string (line 34)
## src/agent/phases/decisions.ts
export type DecisionState = " " | " " | " " | " " (line 18)
export type Recommendation = (line 21)
  choice: number | " "
  because: string
export type Decision = (line 27)
  title: string
  on: string[]
  finding: string
  proposals: string[]
  recommendation?: Recommendation
  ruling?: string
  state: DecisionState
  line: number
  end: number
export type DecisionProblem = { line: number; text: string } (line 47)
export function decisionsFile(feature: string): string (line 49)
export function decisionsPath(cwd: string, feature: string): string (line 53)
export function parseDecisions(text: string): { decisions: Decision[]; problems: DecisionProblem[] } (line 70)
export const decisions = (text: string): Decision[] => parseDecisions(text).decisions (line 160)
export async function readDecisions(path: string): Promise<Decision[]> (line 163)
export const openDecisions = (all: Decision[]): Decision[] => all.filter((d) => d.state === " ") (line 173)
export const pendingDecisions = (all: Decision[]): Decision[] => all.filter((d) => d.state === " " || d.state === " ") (line 176)
export function assertRulingsSent(all: Decision[]): void (line 179)
export function assertAllRuled(all: Decision[]): void (line 185)
export function withRuling(text: string, title: string, ruling: string): string (line 194)
export function compactApplied(text: string): string (line 214)
export async function compactAppliedDecisions(path: string): Promise<void> (line 225)
export function rulingKind(decision: Decision): " " | " " | " " | undefined (line 238)
## src/agent/phases/doc-migration.ts
export function docMigrationScope(ignored: string[] = []): Scope (line 20)
export const DOC_MIGRATION_TOOLS = [" ", " ", MARKDOWN_SEARCH_TOOL, " ", " ", " ", ASK_USER_TOOL] (line 38)
export function docMigrationKickoff(): string (line 41)
export function docMigrationPrompt(cwd: string): string (line 50)
## src/agent/phases/docs-evaluation.ts
export function docsEvaluationScope(ignored: string[] = []): Scope (line 20)
export const DOCS_EVALUATION_TOOLS = [" ", " ", MARKDOWN_SEARCH_TOOL, " ", " ", " ", ASK_USER_TOOL] (line 35)
export const EVALUATION_DELIVERED = " " (line 43)
export const deliversEvaluation = (text: string): boolean => text.includes(EVALUATION_DELIVERED) (line 45)
export function docsEvaluationKickoff(): string (line 48)
export function docsEvaluationPrompt(cwd: string): string (line 56)
## src/agent/phases/docs-map.ts
export function docsMapScope(docs: string[]): Scope (line 12)
export const DOCS_MAP_TOOLS = [" ", " "] (line 20)
export function docsMapKickoff(docs: string[]): string (line 23)
export function docsMapPrompt(cwd: string): string (line 36)
## src/agent/phases/file-decisions.ts
export function fileDecisionsScope(ignored: string[] = []): Scope (line 16)
export const FILE_DECISIONS_TOOLS = [" ", " ", MARKDOWN_SEARCH_TOOL, " ", " ", " ", ASK_USER_TOOL] (line 27)
export function fileDecisionsKickoff(): string (line 30)
export function fileDecisionsPrompt(cwd: string): string (line 34)
## src/agent/phases/implement.ts
export const IMPLEMENT_TOOLS = [ (line 20)
export function taskSettled(board: TaskBoard, name: string): boolean (line 35)
export function taskKickoff(board: TaskBoard, name: string, spec: Spec, decisions: Decision[] = []): string (line 45)
export const TASK_CARRY_ON = " " (line 61)
export function fixKickoff(feature: string, board: TaskBoard, failures: VerificationFailure[], cwd: string): string (line 68)
export function assertImplementable(spec: SpecState, tasks: TasksState): void (line 102)
export function implementationStarts(spec: SpecState, tasks: TasksState, live: boolean): boolean (line 117)
export function implementPrompt(feature: string, cwd: string, rules: VerifyRule[] = []): string (line 137)
## src/agent/phases/legacy-tasks.ts
export const LEGACY_TASKS_SUFFIX = " " (line 13)
export function legacyTasksPath(cwd: string, feature: string): string (line 15)
export function boardFromMarkdown(text: string): TaskBoard (line 82)
export function modernizeTasks(text: string): string (line 172)
export async function convertLegacyBoard(markdownPath: string): Promise<boolean> (line 196)
## src/agent/phases/migrate-plan.ts
export type MigrationReport = (line 23)
  feature: string
  steps: string[]
  problems: string[]
export function extractLegacyTasks(specText: string): { spec: string; tasks: string[] } (line 66)
export function extractDecisions(specText: string): { spec: string; decisions: string } (line 80)
export function modernizeSpecItems(text: string): string (line 88)
export function modernizeFindings(text: string): string (line 107)
export function modernizeReview(text: string): string (line 148)
export function collectRenames(specText: string): { spec: string; renames: Map<string, string> } (line 168)
export function applyRenames(text: string, renames: Map<string, string>): string (line 186)
export async function followRenames(cwd: string, feature: string): Promise<string[]> (line 200)
export async function migratePlan(cwd: string, feature: string): Promise<MigrationReport> (line 229)
## src/agent/phases/plan-housekeeping.ts
export const WORKING_FILES_KEPT_MS = 7 * 24 * 60 * 60 * 1000 (line 16)
export async function sweepPlans(cwd: string, now: Date): Promise<SweepReport> (line 40)
## src/agent/phases/plan-list.ts
export type PlanStatus = " " | " " | " " (line 8)
export type PlanSummary = { feature: string; path: string; status: PlanStatus } (line 10)
export async function listPlans(cwd: string): Promise<PlanSummary[]> (line 15)
export function finished(status: SpecStatus, tasks: TasksState): boolean (line 37)
export async function listDraftPlans(cwd: string): Promise<PlanSummary[]> (line 42)
## src/agent/phases/plan-review.ts
export type ResolutionKind = " " | " " (line 15)
export type Resolution = { kind: ResolutionKind; text: string } (line 17)
export const PLAN_TARGET = " " (line 20)
export type ReviewComment = (line 25)
  target: string
  text: string
  item?: string
  resolution?: Resolution
  closed?: boolean
export type ReviewRound = (line 37)
  number: number
  submittedAt?: string
  comments: ReviewComment[]
  strikes: string[]
export type Review = { rounds: ReviewRound[] } (line 46)
export type CommentRef = { round: number; index: number } (line 49)
export type PlanItem = (line 52)
  name: string
  text: string
  section: string
  removed: boolean
export const emptyReview = (): Review => ({ rounds: [] }) (line 62)
export function reviewPath(cwd: string, feature: string): string (line 64)
export function reviewFile(feature: string): string (line 69)
export function planItems(body: string): PlanItem[] (line 76)
export function findItem(body: string, name: string): PlanItem | undefined (line 80)
export function isCommentable(state: SpecState): boolean (line 85)
export function assertCommentable(state: SpecState): void (line 89)
export function parseReview(text: string): Review (line 105)
export function renderReview(review: Review, title: string): string (line 163)
export async function readReview(path: string): Promise<Review> (line 182)
export async function writeReview(path: string, review: Review, title: string): Promise<void> (line 191)
export function pendingRound(review: Review): ReviewRound | undefined (line 199)
export function commentAt(review: Review, ref: CommentRef): ReviewComment | undefined (line 216)
export const describeComment = (comment: ReviewComment): string => " " (line 221)
export function addComment(review: Review, target: string, text: string): ReviewComment (line 226)
  openRound(review).comments.push(comment)
export function editComment(review: Review, ref: CommentRef, text: string): void (line 242)
export function removeComment(review: Review, ref: CommentRef): void (line 249)
  prune(review)
export function strikeItem(review: Review, name: string): void (line 261)
  openRound(review).strikes.push(name)
export function unstrikeItem(review: Review, name: string): void (line 267)
  prune(review)
export function struckItems(review: Review): string[] (line 275)
export function submitRound(review: Review, at: string = new Date().toISOString()): ReviewRound (line 280)
export function resolveComment(review: Review, ref: CommentRef): void (line 290)
export function openComments(review: Review): ReviewComment[] (line 298)
export function assertApprovable(review: Review): void (line 303)
## src/agent/phases/plan-stage.ts
export type PlanStage = (line 14)
export function planStage(spec: SpecState, review: Review, tasks: TasksState, decisions: Decision[] = []): PlanStage (line 32)
export function tasksStale(spec: SpecState, tasks: TasksState): boolean (line 49)
export function checkDue(spec: SpecState, tasks: TasksState, decisions: Decision[]): boolean (line 59)
export const isApprovable = (stage: PlanStage, spec: SpecState): boolean => stage === " " && spec.exists && spec.status === " " (line 66)
## src/agent/phases/reconcile.ts
export function reconcileScope(feature: string): Scope (line 16)
export const RECONCILE_TOOLS = [" ", " ", " ", " ", " ", MARKDOWN_SEARCH_TOOL, CODE_OUTLINE_TOOL, CODE_SEARCH_TOOL, " ", " ", " "] (line 25)
export function reconcileKickoff(continued: boolean): string (line 33)
export function reconcilePrompt(feature: string, cwd: string): string (line 47)
export function progressLine(event: SessionEvent, label = " "): string | undefined (line 104)
## src/agent/phases/review-handoff.ts
export interface ReviewCourier (line 18)
  isLive(sessionId: string): boolean
  send(sessionId: string, text: string): Promise<void>
export type ReviewOwner = { sessionId: string } (line 25)
export function standingStrikes(body: string, struck: string[]): string[] (line 52)
export function emptied(body: string, struck: string[]): boolean (line 60)
export function reviewPrompt(options: (line 70)
export async function submitReview(options: (line 127)
## src/agent/phases/ruling.ts
export const KEEP_RULING = " " (line 6)
## src/agent/phases/scope-guard.ts
export type Scope = (line 8)
  readable: string[]
  writable: string[]
  askable?: string[]
  ignored?: string[]
export function readableIn(scope: Scope): (relPath: string) => boolean (line 24)
export class ScopeGuard implements SessionHooks (line 35)
  constructor(
  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome>
## src/agent/phases/spec-file.ts
export type SpecStatus = " " | " " | " " (line 4)
export type SpecState = { exists: false } | { exists: true; status: SpecStatus; body: string; built: boolean } (line 7)
export const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/ (line 9)
export function withFrontMatterValue(text: string, key: string, value: string): string (line 20)
export async function readSpecState(path: string): Promise<SpecState> (line 35)
export function bodyOf(text: string): string (line 46)
export function statusOf(text: string): SpecStatus (line 50)
export function builtOf(text: string): boolean (line 56)
export async function setSpecStatus(path: string, status: SpecStatus): Promise<void> (line 60)
export function withStatus(text: string, status: SpecStatus): string (line 65)
## src/agent/phases/spec-model.ts
export type Item = (line 19)
  name: string
  text: string
  citation?: string
  removed: boolean
export type Behaviour = Item & { edges: Item[] } (line 29)
export type Scenario = { title: string; intro: string; behaviours: Behaviour[] } (line 31)
export type Spec = (line 33)
  title: string
  goal: string
  scenarios: Scenario[]
  questions: Item[]
  problems: string[]
export const GOAL_SECTION = " " (line 42)
export const QUESTIONS_SECTION = " " (line 43)
export const LEGACY_DECISIONS_SECTION = " " (line 45)
export function parseSpecText(text: string): Spec (line 61)
export function parseSpec(body: string, firstLine = 1): Spec (line 67)
export function specItems(spec: Spec): PlanItem[] (line 203)
export function scenarioOf(spec: Spec, name: string): Scenario | undefined (line 219)
export function specFingerprint(spec: Spec): string (line 224)
export class SpecContract implements SessionHooks (line 235)
  constructor(private readonly cwd: string) {}
  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome>
export function contractProblems(file: string, problems: string[]): string (line 252)
## src/agent/phases/tasks-file.ts
export type TaskState = " " | " " | " " | " " | " " (line 18)
export type Proof = { item: string; file: string; test: string } (line 21)
export type Task = (line 23)
  name: string
  text: string
  delivers: string[]
  group?: string
  files: string[]
  newFiles: string[]
  foreignFiles: string[]
  context: string[]
  how: string
  proves: Proof[]
  note: string
  built: string
  state: TaskState
  blockedReason?: string
  removed: boolean
export type VerificationRecord = { at: string; ok: boolean; text: string; foreign?: { command: string; files: string[]; hand: string }[] } (line 56)
export type CleanupDecision = " " | " " | " " (line 63)
export type TaskBoard = (line 65)
  spec?: string
  cleanup?: CleanupDecision
  tasks: Task[]
  verification: VerificationRecord[]
export type TasksState = (line 74)
export const TASKS_SUFFIX = " " (line 86)
export function tasksPath(cwd: string, feature: string): string (line 88)
export function tasksFile(feature: string): string (line 93)
export function parseBoard(text: string, path = " "): TaskBoard (line 132)
export const renderBoard = (board: TaskBoard): string => " " (line 151)
export const emptyBoard = (): TaskBoard => ({ tasks: [], verification: [] }) (line 153)
export async function readBoard(path: string): Promise<TaskBoard | undefined> (line 155)
export function writeBoard(path: string, board: TaskBoard): Promise<void> (line 160)
export function stateOfBoard(board: TaskBoard | undefined): TasksState (line 184)
export async function readTasks(path: string): Promise<TasksState> (line 189)
export const liveTasks = (tasks: Task[]): Task[] => tasks.filter((t) => !t.removed) (line 193)
export const nextTask = (board: TaskBoard): Task | undefined => (line 196)
export const started = (tasks: Task[]): boolean => liveTasks(tasks).some((t) => t.state !== " ") (line 200)
export function tasksDone(tasks: Task[]): boolean (line 207)
export function taskFiles(tasks: Task[]): string[] (line 213)
export const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase() (line 218)
export function deliveredBy(tasks: Task[], item: string): Task | undefined (line 221)
export function provenBy(tasks: Task[], item: string): Proof | undefined (line 226)
export function unprovenItems(tasks: Task[]): string[] (line 231)
export function tasksFresh(tasks: Extract<TasksState, { exists: true }>, fingerprint: string): boolean (line 238)
export type TaskProgress = (line 243)
  state?: TaskState
  blockedReason?: string
  files?: string[]
  foreignFiles?: string[]
  proves?: Proof[]
  note?: string
  built?: string
export function updateTask(board: TaskBoard, name: string, change: TaskProgress): TaskBoard (line 259)
export const TESTS_ONLY_HOW = (line 292)
export function deriveBoard(spec: Spec, board: TaskBoard = emptyBoard(), context: Map<string, string[]> = new Map(), built = false, decisions: Decision[] = []): TaskBoard (line 311)
export const withSpecFingerprint = (board: TaskBoard, fingerprint: string): TaskBoard => ({ ...board, spec: fingerprint }) (line 360)
export const withCleanupDecision = (board: TaskBoard, decision: CleanupDecision): TaskBoard => ({ ...board, cleanup: decision }) (line 362)
export const withRecord = (board: TaskBoard, record: VerificationRecord): TaskBoard => ({ ...board, verification: [record, ...board.verification] }) (line 365)
export function changeBoard(path: string, change: (board: TaskBoard) => TaskBoard): Promise<TaskBoard> (line 368)
export async function stampSpecFingerprint(path: string, fingerprint: string): Promise<void> (line 378)
export async function recordCleanupDecision(path: string, decision: CleanupDecision): Promise<void> (line 382)
export async function recordVerification(path: string, record: VerificationRecord): Promise<void> (line 386)
## src/agent/phases/unfiled-decisions.ts
export const UNFILED_FILE = " " (line 14)
export const UNFILED_DECISIONS = " " (line 17)
export const CHAT_DECISIONS = " " (line 20)
export type UnfiledDecision = (line 22)
  title: string
  decided: string
  affects: string[]
export function parseUnfiled(text: string): { entries: UnfiledDecision[]; problems: string[] } (line 35)
export async function readUnfiled(cwd: string): Promise<UnfiledDecision[]> (line 75)
export class UnfiledContract implements SessionHooks (line 81)
  constructor(private readonly cwd: string) {}
  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome>
## src/agent/phases/verification-attribution.ts
export type Classification = { foreign: boolean; files: string[]; hand?: string } (line 13)
export function failureFiles(output: string, baseDir: string): { path: string; line?: number }[] (line 23)
export async function classifyFailure(failure: VerificationFailure, hands: FileHands, feature: string, cwd: string): Promise<Classification> (line 46)
export function narrowToFunction(path: string, currentText: string, ownText: string, line: number): boolean | undefined (line 86)
## src/agent/phases/verification.ts
export type VerifyRule = (line 17)
  match: string
  command: string
  project?: string
export type CommandRunner = (command: string, cwd: string) => Promise<{ ok: boolean; output: string }> (line 23)
export type VerifyCommand = { command: string; cwd: string } (line 25)
export type VerificationFailure = VerifyCommand & { output: string } (line 27)
export type HeldFailure = VerificationFailure & { files: string[]; hand: string } (line 30)
export type VerificationOutcome = (line 32)
  record: VerificationRecord
  failures: VerificationFailure[]
  held: HeldFailure[]
export type Attribute = (failure: VerificationFailure) => Promise<Classification> (line 41)
export type RetryOptions = { seconds: number; wait: (ms: number) => Promise<void> } (line 49)
export const countsAgainstBudget = (outcome: VerificationOutcome): boolean => outcome.failures.length > 0 || outcome.held.length === 0 (line 52)
export function commandsFor(files: string[], rules: VerifyRule[], cwd: string): VerifyCommand[] (line 55)
export function findUpward(start: string, pattern: string, root: string): string | undefined (line 76)
export function verificationDue(tasks: TasksState): boolean (line 101)
export const describeCommand =(c: VerifyCommand, cwd: string): string => " " (line 105)
export async function runVerification(options: (line 113)
export function verificationHandoffPrompt(feature: string, failures: VerificationFailure[], cwd: string): string (line 176)
## src/agent/repo-map/build-map.ts
export type BuildResult = (line 17)
  summary: string
  projects: MappedProject[]
  newest: number
export function buildRepoMap(cwd: string, onProgress: (line: string) => void = () => {}): Promise<BuildResult> (line 31)
export async function mapIsStale(cwd: string): Promise<boolean> (line 55)
export async function readSummary(cwd: string): Promise<string | undefined> (line 64)
## src/agent/repo-map/conventions.ts
export type Convention = (line 10)
  subject: string
  place: string
  matches: number
  total: number
export const MIN_MATCHES = 3 (line 21)
export const MIN_RATIO = 0.8 (line 24)
export function findConventions(files: string[]): Convention[] (line 44)
export const renderConvention = (c: Convention): string => " " (line 59)
## src/agent/repo-map/map-files.ts
export const MAP_ROOT = " " (line 17)
export const SUMMARY_FILE = " " (line 20)
export const INDEX_DIR = " " (line 23)
export type MapFile = { path: string; text: string } (line 26)
export const mapRoot = (cwd: string): string => join(cwd, ...MAP_ROOT.split(" ")) (line 28)
export const mapPath = (path: string): string => " " (line 31)
export const summaryPath = (cwd: string): string => join(mapRoot(cwd), SUMMARY_FILE) (line 33)
export const mapText = (text: string): string => " " (line 39)
export const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0) (line 42)
export const sortFiles = (files: MapFile[]): MapFile[] => [...files].sort((a, b) => byPath(a.path, b.path)) (line 45)
export async function writeMap(cwd: string, files: MapFile[]): Promise<void> (line 52)
export const readMapFile = (cwd: string, path: string): Promise<string | undefined> => (line 75)
export async function listMap(root: string, prefix = ""): Promise<string[]> (line 79)
## src/agent/repo-map/session-context.ts
export const wantsRepoMap = (mode: string): boolean => mode === " " || mode === " " || mode === " " (line 27)
export type RepoMapSource = GeneratedSource (line 29)
export type RepoMapContext = GeneratedContext (line 30)
export type RepoMapOptions = ContextOptions (line 31)
export const workspaceRepoMap = (cwd: string): RepoMapSource => ( (line 33)
export const repoMapContext = (source: RepoMapSource, options: RepoMapOptions = {}): Promise<RepoMapContext> => (line 39)
export function repoMapSection(context: RepoMapContext): string (line 43)
export async function withRepoMap( (line 61)
## src/agent/repo-map/summary.ts
export type ProjectKind = " " | " " | " " (line 15)
export type MappedProject = (line 17)
  name: string
  path: string
  kind: ProjectKind
  index: string
  publicTypes: number
export type MapSummary = { projects: MappedProject[]; conventions: Convention[] } (line 28)
export const SUMMARY_BUDGET = 4000 (line 31)
export const indexPathFor = (name: string): string => mapPath(" ") (line 34)
export function renderSummary(map: MapSummary, budget = SUMMARY_BUDGET): string (line 40)
## src/agent/repo-map/workspace-scan.ts
export const SOURCE_EXTENSIONS = [" ", " ", " ", " ", " ", " ", " "] (line 18)
export const PROJECT_EXTENSIONS = [" ", " ", " ", " ", " "] (line 21)
export const PROJECT_FILENAMES = [" "] (line 22)
export type ScannedFile = (line 24)
  path: string
  mtimeMs: number
export type WorkspaceScan = (line 30)
  files: ScannedFile[]
  newest: number
export const isSourceFile = (path: string): boolean => SOURCE_EXTENSIONS.some((ext) => lower(path).endsWith(ext)) (line 39)
export const isProjectFile = (path: string): boolean => (line 41)
export async function scanWorkspace(cwd: string): Promise<WorkspaceScan> (line 46)
export type IgnorePredicate = (path: string, isDir: boolean) => boolean (line 72)
export const ignoreNothing: IgnorePredicate = () => false (line 75)
export async function loadGitignore(cwd: string): Promise<IgnorePredicate> (line 82)
export function parseGitignore(text: string): IgnorePredicate (line 98)
## src/agent/runs/run-log.ts
export type RunLogEntry = { at: string; event: SessionEvent } (line 6)
export class RunLog (line 16)
  constructor(readonly dir: string) {}
  static forSession(workspaceRoot: string, sessionId: string): RunLog
  get path(): string
  settled(): Promise<void>
  append(event: SessionEvent): Promise<void>
  async read(): Promise<RunLogEntry[]>
## src/agent/scratch/scratch-folder.ts
export const scratchDir = (sessionId: string): string => " " (line 8)
export const scratchInstruction = (dir: string): string => (line 10)
## src/agent/script/repeated-edit.ts
export class RepeatedEdit implements SessionHooks (line 15)
  async postToolUse(tool: ToolUse & { isError: boolean }): Promise<PostToolUseOutcome>
## src/agent/script/sandbox.ts
export type HostCall = (name: string, args: unknown) => Promise<unknown> (line 9)
  signal: AbortSignal
  cpuBudgetMs: number
  memoryLimitBytes: number
  prelude?: string
export type SandboxResult = { ok: true; value: unknown } | { ok: false; error: string } (line 20)
export const DEFAULT_SANDBOX_OPTIONS = { cpuBudgetMs: 10_000, memoryLimitBytes: 64 * 1024 * 1024 } as const (line 22)
export async function runSandboxed( (line 40)
## src/agent/script/script-gate.ts
export const SCRIPT_WRITING = (line 5)
export class ScriptGate implements SessionHooks (line 25)
  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome>
## src/agent/sdk-session/compaction.ts
export const COMPACT_AT = 0.75 (line 10)
export const COMPACT_COMMAND = (line 13)
export const CARRY_ON = (line 16)
export class SdkCompaction (line 31)
  constructor(
  sent(text: string): void
  request(): void
  cancel(): void
  filter(message: SDKMessage, events: SessionEvent[]): SessionEvent[]
## src/agent/sdk-session/node-runtime.ts
export type NodeRuntime = (line 10)
  command: string
  args: string[]
  env: Record<string, string>
export function hostExecutableAsNode(execPath: string): NodeRuntime (line 16)
export function spawnWithRuntime(runtime: NodeRuntime, onStderr: (line: string) => void) (line 27)
## src/agent/sdk-session/sdk-event-mapper.ts
export class SdkEventMapper (line 14)
  map(msg: SDKMessage): SessionEvent[]
export function toolResultText(content: unknown): string (line 152)
## src/agent/sdk-session/sdk-session.ts
export type SdkSessionOptions = (line 28)
  id: string
  profile: ModelProfile
  cwd: string
  cliPath: string
  pluginPath?: string
  runtime: NodeRuntime
  resumeEngineSessionId?: string
  env?: Record<string, string>
  systemPrompt?: string
  appendSystemPrompt?: string
  tools?: string[]
  compactAtTokens?: number
  ownTools?: Tool[]
  scriptTools?: Tool[]
  mcpServers?: McpServers
  query: QueryFn
  onStderr?: (chunk: string) => void
  trace?: (line: string) => void
export class SdkSession implements CodeSession (line 77)
  readonly id: string
  readonly profile: ModelProfile
  readonly toolContext: ToolContext
  readonly mcp: McpControl | undefined
  constructor(private readonly options: SdkSessionOptions)
  get engineSession(): string | undefined
  send(text: string): void
  compact(): void
  events(): AsyncIterable<SessionEvent>
  respondToPermission(requestId: string, decision: PermissionDecision): void
  respondToQuestion(requestId: string, outcome: QuestionOutcome): boolean
  async interrupt(): Promise<void>
  async dispose(): Promise<void>
export function describeMessage(msg: SDKMessage): string (line 463)
## src/agent/sdk-session/tool-server.ts
export const TOOL_SERVER_NAME = " " (line 12)
export function bareToolName(engineName: string): string (line 16)
export function toolNamingLine(tools: readonly Tool[]): string (line 21)
export function toolServer(tools: Tool[], ctx: ToolContext): McpSdkServerConfigWithInstance (line 26)
export function toMcpTool<S extends z.ZodObject>(t: Tool<S>, ctx: ToolContext): SdkMcpToolDefinition<S[" "]> (line 30)
## src/agent/session/async-queue.ts
export class AsyncQueue<T> implements AsyncIterable<T> (line 6)
  push(item: T): void
  end(): void
  fail(error: unknown): void
  get isEnded(): boolean
## src/agent/session/code-session.ts
export type McpServerState = (line 10)
  name: string
  status: " " | " " | " " | " " | " "
  error?: string
export interface McpControl (line 17)
  reload(servers: McpServers): Promise<void>
export type TurnUsage = (line 25)
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd?: number
export type PermissionDecision = { kind: " " } | { kind: " "; message?: string } (line 34)
export function permissionResolved(requestId: string, decision: PermissionDecision): Extract<SessionEvent, { type: " " }> (line 37)
export type SessionEvent = (line 49)
export interface CodeSession (line 113)
  readonly id: string
  readonly profile: ModelProfile
  readonly mcp?: McpControl | undefined
  send(text: string): void
  events(): AsyncIterable<SessionEvent>
  respondToQuestion(requestId: string, outcome: QuestionOutcome): boolean
  interrupt(): Promise<void>
  dispose(): Promise<void>
## src/agent/session/compaction-point.ts
export const DEFAULT_COMPACT_AT_TOKENS = 700_000 (line 8)
export function compactAtFor(profile: Pick<ModelProfile, " " | " ">, providers: Provider[], fallbackTokens: number): number (line 15)
export function compactionPoint(windowTokens: number, share: number, ceilingTokens = 0): number (line 24)
## src/agent/session/effort.ts
export const EFFORTS: readonly Effort[] = [" ", " ", " ", " ", " "] (line 4)
export const STEP_EFFORT: Partial<Record<Step, Effort>> = (line 13)
  plan: " "
export type ReasoningControl = " " | " " (line 28)
export function knownReasoningControl(model: string): ReasoningControl | undefined (line 42)
export function effortLevels(provider: Provider, model: string): readonly Effort[] (line 52)
export function reasoningEffortFor(profile: ModelProfile, providers: Provider[]): " " | " " | " " | undefined (line 63)
export function fitEffort(wanted: Effort, by: number, levels: readonly Effort[]): Effort | undefined (line 70)
## src/agent/session/file-hands.ts
export type Hand = { sessionId: string; mode: SessionMode; feature?: string } (line 6)
export type Snapshot = { mtimeMs: number; text: string } (line 9)
export class FileHands (line 24)
  constructor(
  async recordWrite(path: string, mtimeMs: number, text?: string): Promise<void>
  async whoWrote(path: string, mtimeMs: number): Promise<Hand | undefined>
  async handFor(path: string, mtimeMs: number): Promise<Hand | undefined>
  async ownSnapshot(feature: string, path: string): Promise<Snapshot | undefined>
export function describeHand(hand: Hand | undefined): string (line 123)
## src/agent/session/generated-context.ts
export const CONTEXT_TIME_BOUND_MS = 60_000 (line 14)
export type GeneratedSource = (line 17)
  isStale(): Promise<boolean>
export type GeneratedContext = (line 24)
  summary?: string
  note: string
export type ContextOptions = (line 29)
  onProgress?: (line: string) => void
  timeoutMs?: number
export async function generatedContext(name: string, source: GeneratedSource, options: ContextOptions = {}): Promise<GeneratedContext> (line 41)
  onProgress(" ")
export function sharedBuild<T>(key: string, run: () => Promise<T>): Promise<T> (line 78)
## src/agent/session/hooks.ts
export type ToolUse = { toolName: string; input: unknown; toolUseId: string } (line 7)
export type PreToolUseOutcome = (line 10)
export type PostToolUseOutcome = { additionalContext?: string } | undefined (line 15)
export interface SessionHooks (line 17)
  preToolUse?(tool: ToolUse): Promise<PreToolUseOutcome>
  postToolUse?(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome>
export function composeHooks(...hooks: SessionHooks[]): SessionHooks (line 23)
## src/agent/session/mode-setup.ts
export type ModeSetup = { hooks?: SessionHooks; systemPrompt?: string; toolNames?: string[]; readable?: (relPath: string) => boolean } (line 21)
export type ModeContext = (line 24)
  workspaceRoot: string
  verifyRules(): VerifyRule[]
  planIgnore(): string[]
  cleanupLimits(): Limits
  withMap(record: SessionRecord, systemPrompt: string): Promise<string>
export async function modeSetup(record: SessionRecord, ctx: ModeContext): Promise<ModeSetup> (line 38)
## src/agent/session/model-profile.ts
export type Engine = " " | " " (line 4)
export type Effort = " " | " " | " " | " " | " " (line 6)
export type Provider = (line 15)
  name: string
  engine: Engine
  baseUrl?: string
  models: string[]
  compactAtTokens?: Record<string, number>
export type Step = SessionMode | " " | " " (line 37)
export type ModelChoice = (line 40)
  provider: string
  model: string
  effort?: Effort
  systemPromptFile?: string
export type StepChoice = Partial<ModelChoice> (line 49)
  name: string
  steps?: Partial<Record<Step, StepChoice>>
export type ModelProfile = (line 63)
  name: string
  engine: Engine
  model: string
  baseUrl?: string
  apiKeySecret?: string
  effort?: Effort
  systemPromptFile?: string
export function choiceFor(profile: Profile, step: Step): ModelChoice (line 76)
export function resolveStep(profile: Profile, providers: Provider[], step: Step, attempt = 1): ModelProfile (line 100)
export function providerModel(provider: Provider, model: string): ModelProfile (line 118)
export function sameModelProfile(a: ModelProfile, b: ModelProfile): boolean (line 129)
## src/agent/session/notice-of-another-hand.ts
export class NoticeOfAnotherHand implements SessionHooks (line 18)
  constructor(
  async postToolUse(tool: ToolUse & { isError: boolean }): Promise<PostToolUseOutcome>
## src/agent/session/session-manager.ts
export type SessionMode = " " | " " | " " | " " | " " | " " | " " | " " | " " | " " (line 19)
export const isPlanning = (mode: Step): boolean => (line 22)
export const offersAllowWrites = (mode: SessionMode): boolean => !isPlanning(mode) || mode === " " || mode === " " (line 30)
export const STEPS: { step: Step; group: StepGroup; label: string; hint: string }[] = [ (line 37)
export type StepGroup = " " | " " | " " | " " (line 53)
export const STEP_GROUPS: StepGroup[] = [" ", " ", " ", " "] (line 55)
export function stepTitle(step: Step): string (line 58)
export const isFeatureless = (mode: Step): boolean => (line 65)
export const isBuild = (mode: SessionMode): boolean => mode === " " (line 69)
export type SessionRecord = (line 71)
  id: string
  title: string
  profile: ModelProfile
  mode: SessionMode
  feature?: string
  parentId?: string
  files?: string[]
  task?: string
  fixAttempt?: number
  settled?: true
  access?: " " | " "
  engineSessionId?: string
  cutOff?: true
  allowWrites?: true
  allowed?: string[]
  createdAt: string
export const actingMode = (record: SessionRecord): SessionMode => (record.access === " " ? " " : record.mode) (line 111)
export const stepOf = (record: SessionRecord): Step => (record.fixAttempt !== undefined ? " " : record.mode) (line 114)
export interface SessionStore (line 116)
  list(): SessionRecord[]
  save(records: SessionRecord[]): Promise<void>
export type CreateOptions = (line 143)
  parentId?: string
  files?: string[]
  task?: string
  fixAttempt?: number
  continues?: SessionRecord | undefined
export function continuationOf(previous: SessionRecord, profile: ModelProfile): string | undefined (line 157)
export type EngineFactory = (record: SessionRecord, onProgress: (line: string) => void) => Promise<CodeSession> (line 168)
export type EventDecorator = (sessionId: string, event: SessionEvent) => Promise<SessionEvent> (line 177)
export class SessionManager (line 192)
  constructor(
  list(): SessionRecord[]
  get(id: string): SessionRecord | undefined
  isLive(id: string): boolean
  liveSessions(): CodeSession[]
  async reconnectMcp(id: string, server: string): Promise<void>
  liveChildOf(parentId: string): SessionRecord | undefined
  latest(mode: SessionMode, feature: string): SessionRecord | undefined
  async create(profile: ModelProfile, mode: SessionMode = " ", feature?: string, options: CreateOptions = {}): Promise<SessionRecord>
  async grantFullAccess(id: string, continuesOn?: ModelProfile): Promise<void>
  async allowForSession(id: string, rules: string[]): Promise<void>
  async setAllowWrites(id: string, enabled: boolean): Promise<void>
  async send(id: string, text: string): Promise<void>
  async respondToPermission(id: string, requestId: string, decision: PermissionDecision): Promise<void>
  async respondToQuestion(id: string, requestId: string, outcome: QuestionOutcome): Promise<void>
  async setProfile(id: string, profile: ModelProfile): Promise<void>
  async interrupt(id: string): Promise<void>
  compact(id: string): void
  async close(id: string): Promise<void>
  async settle(id: string): Promise<void>
  async remove(id: string): Promise<void>
  async transcript(id: string): Promise<SessionEvent[]>
  async conversation(id: string): Promise<SessionEvent[]>
  async disposeAll(): Promise<void>
  async takeCutOff(): Promise<SessionRecord[]>
export function decisionPrompt(request: PermissionRequest, decision: PermissionDecision): string (line 553)
## src/agent/session/session-status.ts
export type SessionStatus = " " | " " | " " | " " | " " | " " | " " (line 11)
export const underWay = (status: SessionStatus): boolean => status === " " || status === " " (line 16)
export const takesProfile = (status: SessionStatus, current: ModelProfile, resolved: ModelProfile): boolean => !underWay(status) && !sameModelProfile(current, resolved) (line 19)
export const appliesModelSwitchNow = (status: SessionStatus): boolean => !underWay(status) (line 26)
export function mostUrgent(statuses: SessionStatus[]): SessionStatus (line 38)
export type RunBlock = { on: " " | " "; mode: SessionMode } (line 43)
export function blockOf(runs: { mode: SessionMode; status: SessionStatus }[]): RunBlock | undefined (line 46)
export function lastFailure(current: string | undefined, event: SessionEvent): string | undefined (line 61)
export function nextStatus(current: SessionStatus, mode: SessionMode, event: SessionEvent): SessionStatus (line 79)
## src/agent/session/stale-write-guard.ts
export class StaleWriteGuard implements SessionHooks (line 19)
  constructor(
  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome>
  async postToolUse(tool: ToolUse & { isError: boolean }): Promise<PostToolUseOutcome>
## src/agent/session/user-question.ts
export type QuestionOption = { label: string; explanation?: string } (line 10)
export type Question = (line 12)
  header: string
  question: string
  options?: QuestionOption[]
  multiSelect?: boolean
export type UserQuestionRequest = { questions: Question[] } (line 24)
export type QuestionAnswer = { chosen: string[]; other?: string } (line 27)
export type QuestionOutcome = { kind: " "; answers: QuestionAnswer[] } | { kind: " "; reason?: string } (line 30)
export const UNANSWERED_RESULT = (line 33)
export const OTHER_LABEL = " " (line 37)
export function requestProblem(request: UserQuestionRequest): string | undefined (line 40)
export const isAnswerable = (request: UserQuestionRequest): boolean => requestProblem(request) === undefined (line 54)
export function isAnswered(answer: QuestionAnswer | undefined): boolean (line 57)
export function normalizeAnswer(question: Question, answer: QuestionAnswer): QuestionAnswer (line 67)
export function unansweredQuestions(request: UserQuestionRequest, answers: QuestionAnswer[]): string[] (line 77)
export const canSubmit = (request: UserQuestionRequest, answers: QuestionAnswer[]): boolean => (line 82)
export function missingAnswersMessage(request: UserQuestionRequest, answers: QuestionAnswer[]): string (line 86)
export function answerText(request: UserQuestionRequest, answers: QuestionAnswer[]): string (line 97)
export const outcomeText = (request: UserQuestionRequest, outcome: QuestionOutcome): string => (line 112)
## src/agent/shell/run-shell.ts
export function findBash(): string (line 5)
export type ShellResult = (line 16)
  output: string
  exitCode: number | null
  ended: " " | " " | " " | " "
export type ShellOptions = (line 22)
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
  bashPath?: string
export function runShell(command: string, options: ShellOptions): Promise<ShellResult> (line 30)
## src/agent/skills/skill-index.ts
export type SkillEntry = (line 7)
  name: string
  description: string
  dir: string
export function skillRoots(cwd: string, home = homedir()): string[] (line 21)
export async function indexSkills(cwd: string, home = homedir(), builtinRoot?: string): Promise<SkillEntry[]> (line 26)
export async function readSkillBody(skill: SkillEntry): Promise<string> (line 56)
export function splitFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } (line 64)
## src/agent/test-outline/render.ts
export function renderNodes(nodes: TestNode[], maxDepth = Infinity, depth = 0): string[] (line 4)
## src/agent/test-outline/scan.ts
export type TestNode = { kind: " " | " " | " "; name: string; line: number; tags: TestTag[]; children: TestNode[] } (line 11)
export function outlineTests(path: string, text: string): TestNode[] (line 18)
export function countTests(nodes: TestNode[]): number (line 27)
## src/agent/workspace-files.ts
export async function namesIn(dir: string): Promise<string[]> (line 4)
export async function exists(path: string): Promise<boolean> (line 13)
export async function readOptional(path: string): Promise<string | undefined> (line 24)
export async function replaceFile(from: string, to: string, attempts = 150): Promise<void> (line 42)
## src/chat/agents-md-offers.ts
export type OfferKind = " " | " " (line 7)
export type AgentsMdOfferPorts = (line 10)
  pendingMove: (scope: BundleScope) => Promise<PendingMove | undefined>
  readAgentsMd: (scope: BundleScope) => Promise<{ path: string; text: string | undefined }>
  settle: (scope: BundleScope, kind: OfferKind) => Promise<void>
export type TidyRequest = { scope: BundleScope; agentsPath: string } (line 19)
export class AgentsMdOffers (line 28)
  constructor(
  async load(scopes: BundleScope[]): Promise<void>
  current(): AgentsMdOffer | undefined
  async answer(scope: BundleScope, answer: AgentsMdAnswer): Promise<TidyRequest | undefined>
## src/chat/chat-view-provider.ts
export interface PermissionStore (line 78)
  allowForProject(rules: string[]): Promise<void>
export interface ProfileDefaultsStore (line 84)
  read(): ProfileDefaults
  set(name: string): Promise<void>
export const CHAT_PANEL_TYPE = " " (line 90)
export class ChatViewProvider (line 109)
  readonly onDidChange = this.changed.event
  constructor(
  isOpen(sessionId: string): boolean
  statusOf(sessionId: string): SessionStatus
  restore(panel: vscode.WebviewPanel, state: { tabId?: string } | undefined): void
  showNewSession(): void
  async newSession(mode: SessionMode, feature?: string, prompt?: string, into?: ChatPanel): Promise<SessionRecord | undefined>
  refresh(): void
  async resumePlan(feature: string, into?: ChatPanel): Promise<void>
  async open(sessionId: string, into?: ChatPanel): Promise<void>
  async close(sessionId: string): Promise<void>
  async remove(sessionId: string): Promise<void>
  onSessionEvent(sessionId: string, event: SessionEvent): void
  resumeCutOffBuilds(): Promise<void>
  async repairPlan(feature: string): Promise<MigrationReport>
  async buildRepoMap(): Promise<void>
  async buildDocsMapCommand(ignored: string[]): Promise<void>
  buildDocsMap(ignored: string[], onProgress: (line: string) => void = () => {}): Promise<DocsMapResult>
  async migratePlans(): Promise<void>
## src/chat/cleanup-progress.ts
export type UnitState = " " | " " | " " | " " (line 7)
export type UnitProgress = CleanupUnit & { state: UnitState } (line 9)
export type CleanupStage = " " | " " | " " | " " | " " (line 12)
export type CleanupProgress = (line 19)
  units: UnitProgress[]
  newFiles: string[]
  movesFile?: string
  activity?: string
  stage: CleanupStage
  outcome?: string
export function startProgress(units: CleanupUnit[]): CleanupProgress (line 33)
export function advance(progress: CleanupProgress, event: SessionEvent, relativeTo: (path: string) => string): CleanupProgress (line 42)
export function editedUnitFile(progress: CleanupProgress, event: SessionEvent, relativeTo: (path: string) => string): string | undefined (line 71)
export function measured(progress: CleanupProgress, path: string, stillOver: CleanupUnit[]): CleanupProgress (line 78)
export function finished(progress: CleanupProgress, stillOver: CleanupUnit[]): CleanupProgress (line 90)
export function settled(progress: CleanupProgress, ok: boolean, outcome: string): CleanupProgress (line 98)
export function resumed(progress: CleanupProgress): CleanupProgress (line 103)
## src/chat/feature-build.ts
export interface BuildListener (line 26)
  runStarting(feature: string): void
  passed(feature: string): Promise<void>
export type BuildDeps = (line 31)
  workspaceRoot: string
  sessions: RunSessions
  profileFor: (step: Step, attempt?: number) => ModelProfile
  verifier: Verifier
  attribute: (feature: string) => Attribute
  allowWrites: SessionSwitch
  statusOf: (sessionId: string) => SessionStatus
  isOpen: (sessionId: string) => boolean
  refresh: ChatRefresh
  notify: Notify
  listener: BuildListener
export class FeatureBuild (line 52)
  constructor(private readonly deps: BuildDeps) {}
  lineOf(feature: string): RunState | undefined
  async verify(feature: string, manual: boolean): Promise<boolean>
  async followBoard(feature: string): Promise<void>
  async followAmendment(feature: string): Promise<void>
  async implementAfterApproval(record: SessionRecord): Promise<void>
  async resumeCutOffBuilds(): Promise<void>
  async startImplementing(plan: SessionRecord): Promise<void>
  async followTask(record: SessionRecord, event: SessionEvent): Promise<void>
## src/chat/feature-cleanup.ts
export type TestRun = { passed: boolean; text: string } (line 16)
export type CleanupDeps = (line 18)
  workspaceRoot: string
  sessions: RunSessions
  profileFor: (step: Step) => ModelProfile
  sizeLimits: SizeLimits
  refresh: ChatRefresh
  notify: Notify
  verify: (feature: string) => Promise<TestRun>
export type CleanupState = { cleanup?: RunState; cleanupSweep?: CleanupSweep; cleanupProgress?: CleanupProgress } (line 30)
export class FeatureCleanup implements BuildListener (line 37)
  constructor(private readonly deps: CleanupDeps) {}
  stateOf(feature: string): CleanupState
  runStarting(feature: string): void
  passed(feature: string): Promise<void>
  async sweep(feature: string): Promise<void>
  async decide(feature: string, decision: " " | " " | " ", paths?: string[]): Promise<void>
  follow(child: SessionRecord, event: SessionEvent): void
  async reengage(run: SessionRecord): Promise<void>
  async stop(feature: string): Promise<void>
## src/chat/feature-runs.ts
export interface SessionSwitch (line 6)
  isEnabled(sessionId: string): boolean
  setEnabled(sessionId: string, enabled: boolean): void
export interface Verifier (line 12)
  rules(): VerifyRule[]
  run: CommandRunner
  failureBudget(): number
  retrySeconds(): number
export interface SizeLimits (line 22)
  limits(): Limits
  ignore(): string[]
export interface ChatRefresh (line 29)
  sendState(): Promise<void>
export interface Notify (line 35)
  warn(text: string): void
  error(text: string): void
  ask(text: string, ...choices: string[]): Promise<string | undefined>
export type RunSessions = Pick< (line 43)
## src/chat/linked-files.ts
export function linkedFilePath(workspaceRoot: string, file: string): string (line 7)
export function withLinkedFiles(text: string, files: string[]): string (line 14)
## src/chat/open-draft-plan.ts
export function openDraftPlanAction( (line 14)
## src/chat/phase-runs.ts
export type ChatPhase = " " | " " | " " | " " | " " (line 9)
export const PHASE_LABEL: Record<ChatPhase, string> = (line 11)
  plan: " "
export function phaseOfStep(step: Step): ChatPhase (line 20)
export function phaseOfRun(run: RunRef): ChatPhase (line 32)
export function refusal(run: RunControls): string | undefined (line 51)
export function recipient(run: RunControls): string (line 60)
export function defaultTarget(phase: ChatPhase, runs: RunControls[]): RunControls | undefined (line 81)
## src/chat/protocol.ts
export type SessionTab = (line 18)
  id: string
  title: string
  mode: SessionMode
  access: " " | " "
  profileName: string
  status: SessionStatus
export type PlanState = (line 28)
  specPath: string
  tasksPath: string
  decisionsPath: string
  stage: PlanStage
  status: " " | " " | " " | " "
  body?: string
  spec?: Spec
  stale: boolean
  repairable: boolean
  checkable: boolean
  check?: RunState
  implementable: boolean
  verifiable: boolean
  verification?: RunState
  cleanup?: RunState
  cleanupSweep?: CleanupSweep
  cleanupProgress?: CleanupProgress
  cleanupDecision?: CleanupDecision
  lastVerification?: VerificationRecord
  tasks: Task[]
  review: Review
  commentable: boolean
  approvable: boolean
  decisions: Decision[]
  pendingDecisions: number
  applyingRulings: boolean
  reviewingDocs: boolean
  atWork: boolean
  blocked?: RunBlock
  failure?: RunFailure
export type RunFailure = { mode: SessionMode; message: string } (line 91)
export type RunState = { live: boolean; text: string } (line 94)
export type CleanupUnit = { path: string; line: number; name: string; kind: UnitKind; breaches: Breach[] } (line 97)
export type CleanupSweep = { units: CleanupUnit[] } (line 100)
export type RunRef = (line 107)
  sessionId: string
  mode: SessionMode
  title: string
  task?: string
  fixAttempt?: number
export type RunControls = RunRef & (line 118)
  profileName: string
  live: boolean
  settled: boolean
  allowWrites?: boolean
  mcp?: McpServerState[]
export type RunSection = RunRef & { events: SessionEvent[] } (line 130)
export type ResumablePlan = { feature: string; status: " " | " " } (line 133)
export type ResumableChat = { sessionId: string; title: string; startedAt: string } (line 136)
export type AgentsMdOffer = (line 143)
  scope: BundleScope
  agentsPath: string
  text: string
  claudePath?: string
  tidyWords?: number
export type AgentsMdAnswer = " " | " " | " " | " " (line 157)
export type ToWebview = (line 159)
  tab?: SessionTab
  runs: RunControls[]
  plan?: PlanState
  plans: ResumablePlan[]
  chats: ResumableChat[]
  unfiled: number
  profiles: ProfileDefaults
  models: ModelProfile[]
  agentsMd?: AgentsMdOffer
export type UserPermissionDecision = PermissionDecision & { remember?: RememberedRules } (line 188)
export type RememberedRules = { session: string[]; project: string[] } (line 191)
export type ReviewAction = (line 194)
export type FromWebview = (line 208)
## src/chat/session-groups.ts
export type PlanEntry = { feature: string; status: Exclude<PlanStatus, " "> | undefined; record: SessionRecord | undefined } (line 7)
export type SessionGroups = { chats: SessionRecord[]; plans: PlanEntry[] } (line 10)
export function sessionGroups(records: SessionRecord[], specs: PlanSummary[]): SessionGroups (line 22)
## src/chat/sessions-tree.ts
export type SessionNode = (line 36)
export function recordOf(node: SessionNode): SessionRecord | undefined (line 42)
export class SessionsTree implements vscode.TreeDataProvider<SessionNode> (line 49)
  readonly onDidChangeTreeData = this.changed.event
  constructor(
  refresh(): void
  async getChildren(node?: SessionNode): Promise<SessionNode[]>
  getTreeItem(node: SessionNode): vscode.TreeItem
## src/chat/webview-font-size.ts
export function fontSizeStyle(configured: unknown): string (line 12)
## src/chat/webview-html.ts
export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, rootElement: string): string (line 5)
## src/chat/webview/ansi.ts
export function renderAnsi(text: string, into: HTMLElement): void (line 32)
  emit(into, text.slice(last), style)
## src/chat/webview/chat-app.ts
export class ChatApp extends HTMLElement (line 58)
  connectedCallback(): void
## src/chat/webview/chat-composer.ts
export class ChatComposer extends HTMLElement (line 44)
  connectedCallback(): void
  setSwitches(switches: Switches): void
  setContext(usage: ContextUsage | undefined): void
  setHeldByQuestion(held: boolean): void
  setTarget(recipient: string | undefined, refusal: string | undefined): void
  focusInput(): void
## src/chat/webview/chat-transcript.ts
export class ChatTranscript extends HTMLElement (line 31)
  scrollHost: HTMLElement = this
  connectedCallback(): void
  reset(events: SessionEvent[]): void
  get hasOpenQuestion(): boolean
  openCard(): HTMLElement | undefined
  apply(event: SessionEvent, live = true): void
## src/chat/webview/claude-md-overlay.ts
export class ClaudeMdOverlay extends HTMLElement (line 11)
  connectedCallback(): void
  show(offer: ClaudeMdOffer | undefined): void
## src/chat/webview/context-meter.ts
export type ContextUsage = { usedTokens: number; windowTokens: number; compactAtTokens: number } (line 6)
export class ContextMeter extends HTMLElement (line 16)
  connectedCallback(): void
  update(usage: ContextUsage | undefined, compactable: boolean): void
## src/chat/webview/dom.ts
export function el(tag: string, className: string, text?: string): HTMLElement (line 2)
## src/chat/webview/edit-diff.ts
export function editDiffView(change: FileEditChange): HTMLElement (line 12)
export function fileLink(change: FileEditChange): HTMLElement (line 27)
## src/chat/webview/events.ts
export class PromptSubmittedEvent extends Event (line 7)
  static readonly type = " "
  constructor(
export class LinkOpenFileRequestedEvent extends Event (line 19)
  static readonly type = " "
  constructor()
export class InterruptRequestedEvent extends Event (line 26)
  static readonly type = " "
  constructor()
export class CompactRequestedEvent extends Event (line 33)
  static readonly type = " "
  constructor()
export class PermissionDecidedEvent extends Event (line 40)
  static readonly type = " "
  constructor(
export class QuestionAnsweredEvent extends Event (line 51)
  static readonly type = " "
  constructor(
export class NewSessionRequestedEvent extends Event (line 61)
  static readonly type = " "
  constructor(
export class PlanResumeRequestedEvent extends Event (line 75)
  static readonly type = " "
  constructor(public readonly feature: string)
export class SpecApprovedEvent extends Event (line 82)
  static readonly type = " "
  constructor()
export class RulingsSentEvent extends Event (line 90)
  static readonly type = " "
  constructor()
export class ReviewSubmittedEvent extends Event (line 98)
  static readonly type = " "
  constructor()
export class PlanStepSelectedEvent extends Event (line 106)
  static readonly type = " "
  constructor(public readonly step: Step)
export type PlanFocus = { scroll?: boolean; item?: string } (line 114)
export class PlanFocusRequestedEvent extends Event (line 117)
  static readonly type = " "
  constructor(
export class SpecCheckRequestedEvent extends Event (line 128)
  static readonly type = " "
  constructor()
export class SpecCheckStoppedEvent extends Event (line 136)
  static readonly type = " "
  constructor()
export class CleanupStoppedEvent extends Event (line 144)
  static readonly type = " "
  constructor()
export class SpecRepairRequestedEvent extends Event (line 152)
  static readonly type = " "
  constructor()
export class VerifyRequestedEvent extends Event (line 160)
  static readonly type = " "
  constructor()
export class CleanupDecidedEvent extends Event (line 168)
  static readonly type = " "
  constructor(
export class SweepRequestedEvent extends Event (line 179)
  static readonly type = " "
  constructor()
export class ImplementRequestedEvent extends Event (line 187)
  static readonly type = " "
  constructor()
export class EditorClosedEvent extends Event (line 195)
  static readonly type = " "
  constructor(public readonly text?: string)
export class ReviewActionEvent extends Event (line 203)
  static readonly type = " "
  constructor(public readonly action: ReviewAction)
export class PlanViewSelectedEvent extends Event (line 213)
  static readonly type = " "
  constructor(public readonly view: ViewTab)
export class SessionSelectedEvent extends Event (line 221)
  static readonly type = " "
  constructor(public readonly sessionId: string)
export class AllowWritesToggledEvent extends Event (line 228)
  static readonly type = " "
  constructor(public readonly enabled: boolean)
export class SessionModelChangedEvent extends Event (line 236)
  static readonly type = " "
  constructor(public readonly name: string)
export class PlanApprovedEvent extends Event (line 244)
  static readonly type = " "
  constructor()
export class McpReconnectRequestedEvent extends Event (line 252)
  static readonly type = " "
  constructor(public readonly server: string)
export class DefaultProfileChangedEvent extends Event (line 260)
  static readonly type = " "
  constructor(public readonly name: string)
export class ChatTargetChangedEvent extends Event (line 268)
  static readonly type = " "
  constructor()
export class SessionRemovedEvent extends Event (line 275)
  static readonly type = " "
  constructor(public readonly sessionId: string)
export class ClaudeMdAnsweredEvent extends Event (line 283)
  static readonly type = " "
  constructor(
## src/chat/webview/format-usage.ts
export function formatUsage(usage: TurnUsage): string (line 4)
export function compact(n: number): string (line 11)
## src/chat/webview/highlight.ts
export type Highlighted = { html: string; highlighted: boolean } (line 35)
export function highlightCode(text: string, lang: string | undefined): Highlighted (line 38)
export function fillCode(target: HTMLElement, text: string, lang: string | undefined): void (line 45)
export function languageForPath(path: string): string | undefined (line 56)
export function escapeHtml(text: string): string (line 65)
## src/chat/webview/linked-files-row.ts
export class LinkedFilesRow extends HTMLElement (line 9)
  connectedCallback(): void
  link(path: string): void
  get paths(): string[]
  clear(): void
## src/chat/webview/markdown-text.ts
export class MarkdownText extends HTMLElement (line 10)
  static readonly observedAttributes = [" "]
  connectedCallback(): void
  attributeChangedCallback(): void
## src/chat/webview/markdown.ts
export function renderMarkdownInline(text: string, target: HTMLElement): void (line 39)
export function renderMarkdown(text: string, target: HTMLElement, final: boolean): void (line 44)
  ensureMermaid()
## src/chat/webview/new-session-view.ts
export type PickUp = { plans: ResumablePlan[]; chats: ResumableChat[]; unfiled: number } (line 12)
export class NewSessionView extends HTMLElement (line 49)
  connectedCallback(): void
  reset(): void
  update(profiles: ProfileDefaults, pickUp: PickUp): void
## src/chat/webview/permission-card.ts
export class PermissionCard extends HTMLElement (line 33)
  show(request: PermissionRequest): void
  resolve(decision: PermissionDecision[" "], message?: string): void
  get isResolved(): boolean
  get toolUseId(): string | undefined
## src/chat/webview/phase-chat.ts
export interface PhaseChat extends HTMLElement (line 13)
  readonly phase: ChatPhase
  readonly target: RunControls | undefined
  readonly targetHasOpenQuestion: boolean
  update(runs: RunControls[]): void
  reset(runs: RunSection[]): void
  apply(run: RunRef, event: SessionEvent): void
  revealOpenCard(): HTMLElement | undefined
  readonly hasOpenCard: boolean
  enter(): void
  leave(): void
export class SingleRunChat extends HTMLElement implements PhaseChat (line 42)
  constructor(
  connectedCallback(): void
  get target(): RunControls | undefined
  get targetHasOpenQuestion(): boolean
  get hasOpenCard(): boolean
  update(runs: RunControls[]): void
  reset(runs: RunSection[]): void
  apply(run: RunRef, event: SessionEvent): void
  revealOpenCard(): HTMLElement | undefined
  enter(): void
  leave(): void {}
export class TaskRunChat extends HTMLElement implements PhaseChat (line 120)
  readonly phase = " "
  connectedCallback(): void
  get target(): RunControls | undefined
  get targetHasOpenQuestion(): boolean
  get hasOpenCard(): boolean
  update(runs: RunControls[]): void
  reset(runs: RunSection[]): void
  apply(run: RunRef, event: SessionEvent): void
  revealOpenCard(): HTMLElement | undefined
  enter(): void
  leave(): void
## src/chat/webview/plan-bar.ts
export class PlanBar extends HTMLElement (line 29)
  update(plan: PlanState | undefined, marks: StepMarks = { moved: [] }): void
export type StepMarks = { selected?: Step; moved: Step[] } (line 136)
## src/chat/webview/plan-cleanup-tab.ts
export class PlanCleanupTab extends PlanTab (line 41)
## src/chat/webview/plan-comments.ts
export type CommentRow = (line 6)
  ref: CommentRef
  className: string
  editing: boolean
  shown: boolean
  editable: boolean
  linked: boolean
  target: string
  targetLabel: string
  text: string
  resolved: boolean
  resolutionKind: string
  resolutionText: string
  resolvable: boolean
  resolveTitle: string
  awaiting: boolean
  editorText: string
export const commentMarkup = (comments: string): string => " (line 31)
export function commentRows(placed: PlacedComment[], plan: PlanState, linked: boolean, editor: Editor | undefined): CommentRow[] (line 54)
## src/chat/webview/plan-decisions-tab.ts
export class PlanDecisionsTab extends PlanTab (line 78)
## src/chat/webview/plan-editor.ts
export class PlanEditor extends HTMLElement (line 11)
  connectedCallback(): void
## src/chat/webview/plan-parts.ts
export const PLAN_TARGET = " " (line 10)
export const MARKER = /\s*\[(?:in progress|done|tested|removed|applied|withdrawn|blocked[^\]]*)\]/gi (line 13)
export const TASK_STATE: Record<TaskState, string> = (line 15)
  open: " "
export const DECISION_STATE: Record<Decision[" "], string> = (line 23)
  open: " "
export type Editor = { kind: " "; target: string; comment?: CommentRef; text: string } | { kind: " "; target: string; text: string } (line 31)
export type PlacedComment = { ref: CommentRef; comment: ReviewComment; pending: boolean } (line 34)
export const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase() (line 36)
export const sameRef = (a: CommentRef, b: CommentRef): boolean => a.round === b.round && a.index === b.index (line 38)
export function pendingRound(review: Review) (line 40)
export function pendingDecisions(plan: PlanState): Decision[] (line 46)
export function itemNamed(spec: Spec, name: string): Item | undefined (line 55)
export function rewrittenRule(proposal: string, decision: Decision, plan: PlanState): { name: string; text: string } | undefined (line 67)
export function rulingText(decision: Decision): string (line 76)
export function struckItems(review: Review): string[] (line 80)
export function commentsOn(review: Review, target: string): PlacedComment[] (line 85)
export function note(text: string): HTMLElement (line 95)
export function staleNote(pending: string[]): string (line 100)
export function blockedReason(task: Task): string | undefined (line 106)
export function button(label: string, onClick: () => void, options: { title?: string } = {}): HTMLButtonElement (line 111)
## src/chat/webview/plan-review-tab.ts
export class PlanReviewTab extends PlanTab (line 12)
## src/chat/webview/plan-ruling-options.ts
export type OptionRow = (line 9)
  className: string
  title: string
  ruling: string
  own: boolean
  numbered: boolean
  index: string
  kind: string
  named: boolean
  rule: string
  text: string
export type Pick = { which: string; lead: string; because: string } (line 24)
export const OPTIONS_MARKUP = " (line 32)
export function optionRows(decision: Decision, plan: PlanState): OptionRow[] (line 50)
export function pickOf(decision: Decision): Pick | undefined (line 106)
## src/chat/webview/plan-spec-tab.ts
export class PlanSpecTab extends PlanTab (line 92)
## src/chat/webview/plan-step.ts
export type Step = " " | " " | " " | " " | " " | " " | " " (line 14)
export const STEPS: Step[] = [" ", " ", " ", " ", " ", " ", " "] (line 16)
export const STEP_LABEL: Record<Step, string> = (line 18)
  plan: " "
export type Tab = " " | " " | " " | " " | " " (line 29)
export type ViewTab = Tab | " " (line 32)
export type NextAction = " " | " " | " " | " " | " " | " " | " " (line 34)
export type NextStep = (line 36)
export type PlanStep = (line 45)
  current: Step
  reached: Step[]
  next: NextStep
  goto?: { tab: ViewTab; label: string; hint: string }
  yours: boolean
  complete: boolean
export function planStep(plan: PlanState): PlanStep (line 86)
export const failureText = (failure: RunFailure): string => " " (line 143)
export function shownSteps(plan: PlanState): Step[] (line 278)
export function presentTabs(plan: PlanState): Tab[] (line 285)
export function offeredUnits(plan: PlanState): CleanupUnit[] (line 303)
export function tabLabel(tab: Tab, plan: PlanState): string (line 309)
export function tabFor(step: Step, plan: PlanState): Tab (line 332)
## src/chat/webview/plan-tab.ts
export abstract class PlanTab extends HTMLElement (line 22)
  constructor()
  update(plan: PlanState): void
## src/chat/webview/plan-tabs.ts
export class PlanTabs extends HTMLElement (line 12)
  update(plan: PlanState | undefined, active: ViewTab, chatMoved = false, chatLabel = " "): void
## src/chat/webview/plan-tasks-tab.ts
export class PlanTasksTab extends PlanTab (line 29)
## src/chat/webview/plan-view.ts
export class PlanView extends HTMLElement (line 30)
  update(plan: PlanState | undefined, tab: Tab): void
  land(where: PlanFocus): void
## src/chat/webview/question-card.ts
export class QuestionCard extends HTMLElement (line 45)
  show(event: QuestionRequest): void
  resolve(outcome: QuestionOutcome): void
  get isResolved(): boolean
## src/chat/webview/run-sections.ts
export class RunSections extends HTMLElement (line 13)
  reset(runs: RunSection[]): void
  apply(run: RunRef, event: SessionEvent): void
  get isEmpty(): boolean
  point(target: string | undefined, only: boolean): void
  foldToTarget(): void
  openCard(): { sessionId: string; card: HTMLElement } | undefined
  hasOpenQuestion(sessionId: string): boolean
## src/chat/webview/vscode-api.ts
export function postToHost(message: unknown): void (line 8)
export function rememberTab(tabId: string | undefined): void (line 13)
export function onHostMessage<M>(handler: (message: M) => void): void (line 17)
export function post(message: FromWebview): void (line 21)
  postToHost(message)
export function onMessage(handler: (message: ToWebview) => void): void (line 25)
  onHostMessage(handler)
## src/dev-reload.ts
export function watchOwnBundle(context: vscode.ExtensionContext): vscode.Disposable (line 10)
## src/extension.ts
export function activate(context: vscode.ExtensionContext): void (line 61)
  mkdirSync(workspaceRoot, { recursive: true })
  chat = new ChatViewProvider(
  stopSessions = () => sessions.disposeAll()
export function deactivate(): Promise<void> | undefined (line 398)
## src/session-engines.ts
export type EngineDeps = (line 74)
  context: vscode.ExtensionContext
  output: vscode.OutputChannel
  config: ConfigPort
  workspaceRoot: string
  mcp: McpServerSet
  verifier: Verifier
  policyFor: (sessionId: string) => PermissionPolicy
  planIgnore: () => string[]
  buildDocsMap: (ignored: string[], onProgress: (line: string) => void) => Promise<DocsMapResult>
export class SessionEngines (line 89)
  constructor(private readonly deps: EngineDeps)
  toolsOf(sessionId: string): readonly Tool[]
  recorderOf(sessionId: string): FileEditRecorder | undefined
  async create(record: SessionRecord, onProgress: StartProgress): Promise<CodeSession>
## src/settings/model-settings.ts
export type LegacyProfile = (line 5)
  name: string
  engine: Engine
  model: string
  baseUrl?: string
  apiKeySecret?: string
  effort?: Effort
  systemPromptFile?: string
export type ModelSettings = { providers: Provider[]; profiles: Profile[]; activeProfile: string } (line 16)
export function migrateModelSettings(legacy: LegacyProfile[], activeProfile: string, planProfile: string): ModelSettings (line 25)
export const needsMigration = (providers: Provider[]): boolean => providers.length === 0 (line 84)
## src/settings/protocol.ts
export type ApiKeyState = { name: string; stored: boolean } (line 7)
export type SettingsSnapshot = (line 10)
  providers: Provider[]
  profiles: Profile[]
  activeProfile: string
  keys: ApiKeyState[]
  permissions: { allow: string[]; deny: string[]; denyGitWrites: boolean }
  verify: VerifyRule[]
  verifyFailureBudget: number
  cleanup:
  planIgnore: string[]
  cutCoveredDocs: boolean
  memories: { project: MemoryEntry[]; user: MemoryEntry[] }
  bundles:
  nodePath: string
  traceEngine: boolean
  compactAtTokens: number
  hasWorkspace: boolean
export type EditableSettings = (line 53)
  activeProfile: string
  nodePath: string
  traceEngine: boolean
  compactAtTokens: number
  verify: VerifyRule[]
  verifyFailureBudget: number
  planIgnore: string[]
  cutCoveredDocs: boolean
export type SettingKey = keyof EditableSettings (line 77)
export type SettingsTarget = " " | " " (line 79)
export type SaveSetting = { [K in SettingKey]: { type: " "; key: K; value: EditableSettings[K] } }[SettingKey] (line 81)
export type ToSettingsWebview = (line 83)
export type FromSettingsWebview = (line 92)
## src/settings/settings-panel.ts
export const SETTINGS_PANEL_TYPE = " " (line 7)
export type ModelLister = (args: { name: string; baseUrl: string; apiKeyValue: string }) => Promise<string[]> (line 14)
export class SettingsPanel (line 20)
  constructor(
  open(): void
  adopt(panel: vscode.WebviewPanel): void
## src/settings/settings-store.ts
export type ConfigPort = (line 12)
  get<T>(key: string, fallback: T): T
  update(key: string, value: unknown, target: SettingsTarget): Promise<void>
export type SecretPort = (line 19)
  has(name: string): Promise<boolean>
export function secretKey(name: string): string (line 28)
export type ProfileDefaults = { names: string[]; active: string } (line 33)
export type MemoryPort = (line 36)
  list(): Promise<{ project: MemoryEntry[]; user: MemoryEntry[] }>
export type BundlePort = (line 42)
  available(): Promise<Bundle[]>
export function readModelSettings(config: ConfigPort): ModelSettings (line 89)
export function readCleanupLimits(config: ConfigPort): Limits (line 98)
export class SettingsStore (line 116)
  constructor(
  async snapshot(): Promise<SettingsSnapshot>
  profileDefaults(): ProfileDefaults
  async save<K extends SettingKey>(key: K, value: EditableSettings[K]): Promise<void>
  async saveProvider(index: number, provider: Provider): Promise<void>
  async removeProvider(index: number): Promise<void>
  async saveProfile(index: number, profile: Profile): Promise<void>
  async removeProfile(index: number): Promise<void>
  async setApiKey(name: string, value: string): Promise<void>
  async forgetMemory(scope: MemoryScope, title: string): Promise<void>
  async applyBundle(scope: BundleScope, bundle: Bundle): Promise<void>
  async removeBundle(scope: BundleScope, source: string, name: string): Promise<void>
  async dismissBundleOffer(): Promise<void>
## src/settings/webview/advanced-tab.ts
export class AdvancedTab extends HTMLElement (line 6)
  update(snapshot: SettingsSnapshot): void
## src/settings/webview/bundles-tab.ts
export class BundlesTab extends HTMLElement (line 23)
  update(snapshot: SettingsSnapshot): void
## src/settings/webview/events.ts
export type SettingsTab = " " | " " | " " | " " | " " | " " (line 7)
export class SettingsTabSelectedEvent extends Event (line 9)
  static readonly type = " "
  constructor(public readonly tab: SettingsTab)
export type ModelsSubTab = " " | " " (line 17)
export class ModelsSubTabSelectedEvent extends Event (line 19)
  static readonly type = " "
  constructor(public readonly tab: ModelsSubTab)
export class ProfileStepGroupSelectedEvent extends Event (line 27)
  static readonly type = " "
  constructor(public readonly group: StepGroup)
export class SettingSavedEvent<K extends SettingKey = SettingKey> extends Event (line 35)
  static readonly type = " "
  constructor(
export class ProfileSavedEvent extends Event (line 46)
  static readonly type = " "
  constructor(
export class ProfileRemovedEvent extends Event (line 56)
  static readonly type = " "
  constructor(public readonly index: number)
export class ProviderSavedEvent extends Event (line 64)
  static readonly type = " "
  constructor(
export class ProviderRemovedEvent extends Event (line 74)
  static readonly type = " "
  constructor(public readonly index: number)
export class ModelsRefreshRequestedEvent extends Event (line 82)
  static readonly type = " "
  constructor(
export class ApiKeySetEvent extends Event (line 93)
  static readonly type = " "
  constructor(
export class RuleListChangedEvent extends Event (line 104)
  static readonly type = " "
  constructor(public readonly values: string[])
export class SettingsFileRequestedEvent extends Event (line 111)
  static readonly type = " "
  constructor(public readonly scope: SettingsTarget)
export class MemoryOpenedEvent extends Event (line 119)
  static readonly type = " "
  constructor(
export class MemoryForgottenEvent extends Event (line 130)
  static readonly type = " "
  constructor(
export class BundleAppliedEvent extends Event (line 141)
  static readonly type = " "
  constructor(
export class BundleRemovedEvent extends Event (line 152)
  static readonly type = " "
  constructor(
export class BundleOfferDismissedEvent extends Event (line 164)
  static readonly type = " "
  constructor()
## src/settings/webview/fields.ts
export function el(tag: string, className: string, text?: string): HTMLElement (line 4)
export function button(label: string, onClick: () => void, className = ""): HTMLButtonElement (line 11)
export function field(label: string, control: HTMLElement, options: FieldOptions = {}): HTMLLabelElement (line 23)
export function textInput(name: string, value: string, options: FieldOptions = {}): HTMLInputElement (line 31)
export function numberInput(name: string, value: number, options: FieldOptions = {}): HTMLInputElement (line 40)
export function checkbox(name: string, checked: boolean, options: FieldOptions = {}): HTMLInputElement (line 47)
export function select(name: string, options: { value: string; label: string }[], selected: string, disabled = false): HTMLSelectElement (line 56)
export function checkField(label: string, control: HTMLInputElement, hint?: string): HTMLLabelElement (line 71)
export function onChange(control: HTMLElement, save: () => void): void (line 80)
export function heading(title: string, scope: string): HTMLElement (line 84)
export function settingsFileLink(target: SettingsTarget): HTMLElement (line 91)
export function note(text: string): HTMLElement (line 101)
## src/settings/webview/memories-tab.ts
export class MemoriesTab extends HTMLElement (line 7)
  update(snapshot: SettingsSnapshot): void
## src/settings/webview/models-section.ts
export class ModelsSection extends HTMLElement (line 17)
  connectedCallback(): void
  update(snapshot: SettingsSnapshot): void
  discoveredModels(provider: string, models: string[]): void
## src/settings/webview/permissions-tab.ts
export const NO_WORKSPACE_NOTE = " " (line 6)
export class PermissionsTab extends HTMLElement (line 9)
  update(snapshot: SettingsSnapshot): void
## src/settings/webview/profiles-tab.ts
export class ProfilesTab extends HTMLElement (line 22)
  update(snapshot: SettingsSnapshot): void
## src/settings/webview/project-tab.ts
export class ProjectTab extends HTMLElement (line 20)
  update(snapshot: SettingsSnapshot): void
## src/settings/webview/providers-tab.ts
export class ProvidersTab extends HTMLElement (line 34)
  update(snapshot: SettingsSnapshot): void
  discoveredModels(provider: string, models: string[]): void
## src/settings/webview/rule-list.ts
export class RuleList extends HTMLElement (line 8)
  update(values: string[], options: { placeholder?: string; disabled?: boolean } = {}): void
  values(): string[]
## src/settings/webview/settings-app.ts
export class SettingsApp extends HTMLElement (line 44)
  connectedCallback(): void
## test/fake-query.ts
export function fakeQuery() (line 8)
export const initMessage = (sessionId = " "): SDKMessage => (line 79)
export const assistantMessage = (contextTokens: number): SDKMessage => (line 99)
export const compactionMessages = (error?: string): SDKMessage[] => (line 116)
export const compactionRefusedMessages = (reason: string): SDKMessage[] => (line 131)
export const promptTooLongMessages = (): SDKMessage[] => (line 148)
export const interruptedResult = (): SDKMessage => (line 167)
export const resultMessage = (): SDKMessage => (line 170)
## test/feature-runs-fixture.ts
export const profile: ModelProfile = { name: " ", engine: " ", model: " " } (line 6)
export class FakeSessions implements RunSessions (line 9)
  readonly records: SessionRecord[] = []
  readonly sent: { id: string; text: string }[] = []
  readonly closed: string[] = []
  async create(profile: ModelProfile, mode: SessionMode = " ", feature?: string, options: Parameters<RunSessions[" "]>[3] = {}): Promise<SessionRecord>
  async send(id: string, text: string): Promise<void>
  async close(id: string): Promise<void>
  async settle(): Promise<void> {}
  get(id: string): SessionRecord | undefined
  list(): SessionRecord[]
  latest(mode: SessionMode, feature: string): SessionRecord | undefined
  isLive(): boolean
  liveChildOf(): SessionRecord | undefined
  async transcript(): Promise<SessionEvent[]>
  async takeCutOff(): Promise<SessionRecord[]>
export class FakeRefresh implements ChatRefresh (line 61)
  changes = 0
  async sendState(): Promise<void> {}
  changed(): void
  nextChange(): Promise<void>
export class FakeNotify implements Notify (line 75)
  readonly warnings: string[] = []
  readonly errors: string[] = []
  readonly asked: string[] = []
  answer: string | undefined
  warn(text: string): void
  error(text: string): void
  async ask(text: string): Promise<string | undefined>
## test/fixtures-units/sample.cs
public class Widget : Base, IThing (line 6)
  public int Count
  public Widget(int a) : base(a)
  public async Task<Result> RunAsync<T>(T input) where T : class
public record Point(int X, int Y) (line 40)
  public int Sum() => X + Y
public enum Kind { A, B } (line 45)
public struct Pair (line 47)
  public int A
## test/fixtures-units/sample.ts
export type Options = (line 7)
  a: string
export interface Shape (line 11)
  kind: string
export class Box<T> extends Base implements Shape (line 15)
  kind = " "
  handle = (e: Event) =>
  get size(): number
  method(a: { b: string }): void
export function plain(a: number): number (line 35)
export const arrow = async ({ a }: Options): Promise<void> => (line 42)
## test/plan-state-fixture.ts
export function planState(over: Partial<PlanState> = {}): PlanState (line 4)
## test/settings-app.test.ts
export function snapshot(over: Partial<SettingsSnapshot> = {}): SettingsSnapshot (line 18)
## test/task-board-fixture.ts
export const task = (name: string, over: Partial<Task> = {}): Task => ( (line 4)
export const board = (...tasks: Task[]): TaskBoard => ({ tasks, verification: [] }) (line 21)
export const tasksState = (...tasks: Task[]): TasksState => stateOfBoard(board(...tasks)) (line 23)
## test/workspace-fixture.ts
export async function writeFiles(dir: string, files: Record<string, string>): Promise<void> (line 6)
export async function withWorkspace<T>( (line 15)

## Skipped: the scan could not read these files
src/agent/code-structure/source-files.ts
src/agent/code-structure/structure.ts
src/agent/mcp/mcp-config.ts
src/agent/openai-session/tools/grep.ts
src/agent/permissions/permission-rules.ts
src/agent/permissions/shell-split.ts
src/agent/phases/scenario-context.ts
src/agent/repo-map/type-index.ts
src/agent/test-outline/markers.ts
