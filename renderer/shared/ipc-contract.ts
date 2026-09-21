/**
 * Nexus IPC contract — shared type definitions for the frontend/backend boundary.
 *
 * These are TYPE-ONLY declarations imported via `import type { ... } from "@shared/ipc-contract"`
 * from both `renderer/` and `main/`. They document every channel's request/response shape.
 *
 * Channels are grouped below. invoke = ipcMain.handle (request/response via
 * window.nexusAPI.ipc.invoke). event↓ = backend→renderer via webContents.send
 * (subscribe with ipc.on). event↑ = renderer→backend via ipc.send (ipcMain.on).
 */

// ── Domain models ────────────────────────────────────────────────────────

/** sftp/ftp/ftps/ssh are file-transfer protocols (browse + optional terminal); rdp is a display protocol (renders a remote desktop, no file browsing — see SessionInfo.kind). */
export type Protocol = "sftp" | "ftp" | "ftps" | "ssh" | "rdp";
export type AuthType = "password" | "key";

/**
 * A bastion/jump host a connection tunnels through (ProxyJump-style): SshSession
 * connects to this host first, then opens the real target connection through a
 * `forwardOut` channel over it. Reuses the same auth/secret shape as
 * ConnectionProfile rather than a separate model.
 */
export interface JumpHost {
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  /** Absolute path to a private key file when authType === "key". */
  privateKeyPath?: string | null;
  /** safeStorage-encrypted base64 (password OR key passphrase). NEVER sent to renderer. */
  secret?: string | null;
}

export type JumpHostDTO = Omit<JumpHost, "secret"> & { hasSecret: boolean };

export type JumpHostInput = Omit<JumpHost, "secret"> & {
  /** Plaintext secret to encrypt & store; omit to leave an existing secret unchanged. */
  secret?: string | null;
};

/** A saved connection profile, as persisted on disk (backend-only — includes secret). */
export interface ConnectionProfile {
  id: string;
  name: string;
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  /** Absolute path to a private key file when authType === "key". */
  privateKeyPath?: string | null;
  folderId?: string | null;
  tags: string[];
  defaultRemotePath?: string | null;
  color?: string | null;
  /** epoch ms of the last successful session:connect against this profile; null/undefined if never connected. */
  lastConnectedAt?: number | null;
  /** safeStorage-encrypted base64 (password OR key passphrase). NEVER sent to renderer. */
  secret?: string | null;
  /** Only meaningful for sftp/ssh — SshSession tunnels the connection through this host when set. */
  jumpHost?: JumpHost | null;
  /** sftp/ssh only — forward SSH_AUTH_SOCK so remote commands (git pull, sudo chains) can use local agent keys. */
  agentForward?: boolean;
  /** sftp/ssh only — command(s) auto-typed into the terminal once a shell opens on this connection, one per line. */
  onConnectCommand?: string | null;
}

/** Renderer-facing profile: secret stripped, replaced by a boolean flag. */
export type ConnectionProfileDTO = Omit<ConnectionProfile, "secret" | "jumpHost"> & {
  hasSecret: boolean;
  jumpHost?: JumpHostDTO | null;
};

/** Fields the renderer sends when creating/updating a profile. */
export type ConnectionInput = Omit<ConnectionProfile, "id" | "secret" | "jumpHost"> & {
  /** Plaintext secret to encrypt & store; omit to leave an existing secret unchanged. */
  secret?: string | null;
  jumpHost?: JumpHostInput | null;
};

export interface Folder {
  id: string;
  name: string;
  parentId?: string | null;
}

/** A file/directory entry in either the local or remote pane. */
export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  /** epoch ms */
  mtime: number;
  /** e.g. "rwxr-xr-x" when known */
  permissions?: string;
  /** true when the entry is a symbolic link */
  symlink?: boolean;
}

export interface DirListing {
  path: string;
  entries: FsEntry[];
}

export interface LocalRoots {
  home: string;
  volumes: FsEntry[];
}

export type TransferDirection = "upload" | "download";
export type TransferStatus = "queued" | "active" | "done" | "error" | "canceled";

// ── Connections (invoke) ──────────────────────────────────────────────────

