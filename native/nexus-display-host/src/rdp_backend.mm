// RDP backend implementation. Uses FreeRDP's client integration pattern (the
// same one FreeRDP's own sample clients and third-party embedders like
// Remmina use — a custom rdpContext subclass, PreConnect/PostConnect/
// Authenticate hooks, gdi_init() + update->BeginPaint/EndPaint reading the
// GDI framebuffer, and a freerdp_get_event_handles/freerdp_check_event_handles
// pump loop). Build- and connect-verified against the vendored FreeRDP 3.31.1
// build (see scripts/build-freerdp.sh) — connects, negotiates TLS/NLA,
// exchanges the license, and delivers frames end-to-end against both a real
// xrdp server and a real Windows host. Live resize (RequestResize below) is
// verified working against the Windows host specifically — xrdp registers
// the "disp" channel's listener but has never been observed to actually open
// it in testing, so it silently never takes effect there (not a bug on our
// end: the channel connecting at all is purely up to the server).
#include "rdp_backend.h"

#include <freerdp/client.h>
#include <freerdp/client/channels.h>
#include <freerdp/client/disp.h>
#include <freerdp/event.h>
#include <freerdp/freerdp.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/settings.h>
#include <winpr/synch.h>

#include <algorithm>
#include <cmath>
#include <cstring>

