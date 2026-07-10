# Nexus — Modern SFTP/FTP + SSH Client

## Context

The user wants a modern, pleasing alternative to FileZilla with better SSH connection
management, plus Tabbed handling of multiple connection types. Remote Desktop
(RDP/VNC) is not feasible to do well in this environment for a first version and is
explicitly deferred.

**v1 scope (confirmed with user):**
1. File transfer over **SFTP + FTP/FTPS** — modern dual-pane browser (local ↔ remote),
   drag-drop, transfer queue with progress, mkdir/rename/delete/navigate.
2. **SSH connection manager** — saved profiles in folders/tags, quick-connect,
   password or SSH-key auth, secrets encrypted with `safeStorage`.
3. **Integrated SSH terminal** — real interactive shell (xterm.js) streamed over IPC.

**Style:** colorful & modern (accent colors, rounded cards, vibrant but clean).
**Deferred:** Remote Desktop / VNC.

Starting point is the fresh Glaze template (no PROJECT-CONTEXT.md yet).

## Architecture

- **Backend (`main/`)** owns all network/protocol/OS work (real Node.js): SFTP (`ssh2` +
  `ssh2-sftp-client`), FTP/FTPS (`basic-ftp`), interactive SSH shell (`ssh2.Client.shell()`),
  local FS (`fs`), transfer streaming + progress, profile persistence + `safeStorage`
  encryption, and a session registry keyed by `sessionId` for concurrent connections.
- **Frontend (`renderer/`)** owns UI/state: connection manager, dual-pane transfer view,
  transfer-queue dock, terminal tabs. React Query for listings/CRUD; local state for the
  transfer queue and terminal tabs.
- **Delegation:** large full-stack app with a clean seam. Lock the IPC contract first
  (orchestrator), then delegate one large layer at a time — `glaze-backend-architect` for
  services/handlers, `glaze-frontend-architect` for the UI — foreground, one at a time.
  Orchestrator keeps `preload.ts`, `main/index.ts` window sizing, `package.json`, and all
  integration/verification.

## Data & storage

- Location: `app.getPath("userData")/connections.json` (NOT project path). Cached JSON via a
  generic `DataStore` (per `glaze-data-storage`): mkdir-recursive before write, default on miss.
- Profile shape: `{ id, name, protocol (sftp|ftp|ftps|ssh), host, port, username,
  authType (password|key), privateKeyPath?, folderId, tags[], defaultRemotePath, secret }`.
  `secret` (password OR key passphrase) is `safeStorage.encryptString` → base64, **never**
  returned to the renderer. DTOs drop `secret`, add `hasSecret`.
- Guard `safeStorage.isEncryptionAvailable()`; never log secret values.

## IPC contract

invoke = `ipcMain.handle` via `glaze.ipc.invoke`; event↓ = backend→renderer `webContents.send`
via `glaze.ipc.on`; event↑ = renderer→backend via `glaze.ipc.send` + `ipcMain.on`. The generic
invoke/on/send surface is already exposed in `preload.ts` — no per-channel preload wiring needed.

- **Connections (invoke):** `connections:list|get|create|update|delete|moveToFolder`,
  `folders:create|rename|delete`.
- **Sessions (invoke):** `session:connect {profileId?|inlineProfile?, secret?}` →
  `{sessionId, protocol, homeDir}`; `session:disconnect`; `session:list`.
- **Remote FS (invoke, carry sessionId):** `remote:list|mkdir|rename|delete`.
- **Local FS (invoke):** `local:list|mkdir|rename|delete|roots`.
- **Transfers:** invoke `transfer:upload|download|cancel` → `{transferId}`;
  event↓ `transfer:progress|done|error` keyed by `transferId`.
- **Terminal:** invoke `terminal:open {sessionId, cols, rows}` → `{terminalId}`,
  `terminal:resize`, `terminal:close`; event↑ `terminal:input {terminalId, data}`;
  event↓ `terminal:data {terminalId, chunk}`, `terminal:exit {terminalId, code}`.
- `FsEntry = { name, path, isDir, size, mtime, permissions?, symlink? }`.
- Terminal keystrokes and stream data use fire-and-forget events (not invoke) for latency;
  coalesce progress/data emits (~30–60ms) and send chunks as string/base64.