export interface ConnectionsListResult {
  profiles: ConnectionProfileDTO[];
  folders: Folder[];
}

// connections:list                    → ConnectionsListResult
// connections:get      { id }         → ConnectionProfileDTO | null
// connections:create   { input }      → ConnectionProfileDTO
// connections:update   { id, patch }  → ConnectionProfileDTO
// connections:delete   { id }         → { ok: true }
// connections:moveToFolder { id, folderId } → ConnectionProfileDTO
// folders:create       { name, parentId? } → Folder
// folders:rename       { id, name }   → Folder
// folders:delete       { id }         → { ok: true }

export interface ConnectionsGetRequest {
  id: string;
}
export interface ConnectionsCreateRequest {
  input: ConnectionInput;
}
export interface ConnectionsUpdateRequest {
  id: string;
  patch: Partial<ConnectionInput>;
}
export interface ConnectionsDeleteRequest {
  id: string;
}
export interface ConnectionsMoveRequest {
  id: string;
  folderId: string | null;
}
export interface FoldersCreateRequest {
  name: string;
  parentId?: string | null;
}
export interface FoldersRenameRequest {
  id: string;
  name: string;
}
export interface FoldersDeleteRequest {
  id: string;
}
export interface OkResult {
  ok: true;
}

/**
 * connections:checkReachability — a plain TCP connect to host:port with a
 * short timeout, used to show a per-profile health dot. Never sends
 * credentials or performs a protocol handshake.
 */
export interface ConnectionsCheckReachabilityRequest {
  host: string;
  port: number;
}
export interface ConnectionsCheckReachabilityResult {
  reachable: boolean;
}

/**
 * connections:export / connections:import — portable backup of profiles +
 * folders to/from a single JSON file, written/read at a path the renderer
 * already picked via the dialog.showSaveDialog/showOpenDialog native bridge.
 *
 * Secrets are OMITTED by default — the safer choice, since the export file
 * may end up backed up or shared somewhere less trusted than this machine's
 * Keychain. Including them is an explicit opt-in that requires an export
 * password: each secret is decrypted from the vault and re-encrypted with a
 * key derived from that password (scrypt, see connection-export-crypto.ts) —
 * never exported as its safeStorage ciphertext, which is bound to this
 * machine/user's OS keychain and would be undecryptable anywhere else.
 */
export interface ConnectionsExportRequest {
  filePath: string;
  /** Omit to export every saved profile. */
  profileIds?: string[];
  includeSecrets: boolean;
  /** Required iff includeSecrets is true. */
  password?: string;
}
export interface ConnectionsExportResult {
  profileCount: number;
  folderCount: number;
}

export interface ConnectionsImportRequest {
  filePath: string;
  /** Required iff the file was exported with includeSecrets. */
  password?: string;
}
export interface ConnectionsImportResult {
  profileCount: number;
  folderCount: number;
}

// ── Sessions (invoke) ──────────────────────────────────────────────────────

/**
 * session:connect — connect using either a saved profile (profileId) or an
 * inline/ad-hoc profile. `secret` supplies a plaintext password/passphrase when
 * the profile has none stored (e.g. quick-connect or first-time prompt).
 */
export interface SessionConnectRequest {
  profileId?: string;
  inlineProfile?: ConnectionInput;
  secret?: string | null;
}

export interface SessionInfo {
  sessionId: string;
  profileId?: string | null;
  name: string;
  protocol: Protocol;
  host: string;
  username: string;
  /** Empty string for display (rdp) sessions — they have no filesystem. */
  homeDir: string;
  /** true when this protocol supports an interactive shell (sftp/ssh). */
  supportsTerminal: boolean;
  /** "file" (sftp/ftp/ftps/ssh — browse + optional terminal) or "display" (rdp — embedded remote-desktop tab, no file/terminal tabs). */
  kind: "file" | "display";
}

// session:connect    SessionConnectRequest → SessionInfo
// session:disconnect { sessionId }         → OkResult
// session:list                             → SessionInfo[]
export interface SessionDisconnectRequest {
  sessionId: string;
}

