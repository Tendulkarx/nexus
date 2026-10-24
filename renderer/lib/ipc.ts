/**
 * Typed IPC wrapper — thin layer over window.nexusAPI.ipc using the
 * IPC contract types. Import `ipc` for invocations and subscriptions.
 */

import type { AppPreferences } from "@shared/preferences";
import {
  IPC,
  type SessionDisconnectedEvent,
  type PreferencesUpdateRequest,
  type VncOpenRequest,
  type VncOpenResult,
  type VncSendMessage,
  type VncCloseRequest,
  type VncCredentials,
  type VncDataEvent,
  type VncClosedEvent,
  type X11Status,
  type LocalServerConfig,
  type LocalServerStatus,
  type LocalServerStopRequest,
  type SessionIniParseRequest,
  type SessionIniParseResult,
  type PortScanStartRequest,
  type NetworkScanStartRequest,
  type ScanStartResult,
  type ScanCancelRequest,
  type LocalNetwork,
  type FolderCompareRequest,
  type FolderCompareResult,
  type PortScanProgressEvent,
  type NetworkScanProgressEvent,
  type ScanDoneEvent,
  type BrewStatus,
  type CronTarget,
  type CronTabResult,
  type CronWriteRequest,
  type BrewPackage,
  type BrewStartRequest,
  type BrewOutputEvent,
  type BrewDoneEvent,
  type ConnectionsListResult,
  type ConnectionProfileDTO,
  type ConnectionsGetRequest,
  type ConnectionsCreateRequest,
  type ConnectionsUpdateRequest,
  type ConnectionsDeleteRequest,
  type ConnectionsMoveRequest,
  type ConnectionsCheckReachabilityRequest,
  type ConnectionsCheckReachabilityResult,
  type ConnectionsExportRequest,
  type ConnectionsExportResult,
  type ConnectionsImportRequest,
  type ConnectionsImportResult,
  type ConnectionSyncStatus,
  type ConnectionSyncConfigureRequest,
  type FoldersCreateRequest,
  type FoldersRenameRequest,
  type FoldersDeleteRequest,
  type OkResult,
  type Folder,
  type SessionConnectRequest,
  type SessionInfo,
  type SessionDisconnectRequest,
  type RemoteListRequest,
  type RemoteMkdirRequest,
  type RemoteRenameRequest,
  type RemoteDeleteRequest,
  type RemoteReadFileRequest,
  type RemoteSearchRequest,
  type RemoteSearchResult,
  type LocalListRequest,
  type LocalMkdirRequest,
  type LocalRenameRequest,
  type LocalDeleteRequest,
  type LocalReadFileRequest,
  type LocalRoots,
  type DirListing,
  type ReadFileResult,
  type EditOpenRequest,
  type EditSavedEvent,
  type EditErrorEvent,
  type EditQuickSaveRequest,
  type RemotePlacesListRequest,
  type RemotePlacesAddBookmarkRequest,
  type RemotePlacesRemoveBookmarkRequest,
  type RemotePlacesRecordVisitRequest,
  type RemotePlacesBookmarksResult,
  type RemotePlacesRecentsResult,
  type TransferUploadRequest,
  type TransferDownloadRequest,
  type TransferCancelRequest,
  type TransferStartResult,
  type TerminalOpenRequest,
  type TerminalOpenResult,
  type TerminalResizeRequest,
  type TerminalCloseRequest,
  type TerminalInputEvent,
  type TransferProgressEvent,
  type TransferDoneEvent,
  type TransferErrorEvent,
  type TransferItem,
  type SyncPlanRequest,
  type SyncPlanResult,
  type SyncExecuteRequest,
  type SyncExecuteResult,
  type SyncProgressEvent,
  type SyncDiffRequest,
  type SyncDiffResult,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type DisplayConnectRequest,
  type DisplayResizeRequest,
  type DisplayDisconnectRequest,
  type DisplayStatusEvent,
  type DisplayTrustPromptEvent,
  type DisplayTrustDecisionRequest,
  type PortForwardStartRequest,
  type PortForwardStopRequest,
  type PortForwardListRequest,
  type PortForwardRule,
  type PortForwardUpdateEvent,
  type SshConfigListResult,
  type SnippetsListResult,
  type SnippetCreateRequest,
  type SnippetUpdateRequest,
  type SnippetDeleteRequest,
  type CommandSnippet,
  type ActivityLogListResult,
  type AiSuggestConfig,
  type AiSuggestConfigInput,
  type AiSuggestRequest,
  type AiSuggestResult,
} from "@shared/ipc-contract";

