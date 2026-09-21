// Owns one embedded remote-desktop session: a native NSView (created and
// attached as a child of the target BrowserWindow's contentView) plus an
// RdpBackend driving pixels into it.
//
// Threading: the backend runs its own thread (see rdp_backend.h). Frame and
// status callbacks arrive on that thread and are marshaled back to the main
// thread (required for any Cocoa/AppKit call) via dispatch_async(dispatch_get_main_queue()).
#pragma once

#include <functional>
#include <memory>
#include <string>

#include "rdp_backend.h"

#ifdef __OBJC__
@class NexusDisplayNSView;
#endif

namespace nexus {

struct DisplayBounds {
  double x = 0, y = 0, width = 0, height = 0;
};

class DisplaySession {
 public:
  DisplaySession(std::string sessionId, void* nativeWindowHandle);
  ~DisplaySession();

  // Creates the child view, attaches it to the window at `bounds`, and
  // starts the protocol backend. `onStatus`/`onCertificateVerify` are
  // invoked on the main thread.
  bool Connect(const std::string& protocol, const std::string& host, int port, const std::string& username,
               const std::string& secret, const DisplayBounds& bounds,
               std::function<void(bool connected, const std::string& message)> onStatus,
               std::function<void(const std::string& fingerprint)> onCertificateVerify);

  void Resize(const DisplayBounds& bounds);

  // Answers a pending certificate-trust prompt — see RdpBackend::ResolveCertificateTrust.
  void ResolveCertificateTrust(bool trusted);

  // Tears down the backend + removes/releases the native view.
  void Disconnect();

 private:
  std::string sessionId_;
  void* nativeWindowHandle_ = nullptr;
#ifdef __OBJC__
  NexusDisplayNSView* view_ = nullptr;
#else
  void* view_ = nullptr;
#endif
  std::unique_ptr<RdpBackend> rdpBackend_;
};

}  // namespace nexus