## Backend files (`main/`)

- `services/data-store.ts` — generic cached JSON store.
- `services/credential-vault.ts` — safeStorage encrypt/decrypt.
- `services/connection-store.ts` — profile/folder CRUD, secret-stripped DTOs.
- `services/session-manager.ts` — `Map<sessionId, Session>`; teardown on window-close /
  before-quit (`glaze-app-lifecycle`).
- `services/sftp-service.ts`, `services/ftp-service.ts`, `services/local-fs-service.ts`,
  `services/ssh-terminal-service.ts` (`Map<terminalId, ClientChannel>`).
- `handlers/` — new handler groups (connections, sessions, remote-fs, local-fs, transfers,
  terminal), registered in `handlers/index.ts`.

## Frontend files (`renderer/`)

- `main/router.tsx` (edit) — add `/` → ConnectionManagerView, `/workspace/$sessionId` →
  WorkspaceView (Files + Terminal tabs kept mounted).
- `connection-manager/connection-manager-view.tsx`, `connection-manager/connection-form.tsx`.
- `workspace/workspace-view.tsx`, `workspace/files/{dual-pane-view,file-pane,breadcrumbs}.tsx`,
  `workspace/terminal/{terminal-tabs,terminal-pane}.tsx`,
  `workspace/transfer-queue/transfer-queue-panel.tsx`.
- `lib/ipc.ts` (typed wrappers), `lib/use-{connections,remote-dir,local-dir,transfers,terminal}.ts`.
- Components: `SplitView`, `Toolbar`, list/table primitives, `Button`, `Input`, `Dialog`,
  `Status`, native context menus via `Menu.popup` (confirm APIs via glaze-component-docs-reader;
  follow glaze-component-patterns, glaze-theming, glaze-icon-usage).
- DnD (glaze-drag-and-drop): Finder→remote via `webUtils.getPathForFile` → `transfer:upload`;
  local↔remote in-app DnD enqueues transfers. App→Finder download via a Download action + save dialog.
- Terminal: `@xterm/xterm` + `@xterm/addon-fit`; open→fit→`terminal:open`; `onData`→`terminal:input`;
  `terminal:data`→`term.write`; ResizeObserver→fit→`terminal:resize`; dispose + `terminal:close` on unmount.

## Dependencies (`package.json`)

- Backend: `ssh2` (SSH transport + terminal shell), `ssh2-sftp-client` (SFTP ops + progress),
  `basic-ftp` (FTP/FTPS + progress). Dev: `@types/ssh2` if needed.
- Frontend: `@xterm/xterm`, `@xterm/addon-fit`.
- `ssh2` optional native crypto has a pure-JS fallback; build noise is ignorable.

## Window sizing (`main/index.ts`)

`windowWidth: 1200, windowHeight: 800, minWidth: 720, minHeight: 520` — fits two panes +
sidebar + transfer dock + terminal (per glaze-window-sizing). Keep `windowKey: "main"`.

## Build order

0. **Scaffold + contract:** add deps, set window size, stub services + handlers, register
   handler groups. Verify: type-check + lint pass, app launches.
1. **Connection manager e2e:** store + vault + `connections:*`; manager view + form + hooks.
   Verify: CRUD, `connections.json` has opaque `secret`, DTOs omit secrets.
2. **Connect + dual-pane listing:** session manager, SFTP/FTP/local services, `session/remote/local`
   handlers; workspace + dual pane + breadcrumbs + mkdir/rename/delete.
3. **Transfers + queue + DnD:** `transfer:*` with throttled events; queue dock; DnD.
4. **SSH terminal:** service + `terminal:*`; xterm tab with fit/resize/input; concurrent isolation.
5. **Polish + lifecycle:** theme, protocol icons, empty/error/loading states, teardown on quit.

## Verification

- Each phase: `npm run type-check && npm run lint`; build + launch for runtime.
- Protocol code tested against a **real** SFTP host and a **real** FTPS host (no mocks).
- DOM snapshot for state/text; preview capture only for the dense dual-pane/terminal layout.
- Confirm: live transfer progress + cancel on both protocols; interactive terminal resize +
  clean close; sessions/terminals torn down on quit; secrets never leave the backend.
- Update `.glaze_memory/PROJECT-CONTEXT.md` after completion.
