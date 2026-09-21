# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Nexus is a macOS Electron app: an SFTP/FTP(S) + SSH client with an optional native VNC/RDP remote-desktop
viewer, built on real Electron end to end.

## Commands

```
npm run dev            # electron-vite dev — launches the app with HMR
npm run build           # electron-vite build (main + preload + renderer)
npm run build:mac       # build + electron-builder --mac (dmg/zip)
npm run build:native    # builds the native VNC/RDP addon (see below) — optional, app works without it
npm run type-check      # tsc --noEmit against both tsconfig.node.json and tsconfig.web.json
npm run lint            # eslint .
npm run format          # prettier --write .
npm run test            # vitest run — main/ unit tests only (see below)
```

Test coverage is minimal and currently limited to `main/services/*.test.ts` (credential-vault, session-manager),
run via vitest (`vitest.config.ts` at the repo root). There is no renderer or integration test setup yet —
when adding tests for renderer code, a browser-like environment (e.g. jsdom) will need to be configured
separately from this node-environment config.

Always run `npm run type-check` (this project has two separate tsconfig projects — node-side `main/` and
web-side `renderer/` — both must pass), `npm run lint`, and `npm run test` after making changes.

## Architecture

### Process split

- `main/` — Electron main process, Node/TypeScript, built by electron-vite as CJS-free ESM (`"type":
  "module"` in package.json — watch for the electron-updater default-export workaround in `main/index.ts`
  when importing other CJS-only packages).
- `renderer/` — React 19 UI, loaded into two BrowserWindows: `main-window.html` (the primary app) and
  `settings-window.html` (see `main/windows/settings-window.ts`).
- `renderer/preload.ts` — the **only** file allowed to import `"electron"` on the renderer side. It exposes
  a single `window.nexusAPI` object via `contextBridge`. Renderer code never talks to `ipcRenderer` directly
  — it calls `nexusAPI.ipc.invoke/send/on` (thin wrappers) or the small set of native-bridge namespaces
  (`dialog`, `nativeTheme`, `Menu`, `webUtils`).
- `renderer/shared/ipc-contract.ts` — the single source of truth for every IPC channel's request/response
  shape, imported as types-only from both `main/` and `renderer/`. **When adding or changing an IPC channel,
  update this file first**, then the handler in `main/handlers/`, then the renderer caller.
- Path aliases (defined in `electron.vite.config.ts` and mirrored in tsconfig): `@shared` →
  `renderer/shared`, `@renderer` → `renderer`, `@main` → `main`.

### Main process: handlers → services → sessions

- `main/handlers/*.ts` register `ipcMain.handle`/`.on` listeners (one file per feature area: connections,
  sessions, filesystem, transfers, terminal, edit, display). `main/handlers/index.ts` is the single place
  that wires all of them up, called once from `main/index.ts`.
- `main/index.ts` also registers a small set of "native bridge" handlers (dialog, shell, nativeTheme, Menu
  popup) directly — Electron has no built-in bridge for these, so they're hand-rolled to match what
  `preload.ts`/the renderer already expect.
- `main/services/` holds the actual logic, mostly singletons exported at module scope (e.g. `sessionManager`,
  `credentialVault`, `transferManager`, `editManager`, `terminalService`). Handlers stay thin and delegate
  to these.
- `main/services/session-manager.ts` owns every live remote connection, keyed by a generated `sessionId`. It
  dispatches to a protocol-specific session class based on `ConnectionProfile.protocol`:
  - `sftp`/`ssh` → `SshSession` (wraps `ssh2` + `ssh2-sftp-client`)
  - `ftp`/`ftps` → `FtpSession` (wraps `basic-ftp`)
  - `rdp`/`vnc` → `DisplaySession` (drives the native addon; doesn't open a connection until the renderer's
    Remote Desktop tab actually mounts and reports its bounds via `display:connect`)
  - `mosh` → `MoshSession` (terminal-only, no filesystem; each terminal tab SSHes in to bootstrap
    `mosh-server` — reusing `sessions/ssh-connect.ts`'s host-key/jump-host helpers, shared with `SshSession`
    — then spawns the local `mosh-client` binary; see that file's doc comment for the known tty limitation)
  - `SshSession`/`FtpSession` extend `main/services/sessions/base-session.ts`'s `BaseSession` (file-oriented:
    list/mkdir/rename/delete/upload/download/readFile/putFile/close). `DisplaySession`/`MoshSession` do not —
    they're a different capability each (no filesystem), so `sessionManager.get()` throws if you try to use
    either as a filesystem session, and `sessionManager.getDisplay()`/`getSsh()`/`getTerminal()` are the typed
    accessors for the other cases (`getTerminal()` accepts either `SshSession` or `MoshSession` — both expose
    the same `openShell()`-shaped `TerminalChannel`, see `sessions/terminal-channel.ts`, and `terminalService`
    is the one thing that dispatches to it generically). When adding code that touches "the current session,"
    check which accessor you need.
- Secrets: `main/services/credential-vault.ts` encrypts connection passwords/passphrases with Electron's
  `safeStorage` before `main/services/connection-store.ts` persists them to disk via `data-store.ts` (a
  generic cached-JSON store under `app.getPath("userData")` — never inside the repo). Renderer-facing
  `ConnectionProfileDTO` strips the `secret` field entirely and replaces it with a `hasSecret` boolean;
  the raw `ConnectionProfile` (with `secret`) never crosses the IPC boundary to the renderer.

### Native display addon (VNC/RDP)

`native/nexus-display-host/` is a separate Node native addon (node-gyp/node-addon-api, Objective-C++,
macOS-only) that embeds a live VNC/RDP session as a child `NSView` composited directly into the Electron
window — not a web canvas or separate window. `main/services/native-display-host.ts` loads the compiled
`.node` binary lazily; every other feature (SFTP/FTP/SSH, terminal, transfers) works with zero dependency on
this addon — only connecting to an `rdp`/`vnc` profile touches it. See `native/nexus-display-host/README.md`
for build prerequisites (`libvncserver`, `freerdp`/`pkg-config`) and current status: VNC is build-verified,
RDP is source-only and not yet build-verified. Input mapping, resize, and HiDPI handling are all
known-incomplete there — check that README before extending display-session behavior.

### Renderer structure

- `renderer/main/router.tsx` — TanStack Router with in-memory history (this is a desktop app, not a URL-
  driven web app) and a single root route rendering `AppShell`.
- `renderer/workspace/` — the main-window UI: dual-pane file browser (`files/`), SSH terminal (`terminal/`,
  built on `@xterm/xterm`), transfer queue (`transfer-queue/`), and the remote-desktop viewer
  (`remote-desktop/`) that hosts the native addon's view.
- `renderer/connection-manager/` — the connection-profile list/editor UI.
- `renderer/lib/ipc.ts` — typed wrapper around `nexusAPI.ipc.invoke`, used everywhere instead of
  calling `nexusAPI` directly, keyed against `ipc-contract.ts` types.
- `renderer/lib/ui/` — shared primitives built on Radix UI (`radix-ui` package) + `class-variance-authority`
  + Tailwind v4 (via `@tailwindcss/vite`).
- State: TanStack Query (`QueryClient` from the router context) for server/IPC-backed data;
  `renderer/lib/open-sessions-store.ts` / `sessions.ts` for open-connection/tab state.

### Directories to ignore

`_to_delete/` at the repo root is leftover scratch/archive material (old tarballs, an unused `home-view.tsx`)
staged for removal — don't treat it as part of the active source tree.