namespace {

// FreeRDP's client pattern: embed the real rdpContext as the first member
// of a larger struct (instance->ContextSize = sizeof(NexusRdpContext)) so
// context callbacks — which only receive an rdpContext* — can reach our
// C++ callbacks via a reinterpret_cast back to this type.
struct NexusRdpContext {
  rdpContext parent;
  nexus::FrameCallback* onFrame;
  nexus::DisplayStatusCallback* onStatus;
  // Set once the "disp" (Display Control, MS-RDPEDISP) dynamic virtual
  // channel connects — see NexusChannelConnected. Null (and resize requests
  // silently no-op) if the server doesn't support it. freerdp_context_new
  // zero-initializes this struct, so this starts null without explicit init.
  DispClientContext* disp;
};

NexusRdpContext* Ctx(rdpContext* context) { return reinterpret_cast<NexusRdpContext*>(context); }

// FreeRDP raises ChannelConnected/Disconnected on instance->context->pubSub
// for every virtual channel as it comes up, passing the owning rdpContext*
// as `context` (matching how client/common/client.c's own handler for other
// channels works) — this is how a non-xfreerdp/SDL client (us) gets handed
// the DispClientContext* for the "disp" channel once it's negotiated, since
// nothing surfaces it any more directly than that.
void NexusChannelConnected(void* context, const ChannelConnectedEventArgs* e) {
  if (strcmp(e->name, DISP_DVC_CHANNEL_NAME) != 0) return;
  Ctx(reinterpret_cast<rdpContext*>(context))->disp = reinterpret_cast<DispClientContext*>(e->pInterface);
}

void NexusChannelDisconnected(void* context, const ChannelDisconnectedEventArgs* e) {
  if (strcmp(e->name, DISP_DVC_CHANNEL_NAME) != 0) return;
  Ctx(reinterpret_cast<rdpContext*>(context))->disp = nullptr;
}

BOOL NexusPreConnect(freerdp* instance) {
  rdpSettings* settings = instance->context->settings;
  // Software GDI rendering (no H.264/RemoteFX hardware decode path) — the
  // simplest correct starting point; codec negotiation for better
  // performance over slow links is real follow-up work (see the plan).
  freerdp_settings_set_bool(settings, FreeRDP_SoftwareGdi, TRUE);
  freerdp_settings_set_uint32(settings, FreeRDP_ColorDepth, 32);
  freerdp_settings_set_bool(settings, FreeRDP_SupportDisplayControl, TRUE);
  // FreeRDP_DeviceRedirection (and friends) default to TRUE, which makes
  // freerdp_client_load_channels (below) try to load "rdpdr" — a channel
  // this build deliberately doesn't have (see scripts/build-freerdp.sh's
  // channel list). Since we don't build loadable channel-plugin .dylibs at
  // all (every enabled channel is linked statically into libfreerdp-client),
  // its dlopen fallback can't find one either, and the whole pre-connect
  // phase fails outright — not just a missing-feature no-op. Explicitly
  // disable every optional feature this build doesn't carry.
  freerdp_settings_set_bool(settings, FreeRDP_DeviceRedirection, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_RedirectDrives, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_RedirectHomeDrive, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_RedirectSerialPorts, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_RedirectSmartCards, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_RedirectPrinters, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_AudioPlayback, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_AudioCapture, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_SupportGraphicsPipeline, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_MultiTouchInput, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_RemoteApplicationMode, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_RedirectClipboard, FALSE);
  // These RDP8+ connection-resilience features force DeviceRedirection back
  // to TRUE inside freerdp_client_load_addins (rdpsnd/tsmf/these all
  // "require rdpdr to be registered") if left at their default — undoing
  // the FreeRDP_DeviceRedirection=FALSE above and reintroducing the same
  // missing-rdpdr failure.
  freerdp_settings_set_bool(settings, FreeRDP_NetworkAutoDetect, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_SupportHeartbeatPdu, FALSE);
  freerdp_settings_set_bool(settings, FreeRDP_SupportMultitransport, FALSE);
  // Accept the server's certificate without prompting. This is a real
  // security tradeoff (no MITM protection on the RDP leg, unlike the SSH
  // host-key verification Nexus already does) — worth revisiting once basic
  // connectivity is proven, by wiring instance->VerifyCertificateEx to a
  // TOFU flow analogous to main/services/known-hosts-store.ts.
  freerdp_settings_set_bool(settings, FreeRDP_IgnoreCertificate, TRUE);
  return TRUE;
}

BOOL NexusBeginPaint(rdpContext* /*context*/) { return TRUE; }

BOOL NexusEndPaint(rdpContext* context) {
  auto* ctx = Ctx(context);
  if (!context->gdi || !context->gdi->primary_buffer || !ctx->onFrame || !*ctx->onFrame) return TRUE;
  (*ctx->onFrame)(reinterpret_cast<const uint8_t*>(context->gdi->primary_buffer), context->gdi->width,
                  context->gdi->height);
  return TRUE;
}

BOOL NexusDesktopResize(rdpContext* context) {
  // The server (or our own SetDesktopSize request) changed the desktop
  // size — re-init GDI at the new dimensions so subsequent EndPaint calls
  // hand back correctly-sized frames.
  return gdi_resize(context->gdi, freerdp_settings_get_uint32(context->settings, FreeRDP_DesktopWidth),
                     freerdp_settings_get_uint32(context->settings, FreeRDP_DesktopHeight));
}

BOOL NexusPostConnect(freerdp* instance) {
  if (!gdi_init(instance, PIXEL_FORMAT_BGRA32)) return FALSE;
  rdpUpdate* update = instance->context->update;
  update->BeginPaint = NexusBeginPaint;
  update->EndPaint = NexusEndPaint;
  update->DesktopResize = NexusDesktopResize;
  auto* ctx = Ctx(instance->context);
  if (ctx->onStatus && *ctx->onStatus) (*ctx->onStatus)(true, "");
  return TRUE;
}

void NexusPostDisconnect(freerdp* instance) {
  auto* ctx = Ctx(instance->context);
  if (ctx->onStatus && *ctx->onStatus) (*ctx->onStatus)(false, "RDP session disconnected");
  if (instance->context->gdi) gdi_free(instance);
}

// Credentials are pre-populated via settings in RunLoop() before connect —
// this just echoes them back if FreeRDP calls Authenticate anyway (e.g. the
// server requests re-auth mid-negotiation).
BOOL NexusAuthenticate(freerdp* instance, char** username, char** password, char** domain) {
  rdpSettings* settings = instance->context->settings;
  const char* u = freerdp_settings_get_string(settings, FreeRDP_Username);
  const char* p = freerdp_settings_get_string(settings, FreeRDP_Password);
  const char* d = freerdp_settings_get_string(settings, FreeRDP_Domain);
  *username = u ? strdup(u) : nullptr;
  *password = p ? strdup(p) : nullptr;
  *domain = d ? strdup(d) : nullptr;
  return TRUE;
}

}  // namespace

