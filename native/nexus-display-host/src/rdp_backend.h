// RDP backend — wraps FreeRDP's client C API (a from-source build, see
// scripts/build-freerdp.sh and the README's "RDP dependency licensing"
// section for why; targets FreeRDP 3.x's settings-accessor API — see the
// README if the vendored version differs and struct-field-style 2.x calls
// are needed instead).
//
// Owns a background thread running FreeRDP's connect + event loop;
// frame/status callbacks arrive on that thread and must be hopped to the
// main thread before touching AppKit (display_session.mm does that hop, not
// this file).
#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <string>
#include <thread>

#include "display_types.h"
#include "input_sink.h"

struct rdp_freerdp;

namespace nexus {

struct RdpConnectOptions {
  std::string host;
  int port = 3389;
  std::string username;
  std::string password;
  std::string domain;  // optional — "DOMAIN\\user" split out, or blank
};

class RdpBackend : public InputSink {
 public:
  RdpBackend();
  ~RdpBackend() override;

  RdpBackend(const RdpBackend&) = delete;
  RdpBackend& operator=(const RdpBackend&) = delete;

  void Start(const RdpConnectOptions& options, FrameCallback onFrame, DisplayStatusCallback onStatus);

  // FreeRDP supports live desktop resize via the "disp" (Display Control,
  // MS-RDPEDISP) dynamic virtual channel. Safe to call from any thread —
  // this just records the latest requested size; RunLoop (which owns the
  // `freerdp*` instance and is the only thread allowed to touch it) applies
  // it, debounced, on its own thread. See the .mm file for why.
  void RequestResize(int width, int height);

  void SendPointerEvent(int x, int y, int buttonMask) override;
  void SendKeyEvent(uint32_t scancode, bool down) override;

  void Stop();

 private:
  void RunLoop(RdpConnectOptions options, FrameCallback onFrame, DisplayStatusCallback onStatus);

  // Sends the latest pending resize (if any, and if enough time has passed
  // since the last one) via the "disp" channel. Only ever called from
  // RunLoop's own thread — see rdp_backend.mm. `freerdpInstance` is an
  // opaque `freerdp*`, same rationale as instance_ below.
  void MaybeApplyPendingResize(void* freerdpInstance);

  rdp_freerdp* instance_ = nullptr;  // opaque `freerdp*` — real type name avoided here so this header doesn't need <freerdp/freerdp.h>
  std::thread thread_;
  std::atomic<bool> stopRequested_{false};

  // Pending-resize state, written from RequestResize (any thread) and read
  // only from RunLoop's own thread — see MaybeApplyPendingResize.
  std::atomic<bool> resizePending_{false};
  std::atomic<int> pendingWidth_{0};
  std::atomic<int> pendingHeight_{0};
  std::chrono::steady_clock::time_point lastResizeSentAt_;
};

}  // namespace nexus