function invoke<TResult>(channel: string, payload?: unknown): Promise<TResult> {
  return window.nexusAPI.ipc.invoke<TResult>(channel, payload);
}

function on<TPayload>(channel: string, handler: (payload: TPayload) => void): () => void {
  return window.nexusAPI.ipc.on(channel, (_event, payload) => {
    handler(payload as TPayload);
  });
}

export const ipc = {
  // Connections
  connections: {
    list: () => invoke<ConnectionsListResult>(IPC.connections.list),
    get: (req: ConnectionsGetRequest) => invoke<ConnectionProfileDTO | null>(IPC.connections.get, req),
    create: (req: ConnectionsCreateRequest) => invoke<ConnectionProfileDTO>(IPC.connections.create, req),
    update: (req: ConnectionsUpdateRequest) => invoke<ConnectionProfileDTO>(IPC.connections.update, req),
    delete: (req: ConnectionsDeleteRequest) => invoke<OkResult>(IPC.connections.delete, req),
    moveToFolder: (req: ConnectionsMoveRequest) => invoke<ConnectionProfileDTO>(IPC.connections.moveToFolder, req),
    checkReachability: (req: ConnectionsCheckReachabilityRequest) =>
      invoke<ConnectionsCheckReachabilityResult>(IPC.connections.checkReachability, req),
    export: (req: ConnectionsExportRequest) => invoke<ConnectionsExportResult>(IPC.connections.export, req),
    import: (req: ConnectionsImportRequest) => invoke<ConnectionsImportResult>(IPC.connections.import, req),
  },

  // Cross-device connection sync (folder-based — see connection-sync-service.ts)
  connectionSync: {
    getStatus: () => invoke<ConnectionSyncStatus>(IPC.connectionSync.getStatus),
    configure: (req: ConnectionSyncConfigureRequest) =>
      invoke<ConnectionSyncStatus>(IPC.connectionSync.configure, req),
    disable: () => invoke<ConnectionSyncStatus>(IPC.connectionSync.disable),
    syncNow: () => invoke<ConnectionSyncStatus>(IPC.connectionSync.syncNow),
    onStatusChanged: (handler: (payload: ConnectionSyncStatus) => void) =>
      on<ConnectionSyncStatus>(IPC.connectionSync.statusChanged, handler),
  },

  // Folders
  folders: {
    create: (req: FoldersCreateRequest) => invoke<Folder>(IPC.folders.create, req),
    rename: (req: FoldersRenameRequest) => invoke<Folder>(IPC.folders.rename, req),
    delete: (req: FoldersDeleteRequest) => invoke<OkResult>(IPC.folders.delete, req),
  },

  // Sessions
  session: {
    connect: (req: SessionConnectRequest) => invoke<SessionInfo>(IPC.session.connect, req),
    openLocal: () => invoke<SessionInfo>(IPC.session.openLocal),
    x11Status: () => invoke<X11Status>(IPC.session.x11Status),
    serialPorts: () => invoke<string[]>(IPC.session.serialPorts),
    onDisconnected: (handler: (payload: SessionDisconnectedEvent) => void) =>
      on<SessionDisconnectedEvent>(IPC.session.disconnected, handler),
    disconnect: (req: SessionDisconnectRequest) => invoke<OkResult>(IPC.session.disconnect, req),
    list: () => invoke<SessionInfo[]>(IPC.session.list),
  },

  // Remote FS
  remote: {
    list: (req: RemoteListRequest) => invoke<DirListing>(IPC.remote.list, req),
    mkdir: (req: RemoteMkdirRequest) => invoke<OkResult>(IPC.remote.mkdir, req),
    rename: (req: RemoteRenameRequest) => invoke<OkResult>(IPC.remote.rename, req),
    delete: (req: RemoteDeleteRequest) => invoke<OkResult>(IPC.remote.delete, req),
    readFile: (req: RemoteReadFileRequest) => invoke<ReadFileResult>(IPC.remote.readFile, req),
    search: (req: RemoteSearchRequest) => invoke<RemoteSearchResult>(IPC.remote.search, req),
  },

  // Local FS
  local: {
    list: (req?: LocalListRequest) => invoke<DirListing>(IPC.local.list, req),
    roots: () => invoke<LocalRoots>(IPC.local.roots),
    mkdir: (req: LocalMkdirRequest) => invoke<OkResult>(IPC.local.mkdir, req),
    rename: (req: LocalRenameRequest) => invoke<OkResult>(IPC.local.rename, req),
    delete: (req: LocalDeleteRequest) => invoke<OkResult>(IPC.local.delete, req),
    readFile: (req: LocalReadFileRequest) => invoke<ReadFileResult>(IPC.local.readFile, req),
  },

  // Remote edit round-trip
  edit: {
    open: (req: EditOpenRequest) => invoke<OkResult>(IPC.edit.open, req),
    quickSave: (req: EditQuickSaveRequest) => invoke<OkResult>(IPC.edit.quickSave, req),
    onSaved: (handler: (payload: EditSavedEvent) => void) => on<EditSavedEvent>(IPC.edit.saved, handler),
    onError: (handler: (payload: EditErrorEvent) => void) => on<EditErrorEvent>(IPC.edit.error, handler),
  },

  // Remote places: bookmarks + recent locations (per connection profile)
  remotePlaces: {
    listBookmarks: (req: RemotePlacesListRequest) =>
      invoke<RemotePlacesBookmarksResult>(IPC.remotePlaces.listBookmarks, req),
    addBookmark: (req: RemotePlacesAddBookmarkRequest) =>
      invoke<RemotePlacesBookmarksResult>(IPC.remotePlaces.addBookmark, req),
    removeBookmark: (req: RemotePlacesRemoveBookmarkRequest) =>
      invoke<RemotePlacesBookmarksResult>(IPC.remotePlaces.removeBookmark, req),
    listRecents: (req: RemotePlacesListRequest) => invoke<RemotePlacesRecentsResult>(IPC.remotePlaces.listRecents, req),
    recordVisit: (req: RemotePlacesRecordVisitRequest) => invoke<OkResult>(IPC.remotePlaces.recordVisit, req),
  },

  // Transfers
  transfer: {
    upload: (req: TransferUploadRequest) => invoke<TransferStartResult>(IPC.transfer.upload, req),
    download: (req: TransferDownloadRequest) => invoke<TransferStartResult>(IPC.transfer.download, req),
    cancel: (req: TransferCancelRequest) => invoke<OkResult>(IPC.transfer.cancel, req),
    onProgress: (handler: (payload: TransferProgressEvent) => void) =>
      on<TransferProgressEvent>(IPC.transfer.progress, handler),
    onDone: (handler: (payload: TransferDoneEvent) => void) => on<TransferDoneEvent>(IPC.transfer.done, handler),
    onError: (handler: (payload: TransferErrorEvent) => void) => on<TransferErrorEvent>(IPC.transfer.error, handler),
    onQueued: (handler: (payload: TransferItem) => void) => on<TransferItem>(IPC.transfer.queued, handler),
  },

  // Directory sync
  sync: {
    plan: (req: SyncPlanRequest) => invoke<SyncPlanResult>(IPC.sync.plan, req),
    execute: (req: SyncExecuteRequest) => invoke<SyncExecuteResult>(IPC.sync.execute, req),
    diff: (req: SyncDiffRequest) => invoke<SyncDiffResult>(IPC.sync.diff, req),
    onProgress: (handler: (payload: SyncProgressEvent) => void) => on<SyncProgressEvent>(IPC.sync.progress, handler),
  },

  // Terminal
  terminal: {
    open: (req: TerminalOpenRequest) => invoke<TerminalOpenResult>(IPC.terminal.open, req),
    resize: (req: TerminalResizeRequest) => invoke<OkResult>(IPC.terminal.resize, req),
    close: (req: TerminalCloseRequest) => invoke<OkResult>(IPC.terminal.close, req),
    send: (payload: TerminalInputEvent) => window.nexusAPI.ipc.send(IPC.terminal.input, payload),
    onData: (handler: (payload: TerminalDataEvent) => void) => on<TerminalDataEvent>(IPC.terminal.data, handler),
    onExit: (handler: (payload: TerminalExitEvent) => void) => on<TerminalExitEvent>(IPC.terminal.exit, handler),
  },

  // Remote Desktop (rdp) — no pixel data crosses IPC, see ipc-contract.ts
  display: {
    connect: (req: DisplayConnectRequest) => invoke<OkResult>(IPC.display.connect, req),
    resize: (req: DisplayResizeRequest) => invoke<OkResult>(IPC.display.resize, req),
    disconnect: (req: DisplayDisconnectRequest) => invoke<OkResult>(IPC.display.disconnect, req),
    onStatus: (handler: (payload: DisplayStatusEvent) => void) => on<DisplayStatusEvent>(IPC.display.status, handler),
    trustDecision: (req: DisplayTrustDecisionRequest) => invoke<OkResult>(IPC.display.trustDecision, req),
    onTrustPrompt: (handler: (payload: DisplayTrustPromptEvent) => void) =>
      on<DisplayTrustPromptEvent>(IPC.display.trustPrompt, handler),
  },

  // Port forwards (local/remote — dynamic/SOCKS not implemented yet)
  portForward: {
    start: (req: PortForwardStartRequest) => invoke<PortForwardRule>(IPC.portForward.start, req),
    stop: (req: PortForwardStopRequest) => invoke<OkResult>(IPC.portForward.stop, req),
    list: (req: PortForwardListRequest) => invoke<PortForwardRule[]>(IPC.portForward.list, req),
    onUpdate: (handler: (payload: PortForwardUpdateEvent) => void) =>
      on<PortForwardUpdateEvent>(IPC.portForward.update, handler),
  },

  // VNC viewer byte channels (see workspace/remote-desktop/vnc-channel.ts)
  vnc: {
    open: (req: VncOpenRequest) => invoke<VncOpenResult>(IPC.vnc.open, req),
    send: (msg: VncSendMessage) => window.nexusAPI.ipc.send(IPC.vnc.send, msg),
    close: (req: VncCloseRequest) => invoke<OkResult>(IPC.vnc.close, req),
    credentials: (req: VncOpenRequest) => invoke<VncCredentials>(IPC.vnc.credentials, req),
    onData: (handler: (payload: VncDataEvent) => void) => on<VncDataEvent>(IPC.vnc.data, handler),
    onClosed: (handler: (payload: VncClosedEvent) => void) => on<VncClosedEvent>(IPC.vnc.closed, handler),
  },

  // Settings-window preferences (see shared/preferences.ts and lib/preferences.ts)
  preferences: {
    get: () => invoke<AppPreferences>(IPC.preferences.get),
    update: (req: PreferencesUpdateRequest) => invoke<AppPreferences>(IPC.preferences.update, req),
    onChanged: (handler: (payload: AppPreferences) => void) => on<AppPreferences>(IPC.preferences.changed, handler),
  },

  // Local servers (Servers sidebar)
  servers: {
    list: () => invoke<LocalServerStatus[]>(IPC.servers.list),
    start: (config: LocalServerConfig) => invoke<LocalServerStatus>(IPC.servers.start, config),
    stop: (req: LocalServerStopRequest) => invoke<LocalServerStatus>(IPC.servers.stop, req),
    onStatus: (handler: (payload: LocalServerStatus) => void) => on<LocalServerStatus>(IPC.servers.status, handler),
  },

  // Session .ini import
  sessionImport: {
    parseIni: (req: SessionIniParseRequest) => invoke<SessionIniParseResult>(IPC.sessionImport.parseIni, req),
  },

  // SSH config import
  sshConfig: {
    list: () => invoke<SshConfigListResult>(IPC.sshConfig.list),
  },

  // Command snippet library
  snippet: {
    list: () => invoke<SnippetsListResult>(IPC.snippet.list),
    create: (req: SnippetCreateRequest) => invoke<CommandSnippet>(IPC.snippet.create, req),
    update: (req: SnippetUpdateRequest) => invoke<CommandSnippet>(IPC.snippet.update, req),
    delete: (req: SnippetDeleteRequest) => invoke<OkResult>(IPC.snippet.delete, req),
  },

  // Cross-session activity log
  activityLog: {
    list: () => invoke<ActivityLogListResult>(IPC.activityLog.list),
  },

  // App-level settings (opt-in AI terminal suggestions, native-notifications toggle)
  settings: {
    getAiSuggestConfig: () => invoke<AiSuggestConfig>(IPC.settings.getAiSuggestConfig),
    setAiSuggestConfig: (config: AiSuggestConfigInput) =>
      invoke<AiSuggestConfig>(IPC.settings.setAiSuggestConfig, { config }),
    getNotificationsEnabled: () => invoke<boolean>(IPC.settings.getNotificationsEnabled),
    setNotificationsEnabled: (enabled: boolean) => invoke<boolean>(IPC.settings.setNotificationsEnabled, { enabled }),
  },

  // AI terminal suggestions — completion call. Not yet invoked from anywhere
  // in the renderer; see report notes on the deferred terminal-side trigger.
  ai: {
    suggest: (req: AiSuggestRequest) => invoke<AiSuggestResult>(IPC.ai.suggest, req),
  },

  // Tools tab: scans run in the background and report through the on* events
  tools: {
    startPortScan: (req: PortScanStartRequest) => invoke<ScanStartResult>(IPC.tools.portScanStart, req),
    startNetworkScan: (req: NetworkScanStartRequest) => invoke<ScanStartResult>(IPC.tools.networkScanStart, req),
    cancelScan: (req: ScanCancelRequest) => invoke<OkResult>(IPC.tools.cancelScan, req),
    localNetworks: () => invoke<LocalNetwork[]>(IPC.tools.localNetworks),
    compareFolders: (req: FolderCompareRequest) => invoke<FolderCompareResult>(IPC.tools.folderCompare, req),
    onPortScanProgress: (handler: (payload: PortScanProgressEvent) => void) =>
      on<PortScanProgressEvent>(IPC.tools.portScanProgress, handler),
    onNetworkScanProgress: (handler: (payload: NetworkScanProgressEvent) => void) =>
      on<NetworkScanProgressEvent>(IPC.tools.networkScanProgress, handler),
    onScanDone: (handler: (payload: ScanDoneEvent) => void) => on<ScanDoneEvent>(IPC.tools.scanDone, handler),
    cronRead: (req: { target: CronTarget }) => invoke<CronTabResult>(IPC.tools.cronRead, req),
    cronWrite: (req: CronWriteRequest) => invoke<CronTabResult>(IPC.tools.cronWrite, req),
    brewStatus: () => invoke<BrewStatus>(IPC.tools.brewStatus),
    brewInstalled: () => invoke<BrewPackage[]>(IPC.tools.brewInstalled),
    brewSearch: (req: { query: string }) => invoke<BrewPackage[]>(IPC.tools.brewSearch, req),
    brewStart: (req: BrewStartRequest) => invoke<{ jobId: string }>(IPC.tools.brewStart, req),
    brewCancel: (req: { jobId: string }) => invoke<OkResult>(IPC.tools.brewCancel, req),
    onBrewOutput: (handler: (payload: BrewOutputEvent) => void) => on<BrewOutputEvent>(IPC.tools.brewOutput, handler),
    onBrewDone: (handler: (payload: BrewDoneEvent) => void) => on<BrewDoneEvent>(IPC.tools.brewDone, handler),
  },
} as const;