// ── Remote Desktop (rdp — invoke + events) ──────────────────────────────
//
// Unlike file sessions, a display session's actual pixels are rendered by a
// native macOS view composited directly into the BrowserWindow by the main
// process (native/nexus-display-host addon) — NOT drawn by the renderer.
// These channels only tell main where to position/size that native view and
// when to tear it down; there is no frame data crossing IPC.

/** Bounds (in the renderer's device-independent CSS pixels) of the placeholder the native view should be positioned/sized to cover. */
export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// display:connect  { sessionId, bounds } → OkResult   (creates + attaches the native child view, starts the RDP session)
// display:resize   { sessionId, bounds } → OkResult   (repositions/resizes the native child view — called on every ResizeObserver tick)
// display:disconnect { sessionId }       → OkResult   (tears down the native view + session)
// display:status↓ { sessionId, state, message? }  (backend→renderer: "connecting" | "connected" | "error" | "closed")

export interface DisplayConnectRequest {
  sessionId: string;
  bounds: DisplayBounds;
}
export interface DisplayResizeRequest {
  sessionId: string;
  bounds: DisplayBounds;
}
export interface DisplayDisconnectRequest {
  sessionId: string;
}
export type DisplaySessionState = "connecting" | "connected" | "error" | "closed";
export interface DisplayStatusEvent {
  sessionId: string;
  state: DisplaySessionState;
  message?: string;
}

// ── Remote FS (invoke — all carry sessionId) ────────────────────────────────

// remote:list     { sessionId, path }            → DirListing
// remote:mkdir    { sessionId, path }            → OkResult
// remote:rename   { sessionId, from, to }        → OkResult
// remote:delete   { sessionId, path, isDir }     → OkResult
// remote:readFile { sessionId, path }            → ReadFileResult
export interface RemoteListRequest {
  sessionId: string;
  path: string;
}
export interface RemoteMkdirRequest {
  sessionId: string;
  path: string;
}
export interface RemoteRenameRequest {
  sessionId: string;
  from: string;
  to: string;
}
export interface RemoteDeleteRequest {
  sessionId: string;
  path: string;
  isDir: boolean;
}
export interface RemoteReadFileRequest {
  sessionId: string;
  path: string;
}

/** Text preview of a file, size-capped. Binary files return isBinary=true. */
export interface ReadFileResult {
  text: string;
  size: number;
  /** true when the file exceeded the preview cap and text is partial */
  truncated: boolean;
  /** true when the content looks binary (not shown as text) */
  isBinary: boolean;
}

// ── Local FS (invoke) ────────────────────────────────────────────────────────

// local:list     { path? }            → DirListing  (path omitted → home)
// local:roots                         → LocalRoots
// local:mkdir    { path }             → OkResult
// local:rename   { from, to }         → OkResult
// local:delete   { path, isDir }      → OkResult
// local:readFile { path }             → ReadFileResult
export interface LocalListRequest {
  path?: string;
}
export interface LocalMkdirRequest {
  path: string;
}
export interface LocalRenameRequest {
  from: string;
  to: string;
}
export interface LocalDeleteRequest {
  path: string;
  isDir: boolean;
}
export interface LocalReadFileRequest {
  path: string;
}

// ── Remote edit round-trip (invoke + events) ────────────────────────────────

// edit:open { sessionId, path } → OkResult
//   Downloads the remote file to a temp path, opens it in the OS default editor,
//   watches for saves, and re-uploads to the server on each save.
export interface EditOpenRequest {
  sessionId: string;
  path: string;
}
// event↓ edit:saved { path, name }
export interface EditSavedEvent {
  path: string;
  name: string;
}
// event↓ edit:error { path, message }
export interface EditErrorEvent {
  path: string;
  message: string;
}

// edit:quickSave { sessionId, path, content } → OkResult
//   Writes `content` to a temp file and uploads it via the session's putFile —
//   the save path for the in-app quick editor (small text files only; see
//   ReadFileResult.isBinary / .truncated, used to gate the quick editor UI).
export interface EditQuickSaveRequest {
  sessionId: string;
  path: string;
  content: string;
}

