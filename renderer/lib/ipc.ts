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
  type TerminalDataEvent,
  type TerminalExitEvent,
  type DisplayConnectRequest,
  type DisplayResizeRequest,
  type DisplayDisconnectRequest,
  type DisplayStatusEvent,
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
    onSaved: (handler: (payload: EditSavedEvent) => void) =>
      on<EditSavedEvent>(IPC.edit.saved, handler),
    onError: (handler: (payload: EditErrorEvent) => void) =>
      on<EditErrorEvent>(IPC.edit.error, handler),
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
} as const;
