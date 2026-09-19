/**
 * Typed IPC wrapper — thin layer over window.nexusAPI.ipc using the
 * IPC contract types. Import `ipc` for invocations and subscriptions.
 */

import {
  IPC,
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
  type TerminalDataEvent,
  type TerminalExitEvent,
  type DisplayConnectRequest,
  type DisplayResizeRequest,
  type DisplayDisconnectRequest,
  type DisplayStatusEvent,
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

function on<TPayload>(
  channel: string,
  handler: (payload: TPayload) => void,
): () => void {
  return window.nexusAPI.ipc.on(channel, (_event, payload) => {
    handler(payload as TPayload);
  });
}

export const ipc = {
  // Connections
  connections: {
    list: () =>
      invoke<ConnectionsListResult>(IPC.connections.list),
    get: (req: ConnectionsGetRequest) =>
      invoke<ConnectionProfileDTO | null>(IPC.connections.get, req),
    create: (req: ConnectionsCreateRequest) =>
      invoke<ConnectionProfileDTO>(IPC.connections.create, req),
    update: (req: ConnectionsUpdateRequest) =>
      invoke<ConnectionProfileDTO>(IPC.connections.update, req),
    delete: (req: ConnectionsDeleteRequest) =>
      invoke<OkResult>(IPC.connections.delete, req),
    moveToFolder: (req: ConnectionsMoveRequest) =>
      invoke<ConnectionProfileDTO>(IPC.connections.moveToFolder, req),
    checkReachability: (req: ConnectionsCheckReachabilityRequest) =>
      invoke<ConnectionsCheckReachabilityResult>(IPC.connections.checkReachability, req),
    export: (req: ConnectionsExportRequest) =>
      invoke<ConnectionsExportResult>(IPC.connections.export, req),
    import: (req: ConnectionsImportRequest) =>
      invoke<ConnectionsImportResult>(IPC.connections.import, req),
  },

  // Folders
  folders: {
    create: (req: FoldersCreateRequest) =>
      invoke<Folder>(IPC.folders.create, req),
    rename: (req: FoldersRenameRequest) =>
      invoke<Folder>(IPC.folders.rename, req),
    delete: (req: FoldersDeleteRequest) =>
      invoke<OkResult>(IPC.folders.delete, req),
  },

  // Sessions
  session: {
    connect: (req: SessionConnectRequest) =>
      invoke<SessionInfo>(IPC.session.connect, req),
    disconnect: (req: SessionDisconnectRequest) =>
      invoke<OkResult>(IPC.session.disconnect, req),
    list: () => invoke<SessionInfo[]>(IPC.session.list),
  },

  // Remote FS
  remote: {
    list: (req: RemoteListRequest) =>
      invoke<DirListing>(IPC.remote.list, req),
    mkdir: (req: RemoteMkdirRequest) =>
      invoke<OkResult>(IPC.remote.mkdir, req),
    rename: (req: RemoteRenameRequest) =>
      invoke<OkResult>(IPC.remote.rename, req),
    delete: (req: RemoteDeleteRequest) =>
      invoke<OkResult>(IPC.remote.delete, req),
    readFile: (req: RemoteReadFileRequest) =>
      invoke<ReadFileResult>(IPC.remote.readFile, req),
    search: (req: RemoteSearchRequest) =>
      invoke<RemoteSearchResult>(IPC.remote.search, req),
  },

  // Local FS
  local: {
    list: (req?: LocalListRequest) =>
      invoke<DirListing>(IPC.local.list, req),
    roots: () => invoke<LocalRoots>(IPC.local.roots),
    mkdir: (req: LocalMkdirRequest) =>
      invoke<OkResult>(IPC.local.mkdir, req),
    rename: (req: LocalRenameRequest) =>
      invoke<OkResult>(IPC.local.rename, req),
    delete: (req: LocalDeleteRequest) =>
      invoke<OkResult>(IPC.local.delete, req),
    readFile: (req: LocalReadFileRequest) =>
      invoke<ReadFileResult>(IPC.local.readFile, req),
  },

  // Remote edit round-trip
  edit: {
    open: (req: EditOpenRequest) => invoke<OkResult>(IPC.edit.open, req),
    quickSave: (req: EditQuickSaveRequest) => invoke<OkResult>(IPC.edit.quickSave, req),
    onSaved: (handler: (payload: EditSavedEvent) => void) =>
      on<EditSavedEvent>(IPC.edit.saved, handler),
    onError: (handler: (payload: EditErrorEvent) => void) =>
      on<EditErrorEvent>(IPC.edit.error, handler),
  },

  // Remote places: bookmarks + recent locations (per connection profile)
  remotePlaces: {
    listBookmarks: (req: RemotePlacesListRequest) =>
      invoke<RemotePlacesBookmarksResult>(IPC.remotePlaces.listBookmarks, req),
    addBookmark: (req: RemotePlacesAddBookmarkRequest) =>
      invoke<RemotePlacesBookmarksResult>(IPC.remotePlaces.addBookmark, req),
    removeBookmark: (req: RemotePlacesRemoveBookmarkRequest) =>
      invoke<RemotePlacesBookmarksResult>(IPC.remotePlaces.removeBookmark, req),
    listRecents: (req: RemotePlacesListRequest) =>
      invoke<RemotePlacesRecentsResult>(IPC.remotePlaces.listRecents, req),
    recordVisit: (req: RemotePlacesRecordVisitRequest) =>
      invoke<OkResult>(IPC.remotePlaces.recordVisit, req),
  },

  // Transfers
  transfer: {
    upload: (req: TransferUploadRequest) =>
      invoke<TransferStartResult>(IPC.transfer.upload, req),
    download: (req: TransferDownloadRequest) =>
      invoke<TransferStartResult>(IPC.transfer.download, req),
    cancel: (req: TransferCancelRequest) =>
      invoke<OkResult>(IPC.transfer.cancel, req),
    onProgress: (handler: (payload: TransferProgressEvent) => void) =>
      on<TransferProgressEvent>(IPC.transfer.progress, handler),
    onDone: (handler: (payload: TransferDoneEvent) => void) =>
      on<TransferDoneEvent>(IPC.transfer.done, handler),
    onError: (handler: (payload: TransferErrorEvent) => void) =>
      on<TransferErrorEvent>(IPC.transfer.error, handler),
    onQueued: (handler: (payload: TransferItem) => void) =>
      on<TransferItem>(IPC.transfer.queued, handler),
  },

  // Directory sync
  sync: {
    plan: (req: SyncPlanRequest) => invoke<SyncPlanResult>(IPC.sync.plan, req),
    execute: (req: SyncExecuteRequest) => invoke<SyncExecuteResult>(IPC.sync.execute, req),
    onProgress: (handler: (payload: SyncProgressEvent) => void) =>
      on<SyncProgressEvent>(IPC.sync.progress, handler),
  },

  // Terminal
  terminal: {
    open: (req: TerminalOpenRequest) =>
      invoke<TerminalOpenResult>(IPC.terminal.open, req),
    resize: (req: TerminalResizeRequest) =>
      invoke<OkResult>(IPC.terminal.resize, req),
    close: (req: TerminalCloseRequest) =>
      invoke<OkResult>(IPC.terminal.close, req),
    send: (payload: TerminalInputEvent) =>
      window.nexusAPI.ipc.send(IPC.terminal.input, payload),
    onData: (handler: (payload: TerminalDataEvent) => void) =>
      on<TerminalDataEvent>(IPC.terminal.data, handler),
    onExit: (handler: (payload: TerminalExitEvent) => void) =>
      on<TerminalExitEvent>(IPC.terminal.exit, handler),
  },

  // Remote Desktop (rdp) — no pixel data crosses IPC, see ipc-contract.ts
  display: {
    connect: (req: DisplayConnectRequest) => invoke<OkResult>(IPC.display.connect, req),
    resize: (req: DisplayResizeRequest) => invoke<OkResult>(IPC.display.resize, req),
    disconnect: (req: DisplayDisconnectRequest) => invoke<OkResult>(IPC.display.disconnect, req),
    onStatus: (handler: (payload: DisplayStatusEvent) => void) =>
      on<DisplayStatusEvent>(IPC.display.status, handler),
  },

  // Port forwards (local/remote — dynamic/SOCKS not implemented yet)
  portForward: {
    start: (req: PortForwardStartRequest) => invoke<PortForwardRule>(IPC.portForward.start, req),
    stop: (req: PortForwardStopRequest) => invoke<OkResult>(IPC.portForward.stop, req),
    list: (req: PortForwardListRequest) => invoke<PortForwardRule[]>(IPC.portForward.list, req),
    onUpdate: (handler: (payload: PortForwardUpdateEvent) => void) =>
      on<PortForwardUpdateEvent>(IPC.portForward.update, handler),
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

  // App-level settings (currently: opt-in AI terminal suggestions)
  settings: {
    getAiSuggestConfig: () => invoke<AiSuggestConfig>(IPC.settings.getAiSuggestConfig),
    setAiSuggestConfig: (config: AiSuggestConfigInput) =>
      invoke<AiSuggestConfig>(IPC.settings.setAiSuggestConfig, { config }),
  },

  // AI terminal suggestions — completion call. Not yet invoked from anywhere
  // in the renderer; see report notes on the deferred terminal-side trigger.
  ai: {
    suggest: (req: AiSuggestRequest) => invoke<AiSuggestResult>(IPC.ai.suggest, req),
  },
} as const;