// ── Remote search / grep (invoke — sftp/ssh sessions only) ─────────────────
//
// FTP/FTPS sessions have no remote exec capability, so remote:search only
// works against sftp/ssh sessions (sessionManager.getSsh throws otherwise) —
// the renderer hides the search UI for ftp/ftps sessions rather than calling it.

export interface SearchMatch {
  /** Absolute remote path of the matching file. */
  path: string;
  /** 1-based line number within that file. */
  line: number;
  /** The matching line's text, trimmed and length-capped. */
  snippet: string;
}

// remote:search { sessionId, path, query, maxResults? } → RemoteSearchResult
export interface RemoteSearchRequest {
  sessionId: string;
  path: string;
  query: string;
  maxResults?: number;
}
export interface RemoteSearchResult {
  matches: SearchMatch[];
  /** true when more matches existed than `matches` — narrow the query for a complete picture. */
  truncated: boolean;
}

// ── Remote places: bookmarks + recent locations (invoke) ───────────────────
//
// Keyed by connection profile id — ad-hoc (profile-less) sessions have no
// stable identity to persist against, so the renderer only offers these for
// sessions opened from a saved profile (SessionInfo.profileId set).

export interface RemotePlace {
  path: string;
  label?: string | null;
  /** epoch ms */
  addedAt: number;
}

// remotePlaces:listBookmarks { profileId }              → RemotePlacesBookmarksResult
// remotePlaces:addBookmark    { profileId, path, label? } → RemotePlacesBookmarksResult
// remotePlaces:removeBookmark { profileId, path }        → RemotePlacesBookmarksResult
// remotePlaces:listRecents    { profileId }              → RemotePlacesRecentsResult
// remotePlaces:recordVisit    { profileId, path }        → OkResult
export interface RemotePlacesListRequest {
  profileId: string;
}
export interface RemotePlacesAddBookmarkRequest {
  profileId: string;
  path: string;
  label?: string;
}
export interface RemotePlacesRemoveBookmarkRequest {
  profileId: string;
  path: string;
}
export interface RemotePlacesRecordVisitRequest {
  profileId: string;
  path: string;
}
export interface RemotePlacesBookmarksResult {
  bookmarks: RemotePlace[];
}
export interface RemotePlacesRecentsResult {
  recents: string[];
}

// ── Transfers (invoke + events) ──────────────────────────────────────────────

// transfer:upload   { sessionId, localPath, remotePath } → { transferId }
// transfer:download { sessionId, remotePath, localPath } → { transferId }
// transfer:cancel   { transferId }                        → OkResult
export interface TransferUploadRequest {
  sessionId: string;
  localPath: string;
  remotePath: string;
}
export interface TransferDownloadRequest {
  sessionId: string;
  remotePath: string;
  localPath: string;
}
export interface TransferCancelRequest {
  transferId: string;
}
export interface TransferStartResult {
  transferId: string;
}

/** Snapshot of a transfer, mirrored to the renderer via events. */
export interface TransferItem {
  transferId: string;
  sessionId: string;
  direction: TransferDirection;
  name: string;
  localPath: string;
  remotePath: string;
  status: TransferStatus;
  transferred: number;
  total: number;
  bytesPerSec: number;
  error?: string;
}

// event↓ transfer:progress { transferId, transferred, total, bytesPerSec }
// event↓ transfer:done     { transferId }
// event↓ transfer:error    { transferId, message }
// event↓ transfer:queued   TransferItem
//   Emitted when a transfer is queued by something other than the renderer's
//   own upload/download call (currently: sync execution) so the transfer
//   queue panel can track it from the start like any other transfer.
export interface TransferProgressEvent {
  transferId: string;
  transferred: number;
  total: number;
  bytesPerSec: number;
}
export interface TransferDoneEvent {
  transferId: string;
}
export interface TransferErrorEvent {
  transferId: string;
  message: string;
}

// ── Directory sync (invoke + events) ────────────────────────────────────────
//
// A sync always runs between one local directory and one remote directory on
// an open session. sync:plan computes what WOULD happen (no filesystem/network
// mutation); sync:execute runs a plan the user has already seen and confirmed;
// sync:diff fetches both sides' full text for one entry on demand, for the
// plan-preview's "view diff" option.
// Upload/download actions execute through the same TransferManager used by
// manual transfers (see transfer:queued above); deletions are immediate,
// one-shot operations with no meaningful progress of their own.

