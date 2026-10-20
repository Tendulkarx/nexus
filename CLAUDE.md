# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Nexus is a macOS Electron app: an SFTP/FTP(S) + SSH client with an optional native RDP remote-desktop
viewer, built on real Electron end to end.

## Commands

```
npm run dev            # electron-vite dev — launches the app with HMR
npm run build           # electron-vite build (main + preload + renderer)
npm run build:mac       # build + electron-builder --mac (dmg/zip)
npm run build:native    # builds the native RDP addon (see below) — optional, app works without it
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
  - `vnc` → `VncSession` (kind "display"; see "VNC (noVNC)" below)
  - `rdp` → `DisplaySession` (drives the native addon; doesn't open a connection until the renderer's
    Remote Desktop tab actually mounts and reports its bounds via `display:connect`)
  - no profile → `LocalShellSession` via `sessionManager.openLocal()` (`session:openLocal`; `SessionInfo.protocol`
    `"local"`, kind `"terminal"`): the user's login shell in a real pty from `node-pty`, loaded lazily. Its macOS
    prebuilds ship `spawn-helper` without the execute bit, so `postinstall` runs
    `build/fix-node-pty-permissions.cjs`; without it every spawn fails with "posix_spawnp failed.". node-pty uses
    N-API, so the same binary loads in Electron and in vitest — no electron-rebuild step.
    `postinstall` also runs `build/name-dev-electron.cjs`, which renames the dev `Electron.app` bundle to Nexus
    (macOS takes the app-menu title from the bundle's Info.plist, not `app.name`).
  - `mosh` → `MoshSession` (terminal-only, no filesystem; each terminal tab SSHes in to bootstrap
    `mosh-server` — reusing `sessions/ssh-connect.ts`'s host-key/jump-host helpers, shared with `SshSession`
    — then runs the local `mosh-client` in a node-pty pty (`PtyChannel`), which it needs for raw mode. No OSC 7
    hook: mosh drops OSC sequences, so the hook's ready marker would never arrive)
  - `telnet` → `TelnetSession` (terminal-only; Nexus's own client over `net`, protocol in `telnet-protocol.ts`,
    pure + tested; auto-answers the first login/password prompts from the profile)
  - `serial` → `SerialSession` (terminal-only; `host` is the `/dev/cu.*` device and `port` the baud rate, 8N1.
    No native module: the device is opened O_NONBLOCK, configured by `stty` with that fd as stdin — macOS resets
    a port's termios when its last fd closes — read via `tty.ReadStream`, written via a second blocking fd.
    `telnet-serial.integration.test.ts` drives it through a node-pty slave device)
  - An `ssh` profile whose server refuses the SFTP subsystem still connects, as kind `"terminal"` (SshSession
    calls ssh2-sftp-client's `getConnection()` and `getSftpChannel()` separately); an `sftp` profile fails.
  - `SshSession`/`FtpSession` extend `main/services/sessions/base-session.ts`'s `BaseSession` (file-oriented:
    list/mkdir/rename/delete/upload/download/readFile/putFile/close). `DisplaySession`/`MoshSession` do not —
    they're a different capability each (no filesystem), so `sessionManager.get()` throws if you try to use
    either as a filesystem session, and `sessionManager.getDisplay()`/`getSsh()`/`getTerminal()` are the typed
    accessors for the other cases (`getTerminal()` accepts either `SshSession` or `MoshSession` — both expose
    the same `openShell()`-shaped `TerminalChannel`, see `sessions/terminal-channel.ts`, and `terminalService`
    is the one thing that dispatches to it generically). When adding code that touches "the current session,"
    check which accessor you need.
- X11 forwarding (`main/services/x11.ts`, profile `x11Forward`, ssh/sftp only): like `ssh -Y` — the remote side
  gets XQuartz's real cookie and `attachX11Forwarding()` pipes each X11 channel to the local display, found
  via DISPLAY, `launchctl getenv DISPLAY`, or XQuartz's launchd socket in /private/tmp. No XQuartz → the
  session connects without X11 and logs why. New profile fields must be added to the allow-list in
  `main/handlers/connections.ts`, inline profiles in `session-manager.ts` and the sync mapping in
  `connection-sync-service.ts`, or they are silently dropped.
- Secrets: `main/services/credential-vault.ts` encrypts connection passwords/passphrases with Electron's
  `safeStorage` before `main/services/connection-store.ts` persists them to disk via `data-store.ts` (a
  generic cached-JSON store under `app.getPath("userData")` — never inside the repo). Renderer-facing
  `ConnectionProfileDTO` strips the `secret` field entirely and replaces it with a `hasSecret` boolean;
  the raw `ConnectionProfile` (with `secret`) never crosses the IPC boundary to the renderer.

### Native display addon (RDP)

`native/nexus-display-host/` is a separate Node native addon (node-gyp/node-addon-api, Objective-C++,
macOS-only) that embeds a live RDP session as a child `NSView` composited directly into the Electron
window — not a web canvas or separate window. `main/services/native-display-host.ts` loads the compiled
`.node` binary lazily; every other feature (SFTP/FTP/SSH, terminal, transfers) works with zero dependency on
this addon — only connecting to an `rdp` profile touches it. See `native/nexus-display-host/README.md`
for build prerequisites (`freerdp`/`pkg-config`) and current status: RDP is build- and connect-verified
against xrdp and Windows. VNC is not in the addon (its only C library, libvncclient, is GPL) — read the
README's "Dependency licensing" section before adding any display dependency.

### VNC (noVNC)

VNC runs in the renderer on noVNC (`@novnc/novnc`, MPL-2.0: per-file copyleft, fine to ship unmodified with
its licence notice; don't patch its files). `renderer/workspace/remote-desktop/vnc-channel.ts` is a
WebSocket-shaped object that noVNC attaches to, carrying bytes over IPC (`vnc:*`) to a TCP stream main opens
in `VncSession.openStream()` — directly or through the profile's SSH jump host, so no websockify. It buffers
data that arrives before `vnc:open` returns its channelId (the server speaks first). **Exception to the
secrets rule:** noVNC authenticates client-side, so `vnc:credentials` releases a VNC session's saved password
to the renderer when the server asks. `scripts/fake-vnc-server.mjs` is an RFB 3.8 test server
(`node scripts/fake-vnc-server.mjs --port 5901`). noVNC uses top-level await, hence `optimizeDeps.esbuildOptions.target`
in `electron.vite.config.ts`. `main/handlers/connections.ts` validates protocols against a `Record<Protocol, true>`,
so a new protocol fails type-checking until it's accepted there.

### Renderer structure

- `renderer/main/router.tsx` — TanStack Router with in-memory history (this is a desktop app, not a URL-
  driven web app) and a single root route rendering `AppShell`.
- `renderer/main/app-shell.tsx` + `renderer/main/shell/` — the window frame: title bar (palette search, New
  session), icon rail picking a sidebar view (Sessions, Files, Tunnels, Tools, Servers), session tab strip and
  status bar. `ConnectionManagerView` stays mounted behind the "Connections" tab because it owns the
  new-connection and connect flows; the Sessions sidebar asks it to connect via `CONNECT_PROFILE_EVENT`
  (`lib/menu-events.ts`). Everything below the title bar renders with `TrafficLightInsetContext` false, so
  `Sidebar`/`Toolbar` drop their `pl-20` traffic-light padding there.
- Local servers (Servers sidebar, `main/services/servers/`): HTTP (read-only), TFTP, SFTP (on `ssh2`'s
  `Server`; host key kept in userData) and iperf3 (the user's own binary). Every client path goes through
  `path-safety.ts` (`resolveExisting`/`resolveForWrite`, which also reject symlinks leading out of the share);
  keep it that way for any new server. Writes are off unless `allowWrites`. `servers.integration.test.ts`
  exercises each server over real sockets. Import `ssh2` as a default import where you need `Server` —
  Node can't detect it as a named CommonJS export, and the app then fails at startup (tests don't catch it).
- Tools (`renderer/tools/`) open as tabs in the same open-tabs store as sessions, under ids like
  `tool:port-scanner` (`tool-tabs.ts` — `parseToolTab()` tells them apart; anything that treats every tab
  as a session must check it first). Port and network scans run in `main/services/tools/scan-service.ts`,
  which starts each scan on the next tick so the renderer has the scanId before any `tools:*:progress` or
  `tools:scan:done` event; renderer side, `use-scan.ts` filters events by that id. The network scanner
  shells out to `/sbin/ping` (raw ICMP needs root) and also counts a refused TCP connect as "host up".
- Homebrew tool (`main/services/tools/homebrew.ts`, `renderer/tools/homebrew-tool.tsx`): runs the user's `brew` from
  /opt/homebrew or /usr/local (Finder-launched apps have no Homebrew on PATH) via execFile/spawn, never a shell;
  names must match `BREW_NAME` so they can't become options. Jobs stream `tools:brew:output` and end with one
  `tools:brew:done`. Tests run jobs against a stand-in script through the `locate` constructor argument.
- Cron tool (`renderer/tools/cron-tool.tsx`, `shared/crontab.ts`, `main/services/tools/cron-service.ts`): parsing,
  descriptions and next runs are pure and tested; lines that aren't jobs round-trip byte for byte, and a job is
  switched off by commenting it out. Main only moves text: `crontab -l` / install, on this Mac or via
  `SshSession.exec` (which takes stdin). Saves send the text that was loaded and are refused if the crontab changed
  since. Over SSH, `remoteInstallCommand()` writes to a temp file and installs only if the byte count matches —
  `crontab -` would otherwise install a cut-off file when a connection drops mid-save. Tests never touch a real
  crontab (a `CronRunner` fake, and a stand-in `crontab` script on PATH).
- File sessions are terminal-first: `WorkspaceView` switches the tab between `TerminalTabs` and
  `DualPaneView` (SSH profiles open on Terminal, SFTP/FTP on Files; both stay mounted once shown). The
  Files sidebar is a portal target (`lib/files-sidebar-slot.ts`): each file session's `WorkspaceView`
  portals a `RemoteFilesPanel` into it, so sidebar transfers use that workspace's `useTransfers` queue.
  The shell's `<aside>` is hidden, never unmounted, when collapsed so those portals keep their state. Port
  forwards live in the Tunnels sidebar; only a popped-out session window keeps the in-tab forwards panel.
- Terminal split panes: each `TerminalTabs` tab holds a `TabLayout` (`workspace/terminal/terminal-layout.ts`,
  pure + tested): a row or column of up to 4 panes, one direction per tab. File › Split Right/Down (⌘D/⇧⌘D)
  arrive as `SPLIT_TERMINAL_EVENT` and only the visible TerminalTabs of the active session tab acts on it.
- Terminal shell hook: `terminalService.open()` types `shell-integration.ts`'s one-line OSC 7 hook into each new
  SSH shell and holds the terminal's output until the hook prints its marker; `stripInjectedEcho()` then drops the
  echoed hook (tty echo plus line-editor echo) so the user only sees their banner and a fresh prompt. Shells that
  can't run it are released after 3 s. Connect failures go through `lib/connect-error.ts` into a toast that stays.
- Connection-state dots (`lib/session-status.ts`, `main/shell/session-dot.tsx`): no entry means connected; main
  emits `session:disconnected` from session-manager's unexpected-disconnect path, RDP reports via `display:status`,
  VNC from `vnc-pane.tsx`. The workspace header shows a Reconnect banner on disconnect. The title-bar Multi-exec
  switch drives every live terminal through `terminal-broadcast-store.ts` (terminals register/unregister there).
- Form labels: `Field` in `lib/ui/layout.tsx` provides an id through `lib/ui/field-context.ts`; `Input` and
  `SelectTrigger` pick it up, so a `Field label="Host"` is a real `<label for>` (tests can use getByRole name).
- Preferences (Settings window: Terminal, Highlighting, Sessions, Files, Remote Desktop, Keyboard Shortcuts) live in
  `renderer/shared/preferences.ts`: types, defaults and `normalizePreferences()`, which every read and every
  patch passes through (tested). Main stores them in `app-settings.json` via `appSettingsStore` and broadcasts
  `preferences:changed` to every window; renderer code reads them with `usePreferences()` /
  `getPreferences()` from `lib/preferences.ts`. To add one: extend the type, default and normalizer, then the
  section in `renderer/settings/preference-sections.tsx`.
- Highlight rules (Settings › Highlighting, `preferences.highlight`): `workspace/terminal/highlighter.ts` matches each
  finished logical line against the rules and colours matches with xterm decorations (needs `allowProposedApi`), so
  the byte stream is untouched; the alternate screen is skipped. Patterns are case-insensitive regexes, validated by
  `isUsablePattern()`.
- Keyboard shortcuts (`preferences.shortcuts`, `shared/shortcuts.ts`): stored as Electron accelerators. Main builds
  the app menu from them and rebuilds it via `appSettingsStore.onPreferencesChanged`; the palette shortcut is matched
  in the renderer with `eventMatches()`. Show a shortcut with `formatAccelerator()`, never a hard-coded "⌘K".
- Macros (`shared/macros.ts`): a terminal's ● button records its input into a `MacroRecorder` (keystrokes under
  150 ms apart merge into one step; longer pauses are kept, capped at 5 s) and saves it as a `CommandSnippet` with
  `macro` steps. The snippet list replays it with `playMacro()` through the multi-exec targets, like typing.
- CI/CD (`.github/workflows/`, `docs/releasing.md`): `ci.yml` runs type-check, lint, test and build on Linux;
  `pr-title.yml` requires Conventional Commit PR titles (squash merges make them the commit messages);
  `release.yml` runs release-please (version, CHANGELOG.md, release PR) and, when a release PR merges, packages
  arm64 on macOS (RDP add-on included) and uploads the DMG to the release (plus the updater's zip, blockmaps and latest-mac.yml once signing secrets exist). Don't
  edit `version` in package.json or CHANGELOG.md by hand; release-please owns them. Signing switches on from
  repo secrets (see docs/releasing.md). Tests must pass on Linux too: keep macOS-only paths out of them.
- Packaging: `npx electron-vite build && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir` makes
  an unsigned `dist/mac-arm64/Nexus.app` for local testing. electron-builder unpacks and rebuilds node-pty itself
  (spawn-helper stays executable). Run it with `--user-data-dir=<scratch>` so it doesn't touch real data.
  `build.publish` points at Tendulkarx/nexus; auto-update also needs a signed app and a repo the updater can read (it's private).
- Terminals are always dark: `.terminal-surface` in `styles.css` re-seeds the theme variables for that
  subtree, and `workspace/terminal/terminal-theme.ts` holds the matching ob_dark xterm palette (its
  ANSI white is red-orange on purpose; keep `drawBoldTextInBrightColors: false`).
- `renderer/workspace/` — the main-window UI: dual-pane file browser (`files/`), SSH terminal (`terminal/`,
  built on `@xterm/xterm`), transfer queue (`transfer-queue/`), and the remote-desktop viewer
  (`remote-desktop/`) that hosts the native addon's view.
- `renderer/connection-manager/` — the connection-profile list/editor UI. `connection-form.tsx` is the New
  Session dialog: a protocol picker, with fields shown only where that protocol uses them (`SSH_BASED`,
  `HAS_FILES`), and "Save & connect" for new profiles. `session-import-dialog.tsx` imports from a
  sessions.ini / .mxtsessions via `main/services/session-ini-parser.ts`: the number after the icon is the
  session type, and only the documented codes (SSH 0, RDP 4, VNC 5, SFTP 7) are mapped — don't guess others.
- `renderer/lib/ipc.ts` — typed wrapper around `nexusAPI.ipc.invoke`, used everywhere instead of
  calling `nexusAPI` directly, keyed against `ipc-contract.ts` types.
- `renderer/lib/ui/` — shared primitives built on Radix UI (`radix-ui` package) + `class-variance-authority`
  + Tailwind v4 (via `@tailwindcss/vite`).
- State: TanStack Query (`QueryClient` from the router context) for server/IPC-backed data;
  `renderer/lib/open-sessions-store.ts` / `sessions.ts` for open-connection/tab state.

### Directories to ignore

`_to_delete/` at the repo root is leftover scratch/archive material (old tarballs, an unused `home-view.tsx`)
staged for removal — don't treat it as part of the active source tree.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created when terms or decisions are first settled. See `docs/agents/domain.md`.
