# nexus-display-host

Native macOS addon that embeds a live RDP session as a child `NSView`
composited directly inside Nexus's Electron window — not a web canvas, not a
separate window.

**Status: build- and connect-verified, including live resize.** Verified
end-to-end against a real xrdp server and a real Windows host: TLS/NLA
negotiation, license exchange, GDI framebuffer init, live frame delivery, and
clean teardown all confirmed working, plus live desktop-resize via the
"disp" (MS-RDPEDISP) dynamic virtual channel — verified against the Windows
host specifically (xrdp registers the channel listener but has never been
observed to actually open it, so resize silently never takes effect there;
that's the server's call, not a bug here). Real follow-up work remains (see
"Known gaps" below) — this means basic connectivity and live resize work,
not that the backend is feature-complete.

VNC support was removed. It worked (verified against macOS's own Screen
Sharing server), but its only library (`libvncclient`, via Homebrew's
`libvncserver`) is GPL-2.0-or-later with no drop-in permissively-licensed C
alternative, and RDP now covers the actual need — see "Dependency licensing"
below for why that mattered enough to drop it rather than ship it anyway.

## Dependency licensing — read before touching `binding.gyp`

FreeRDP itself is Apache-2.0, but **Homebrew's `freerdp` formula links
against FFmpeg, and that FFmpeg build is GPL-3.0-or-later** (it's compiled
with libx264/libx265). Bundling that combination into a distributed binary
would carry GPL copyleft obligations for the whole app. This addon therefore
does NOT use Homebrew's freerdp — it builds FreeRDP from source with FFmpeg
(and Opus, whose pkg-config include wiring is broken on this FreeRDP release
anyway, and which we don't need without audio redirection) disabled, via
`scripts/build-freerdp.sh`, installing into `vendor/freerdp/` (gitignored,
regenerated per machine). The resulting dependency set is fully permissive:
FreeRDP/WinPR (Apache-2.0), OpenSSL (Apache-2.0), and system
frameworks/zlib. `npm run build` calls this automatically the first time
(`scripts/ensure-freerdp.sh` skips it on subsequent builds); run
`npm run build:freerdp` to force a rebuild.

**Do not switch `binding.gyp` back to `pkg-config --cflags/--libs freerdp3
winpr3` (Homebrew's build)** without re-checking this — that's exactly the
GPL-tainted FFmpeg path this setup avoids.

## Prerequisites (macOS only)

```
xcode-select --install                    # Xcode Command Line Tools, for node-gyp/clang
brew install cmake ninja pkg-config       # build tools for vendoring FreeRDP from source
brew install openssl@3 uriparser jansson  # FreeRDP's own (permissively-licensed) dependencies
```

This addon doesn't depend on any Homebrew RDP/VNC package directly — see
"Dependency licensing" above. `npm run build` builds a vendored FreeRDP copy
from source automatically.

## Building

From the Nexus repo root:

```
npm run build:native
```

This runs `npm install && npm run build` inside this directory, which builds
`vendor/freerdp` (if not already present) and then runs `node-gyp rebuild`,
producing `build/Release/nexus_display_host.node`.
`main/services/native-display-host.ts` loads that compiled `.node` file lazily
— every other part of the app (SFTP/FTP/SSH, the terminal, transfers) works
completely normally whether or not this addon has been built; only connecting
to an `rdp` profile touches it.

## Architecture

- `src/addon.mm` — Node-API entry point (`createSession`/`resizeSession`/`destroySession`).
- `src/display_session.h/.mm` — owns the `NexusDisplayNSView` (a layer-backed
  `NSView` that draws whatever BGRA32 frame the backend hands it, and is made
  first responder so it receives real Cocoa mouse/keyboard events directly —
  no synthetic input relay from the renderer) and attaches it into the host
  `BrowserWindow`'s content view at the bounds the renderer reports.
- `src/rdp_backend.h/.mm` — wraps FreeRDP's client C API: connects, runs the
  connect + event loop on its own thread, calls back with decoded framebuffer
  updates + pointer/key event forwarding, and — since we build the `freerdp*`
  instance by hand rather than going through client-common's own
  `freerdp_client_context_new()` — explicitly does two things that function
  would otherwise do for us: registers the static virtual-channel lookup
  table (`freerdp_register_addin_provider`) and sets `instance->LoadChannels`,
  both needed for the "disp" (live resize) channel to load at all.
- `src/display_types.h` — the `FrameCallback`/`DisplayStatusCallback`
  typedefs shared between `display_session.mm` and the backend.

Electron's main process pumps Cocoa's run loop and Node's libuv loop on the
same OS thread, so `dispatch_async(dispatch_get_main_queue(), ...)` — used to
hop off the RDP backend's worker thread before touching AppKit or calling
back into JS — lands on the same thread Node/V8 is already running on. That's
why `addon.mm` calls back into JS directly rather than using a
`Napi::ThreadSafeFunction`.

## Known gaps / real follow-up work

- **Input mapping is minimal.** Mouse position/left-button and basic
  ASCII-range keyboard forward correctly; modifier keys (Cmd/Opt/Ctrl held
  down), scroll wheel, and non-ASCII keysyms are not mapped yet.
- **No HiDPI/Retina scaling pass** — frames are blitted 1:1; a Retina display
  showing a lower-resolution remote framebuffer will look soft. Real fix is
  scaling the CALayer's `contentsScale` deliberately rather than leaving it
  implicit.
- **Only the "disp"/"drdynvc" virtual channels are built** (see
  `scripts/build-freerdp.sh`'s explicit per-channel flags) — no clipboard
  redirection, drive/printer redirection, or audio. Every other
  `FreeRDP_Redirect*`/`FreeRDP_Audio*`/`FreeRDP_DeviceRedirection`-family
  setting is explicitly forced off in `NexusPreConnect` (`rdp_backend.mm`);
  leaving any of them on makes `freerdp_client_load_channels` try to load a
  channel this build doesn't have, which fails outright rather than no-oping
  (there's no loadable `.dylib` addin to fall back to — see "Dependency
  licensing"). Re-enabling one means adding it to that build script's channel
  list, ungating the matching setting(s) in `NexusPreConnect`, and (if it
  needs one) adding a real virtual-channel client implementation — the settings
  flag alone doesn't do anything.
- **Rendering is software GDI only** (`FreeRDP_SoftwareGdi`), not the
  GFX/H.264 pipeline — a deliberate tradeoff, since the H.264 path needs
  FFmpeg (see licensing note above). Fine for typical admin/remote-access use;
  noticeably worse than a hardware-accelerated client for video-heavy content
  over a slow link.
- **Auth is password-only.** NLA/TLS credentials work; smart-card and Azure
  AD auth don't — out of scope for now.
- **Server certificates are not verified** (`FreeRDP_IgnoreCertificate`) —
  no MITM protection on the RDP leg, unlike the SSH host-key verification
  Nexus already does elsewhere. See the comment in `NexusPreConnect`
  (`rdp_backend.mm`) for the plan to wire up a TOFU flow here.

## Testing once it builds

There's no built-in macOS RDP server, so the easiest local test target is a
throwaway Docker container:

```
docker run -d --name nexus-rdp-test -p 3390:3389 danielguerra/ubuntu-xrdp:latest
docker exec nexus-rdp-test bash -c "echo 'root:<a password>' | chpasswd"
```

Then add an "rdp" connection profile in Nexus pointed at `localhost:3390`
with user `root` and that password. Remove the container (`docker rm -f
nexus-rdp-test`) when done — it's for local testing only, not something to
leave running.