export type SyncMode = "upload" | "download" | "two-way";

/**
 * "conflict" only ever appears in two-way mode: without a stored "last
 * synced" baseline there's no reliable way to tell whether just one side
 * changed or both did, so any both-sides-differ case is surfaced for the
 * user to resolve by hand rather than silently picking a winner.
 */
export type SyncActionType = "upload" | "download" | "delete-local" | "delete-remote" | "conflict";

export interface SyncPlanEntry {
  /** posix-relative path from the sync root, e.g. "sub/dir/file.txt" */
  relPath: string;
  action: SyncActionType;
  /** size (bytes) of the copy that would become authoritative, or of the side being deleted */
  size: number;
  /** short human-readable reason, e.g. "only on local", "remote is newer" */
  detail: string;
  /**
   * Whether sync:diff can show a line-level diff for this entry: only true
   * when a copy exists on both sides (excludes "only on local/remote" and
   * delete entries) and the file looks like text and is under the same size
   * cap as the quick editor — see isDiffEligible in sync-manager.ts.
   */
  canDiff: boolean;
}

// sync:plan    { sessionId, localRoot, remoteRoot, mode, deleteOrphans }        → SyncPlanResult
// sync:execute { sessionId, localRoot, remoteRoot, entries }                    → SyncExecuteResult
// sync:diff    { sessionId, localRoot, remoteRoot, relPath }                    → SyncDiffResult
export interface SyncPlanRequest {
  sessionId: string;
  localRoot: string;
  remoteRoot: string;
  mode: SyncMode;
  /** Whether to delete files present on only one side to mirror completely. Off by default — explicit opt-in. */
  deleteOrphans: boolean;
}
export interface SyncPlanResult {
  entries: SyncPlanEntry[];
}

export interface SyncExecuteRequest {
  sessionId: string;
  localRoot: string;
  remoteRoot: string;
  /** The plan entries the user confirmed — "conflict" entries are never executed. */
  entries: SyncPlanEntry[];
}
export interface SyncExecuteResult {
  completed: number;
  total: number;
  failed: Array<{ relPath: string; message: string }>;
}

// event↓ sync:progress { completed, total, relPath }
export interface SyncProgressEvent {
  completed: number;
  total: number;
  relPath: string;
}

export interface SyncDiffRequest {
  sessionId: string;
  localRoot: string;
  remoteRoot: string;
  relPath: string;
}
export interface SyncDiffResult {
  local: ReadFileResult;
  remote: ReadFileResult;
}
// ── Activity log (invoke) ───────────────────────────────────────────────────
//
// Append-only record of notable cross-session events (connect, disconnect,
// transfer completed/failed, sync run), persisted across app restarts and
// capped at a fixed size — see main/services/activity-log.ts.

export type ActivityLogEventType = "connect" | "disconnect" | "transfer-done" | "transfer-error" | "sync-done";

export interface ActivityLogEntry {
  id: string;
  /** epoch ms */
  timestamp: number;
  type: ActivityLogEventType;
  message: string;
  detail?: string;
}

// activityLog:list → ActivityLogListResult (most recent first)
export interface ActivityLogListResult {
  entries: ActivityLogEntry[];
}

// ── AI terminal suggestions (invoke) ────────────────────────────────────────
//
// Per-user, off-by-default setting: the user supplies their own API key for an
// OpenAI-compatible completions endpoint. Never bundled, never sent anywhere
// unless enabled and a key is present. The key itself never crosses the IPC
// boundary to the renderer — only a `hasApiKey` flag does (same pattern as
// ConnectionProfileDTO's `hasSecret`).

export interface AiSuggestConfig {
  enabled: boolean;
  /** Base URL of an OpenAI-compatible chat completions endpoint. */
  endpoint: string;
  model: string;
  hasApiKey: boolean;
}

export interface AiSuggestConfigInput {
  enabled: boolean;
  endpoint: string;
  model: string;
  /** Plaintext API key to encrypt & store; omit to leave an existing key unchanged. */
  apiKey?: string | null;
}