namespace nexus {

RdpBackend::RdpBackend() = default;
RdpBackend::~RdpBackend() { Stop(); }

void RdpBackend::Start(const RdpConnectOptions& options, FrameCallback onFrame, DisplayStatusCallback onStatus) {
  thread_ = std::thread([this, options, onFrame = std::move(onFrame), onStatus = std::move(onStatus)]() mutable {
    RunLoop(options, std::move(onFrame), std::move(onStatus));
  });
}

void RdpBackend::RunLoop(RdpConnectOptions options, FrameCallback onFrame, DisplayStatusCallback onStatus) {
  // Wires up the lookup table generated from every statically-linked channel
  // (see scripts/build-freerdp.sh — "disp"/"drdynvc" here) so
  // freerdp_client_load_channels can actually find them. Normally done for
  // you by client-common's own freerdp_client_context_new(), but we build
  // the freerdp* instance by hand below instead of going through that, so it
  // never happens unless we call it ourselves. Idempotent and process-global
  // — harmless to call on every RunLoop, but only actually needs to happen
  // once.
  freerdp_register_addin_provider(freerdp_channels_load_static_addin_entry, 0);

  freerdp* instance = freerdp_new();
  instance->ContextSize = sizeof(NexusRdpContext);
  instance->PreConnect = NexusPreConnect;
  instance->PostConnect = NexusPostConnect;
  instance->PostDisconnect = NexusPostDisconnect;
  instance->Authenticate = NexusAuthenticate;
  // Drives loading the "disp" dynamic virtual channel (see NexusPreConnect's
  // FreeRDP_SupportDisplayControl=TRUE) — without this, FreeRDP never wires
  // up drdynvc/disp at all, and RequestResize's DispClientContext stays null
  // forever. This is the same generic, non-X11/SDL-specific client-common
  // hook freerdp_client_load_channels/freerdp_client_load_addins is built
  // for (see native/nexus-display-host/README.md).
  instance->LoadChannels = freerdp_client_load_channels;

  if (!freerdp_context_new(instance)) {
    onStatus(false, "Failed to initialize RDP context");
    freerdp_free(instance);
    return;
  }
  instance_ = reinterpret_cast<rdp_freerdp*>(instance);

  auto* ctx = reinterpret_cast<NexusRdpContext*>(instance->context);
  ctx->onFrame = &onFrame;
  ctx->onStatus = &onStatus;
  PubSub_SubscribeChannelConnected(instance->context->pubSub, NexusChannelConnected);
  PubSub_SubscribeChannelDisconnected(instance->context->pubSub, NexusChannelDisconnected);

  rdpSettings* settings = instance->context->settings;
  freerdp_settings_set_string(settings, FreeRDP_ServerHostname, options.host.c_str());
  freerdp_settings_set_uint32(settings, FreeRDP_ServerPort, static_cast<UINT32>(options.port));
  freerdp_settings_set_string(settings, FreeRDP_Username, options.username.c_str());
  freerdp_settings_set_string(settings, FreeRDP_Password, options.password.c_str());
  if (!options.domain.empty()) freerdp_settings_set_string(settings, FreeRDP_Domain, options.domain.c_str());

  if (!freerdp_connect(instance)) {
    UINT32 errorCode = freerdp_get_last_error(instance->context);
    onStatus(false, std::string("Failed to connect: ") + freerdp_get_last_error_string(errorCode));
    freerdp_context_free(instance);
    freerdp_free(instance);
    instance_ = nullptr;
    return;
  }

  // onStatus(true, "") already fired from NexusPostConnect on successful
  // negotiation — freerdp_connect() returning TRUE confirms that happened.

  HANDLE handles[64];
  while (!stopRequested_.load()) {
    DWORD count = freerdp_get_event_handles(instance->context, handles, 64);
    if (count == 0) break;
    DWORD status = WaitForMultipleObjects(count, handles, FALSE, 100);
    if (status == WAIT_FAILED) {
      onStatus(false, "RDP event wait failed");
      break;
    }
    // The 100ms wait timeout above (not just real socket activity) is what
    // gives this a steady cadence to debounce against, even during a rapid
    // run of RequestResize calls from window-drag resizing.
    MaybeApplyPendingResize(instance);
    if (!freerdp_check_event_handles(instance->context)) {
      UINT32 errorCode = freerdp_get_last_error(instance->context);
      if (errorCode != FREERDP_ERROR_SUCCESS) {
        onStatus(false, std::string("RDP connection lost: ") + freerdp_get_last_error_string(errorCode));
      }
      break;
    }
  }

  freerdp_disconnect(instance);
  freerdp_context_free(instance);
  freerdp_free(instance);
  instance_ = nullptr;
}

void RdpBackend::RequestResize(int width, int height) {
  // Just records the request — RunLoop's thread (the only one allowed to
  // touch the `freerdp*` instance) applies it via MaybeApplyPendingResize.
  // Safe to call from any thread, including in a tight burst from a window
  // being drag-resized: the atomics here are cheap, and MaybeApplyPendingResize
  // debounces the actual channel send.
  pendingWidth_.store(width);
  pendingHeight_.store(height);
  resizePending_.store(true);
}

void RdpBackend::MaybeApplyPendingResize(void* freerdpInstance) {
  if (!resizePending_.load()) return;

  constexpr auto kMinResizeInterval = std::chrono::milliseconds(300);
  auto now = std::chrono::steady_clock::now();
  if (now - lastResizeSentAt_ < kMinResizeInterval) return;  // try again next loop tick

  int width = pendingWidth_.load();
  int height = pendingHeight_.load();
  resizePending_.store(false);
  lastResizeSentAt_ = now;

  auto* instance = reinterpret_cast<freerdp*>(freerdpInstance);
  auto* ctx = Ctx(instance->context);
  // Null until the server (a) supports MS-RDPEDISP and (b) has finished
  // negotiating the "disp" dynamic virtual channel (see NexusChannelConnected)
  // — silently a no-op otherwise, same as VncBackend's best-effort resize.
  if (!ctx->disp || !ctx->disp->SendMonitorLayout) return;

  width = std::clamp(width, static_cast<int>(DISPLAY_CONTROL_MIN_MONITOR_WIDTH),
                     static_cast<int>(DISPLAY_CONTROL_MAX_MONITOR_WIDTH));
  height = std::clamp(height, static_cast<int>(DISPLAY_CONTROL_MIN_MONITOR_HEIGHT),
                      static_cast<int>(DISPLAY_CONTROL_MAX_MONITOR_HEIGHT));

  // Also update local settings so a future fresh connect (e.g. after a
  // dropped connection) starts at the last-requested size.
  freerdp_settings_set_uint32(instance->context->settings, FreeRDP_DesktopWidth, static_cast<UINT32>(width));
  freerdp_settings_set_uint32(instance->context->settings, FreeRDP_DesktopHeight, static_cast<UINT32>(height));

  // Single-monitor layout — matches FreeRDP's own X11/SDL/Wayland clients'
  // single-monitor resize path (see client/X11/xf_disp.c's xf_disp_sendResize).
  // PhysicalWidth/Height (in mm) are cosmetic/advisory to the server, derived
  // the same way: assuming ~75 DPI.
  DISPLAY_CONTROL_MONITOR_LAYOUT layout{};
  layout.Flags = DISPLAY_CONTROL_MONITOR_PRIMARY;
  layout.Left = 0;
  layout.Top = 0;
  layout.Width = static_cast<UINT32>(width);
  layout.Height = static_cast<UINT32>(height);
  layout.Orientation = 0;  // ORIENTATION_LANDSCAPE
  layout.DesktopScaleFactor = 100;
  layout.DeviceScaleFactor = 100;
  layout.PhysicalWidth = static_cast<UINT32>(std::lround(width / 75.0 * 25.4));
  layout.PhysicalHeight = static_cast<UINT32>(std::lround(height / 75.0 * 25.4));

  ctx->disp->SendMonitorLayout(ctx->disp, 1, &layout);
}

void RdpBackend::SendPointerEvent(int x, int y, int buttonMask) {
  auto* instance = reinterpret_cast<freerdp*>(instance_);
  if (!instance || !instance->context) return;
  UINT16 flags = PTR_FLAGS_MOVE;
  if (buttonMask & 1) flags |= PTR_FLAGS_DOWN | PTR_FLAGS_BUTTON1;
  freerdp_input_send_mouse_event(instance->context->input, flags, static_cast<UINT16>(x), static_cast<UINT16>(y));
}

void RdpBackend::SendKeyEvent(uint32_t scancode, bool down) {
  auto* instance = reinterpret_cast<freerdp*>(instance_);
  if (!instance || !instance->context) return;
  UINT16 flags = down ? KBD_FLAGS_DOWN : KBD_FLAGS_RELEASE;
  freerdp_input_send_keyboard_event(instance->context->input, flags, static_cast<UINT8>(scancode));
}

void RdpBackend::Stop() {
  stopRequested_.store(true);
  if (thread_.joinable()) thread_.join();
}

}  // namespace nexus