// settings:getAiSuggestConfig                    → AiSuggestConfig
// settings:setAiSuggestConfig { config }          → AiSuggestConfig
export interface SettingsSetAiSuggestConfigRequest {
  config: AiSuggestConfigInput;
}

// settings:getNotificationsEnabled                → boolean
// settings:setNotificationsEnabled { enabled }     → boolean
export interface SettingsSetNotificationsEnabledRequest {
  enabled: boolean;
}

/**
 * ai:suggest — the actual completion call, gated server-side on
 * AiSuggestConfig.enabled + a stored key (see main/services/ai-completion-service.ts).
 * Not yet called from anywhere in the renderer — the terminal-side trigger
 * (keybinding + inline suggestion rendering) is deferred, see report notes.
 */
export interface AiSuggestRequest {
  partialCommand: string;
  /** Recent shell history lines, most recent last, for extra context. */
  recentHistory?: string[];
}
export interface AiSuggestResult {
  /** null when suggestions are disabled, unconfigured, or the request failed. */
  suggestion: string | null;
}

// ── Port forwards (invoke + events, per SSH session) ───────────────────────

/**
 * "local" (-L): listen on srcHost:srcPort, forward each connection through the
 * session to dstHost:dstPort. "remote" (-R): ask the remote server to listen
 * on srcHost:srcPort and forward connections back to dstHost:dstPort. "dynamic"
 * (-D, SOCKS) is not implemented yet — the renderer does not offer it.
 */
export type PortForwardType = "local" | "remote" | "dynamic";
export type PortForwardState = "starting" | "listening" | "error" | "stopped";

export interface PortForwardRule {
  id: string;
  sessionId: string;
  type: PortForwardType;
  /** Bind/listen address for local forwards (remote forwards bind on the server side). */
  srcHost: string;
  srcPort: number;
  /** Forward destination — required for local/remote; absent for dynamic. */
  dstHost?: string | null;
  dstPort?: number | null;
  state: PortForwardState;
  error?: string | null;
  connectionCount: number;
  bytesIn: number;
  bytesOut: number;
}

// portForward:start { sessionId, type, srcHost?, srcPort, dstHost?, dstPort? } → PortForwardRule
// portForward:stop  { id }                                                    → OkResult
// portForward:list  { sessionId }                                             → PortForwardRule[]
export interface PortForwardStartRequest {
  sessionId: string;
  type: PortForwardType;
  srcHost?: string;
  srcPort: number;
  dstHost?: string;
  dstPort?: number;
}
export interface PortForwardStopRequest {
  id: string;
}
export interface PortForwardListRequest {
  sessionId: string;
}

// event↓ portForward:update { rule }  (connection count/bytes/state changed)
export interface PortForwardUpdateEvent {
  rule: PortForwardRule;
}

// ── SSH config import (invoke) ──────────────────────────────────────────────
//
// Read-only: parses ~/.ssh/config into candidate hosts for the connection
// manager's import picker. Creating profiles from the ones the user selects
// goes through the existing connections:create channel — there is no
// separate "create from ssh config" channel.

/** One Host block parsed from ~/.ssh/config (see main/services/ssh-config-parser.ts). */
export interface SshConfigHost {
  alias: string;
  hostName?: string;
  port?: number;
  user?: string;
  /** Absolute path, tilde-expanded. */
  identityFile?: string;
  proxyJump?: string;
}

// sshConfig:list → SshConfigListResult
export interface SshConfigListResult {
  hosts: SshConfigHost[];
}

// ── Command snippets (invoke) ───────────────────────────────────────────────

export interface CommandSnippet {
  id: string;
  name: string;
  command: string;
  tags: string[];
  /** epoch ms */
  createdAt: number;
}

export type SnippetInput = Omit<CommandSnippet, "id" | "createdAt">;

// snippet:list                   → SnippetsListResult
// snippet:create { input }       → CommandSnippet
// snippet:update { id, patch }   → CommandSnippet
// snippet:delete { id }          → OkResult
export interface SnippetsListResult {
  snippets: CommandSnippet[];
}
export interface SnippetCreateRequest {
  input: SnippetInput;
}
export interface SnippetUpdateRequest {
  id: string;
  patch: Partial<SnippetInput>;
}
export interface SnippetDeleteRequest {
  id: string;
}

// ── Terminal (invoke + events) ────────────────────────────────────────────────

// terminal:open   { sessionId, cols, rows } → { terminalId }
// terminal:resize { terminalId, cols, rows } → OkResult
// terminal:close  { terminalId }             → OkResult
export interface TerminalOpenRequest {
  sessionId: string;
  cols: number;
  rows: number;
}
export interface TerminalOpenResult {
  terminalId: string;
}
export interface TerminalResizeRequest {
  terminalId: string;
  cols: number;
  rows: number;
}
export interface TerminalCloseRequest {
  terminalId: string;
}

// event↑ terminal:input { terminalId, data }
export interface TerminalInputEvent {
  terminalId: string;
  data: string;
}
// event↓ terminal:data  { terminalId, chunk }   (chunk is a utf-8 string)
export interface TerminalDataEvent {
  terminalId: string;
  chunk: string;
}
// event↓ terminal:exit  { terminalId, code }
export interface TerminalExitEvent {
  terminalId: string;
  code: number | null;
}

// ── Channel name constants (single source of truth for both layers) ───────────

export const IPC = {
  connections: {
    list: "connections:list",
    get: "connections:get",
    create: "connections:create",
    update: "connections:update",
    delete: "connections:delete",
    moveToFolder: "connections:moveToFolder",
    checkReachability: "connections:checkReachability",
    export: "connections:export",
    import: "connections:import",
  },
  folders: {
    create: "folders:create",
    rename: "folders:rename",
    delete: "folders:delete",
  },
  session: {
    connect: "session:connect",
    disconnect: "session:disconnect",
    list: "session:list",
  },
  remote: {
    list: "remote:list",
    mkdir: "remote:mkdir",
    rename: "remote:rename",
    delete: "remote:delete",
    readFile: "remote:readFile",
    search: "remote:search",
  },
  local: {
    list: "local:list",
    roots: "local:roots",
    mkdir: "local:mkdir",
    rename: "local:rename",
    delete: "local:delete",
    readFile: "local:readFile",
  },
  edit: {
    open: "edit:open",
    saved: "edit:saved",
    error: "edit:error",
    quickSave: "edit:quickSave",
  },
  remotePlaces: {
    listBookmarks: "remotePlaces:listBookmarks",
    addBookmark: "remotePlaces:addBookmark",
    removeBookmark: "remotePlaces:removeBookmark",
    listRecents: "remotePlaces:listRecents",
    recordVisit: "remotePlaces:recordVisit",
  },
  transfer: {
    upload: "transfer:upload",
    download: "transfer:download",
    cancel: "transfer:cancel",
    progress: "transfer:progress",
    done: "transfer:done",
    error: "transfer:error",
    queued: "transfer:queued",
  },
  sync: {
    plan: "sync:plan",
    execute: "sync:execute",
    progress: "sync:progress",
    diff: "sync:diff",
  },
  terminal: {
    open: "terminal:open",
    resize: "terminal:resize",
    close: "terminal:close",
    input: "terminal:input",
    data: "terminal:data",
    exit: "terminal:exit",
  },
  portForward: {
    start: "portForward:start",
    stop: "portForward:stop",
    list: "portForward:list",
    update: "portForward:update",
  },
  display: {
    connect: "display:connect",
    resize: "display:resize",
    disconnect: "display:disconnect",
    status: "display:status",
  },
  sshConfig: {
    list: "sshConfig:list",
  },
  snippet: {
    list: "snippet:list",
    create: "snippet:create",
    update: "snippet:update",
    delete: "snippet:delete",
  },
  activityLog: {
    list: "activityLog:list",
  },
  settings: {
    getAiSuggestConfig: "settings:getAiSuggestConfig",
    setAiSuggestConfig: "settings:setAiSuggestConfig",
    getNotificationsEnabled: "settings:getNotificationsEnabled",
    setNotificationsEnabled: "settings:setNotificationsEnabled",
  },
  ai: {
    suggest: "ai:suggest",
  },
} as const;
