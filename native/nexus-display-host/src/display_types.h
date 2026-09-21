// Shared types for protocol backends (currently just RdpBackend) driving
// pixels into a DisplaySession's NSView.
#pragma once

#include <cstdint>
#include <functional>
#include <string>

namespace nexus {

// Called on the backend's own thread whenever a region of the remote
// framebuffer changes. `bgra32` points at `width * height * 4` bytes,
// BGRA8888, valid only for the duration of the call.
using FrameCallback = std::function<void(const uint8_t* bgra32, int width, int height)>;

// Called (on the backend thread) on connect success, disconnect, or error.
using DisplayStatusCallback = std::function<void(bool connected, const std::string& errorMessage)>;

// Called (on the backend thread) when the server's TLS certificate needs a
// trust decision — every connection attempt, not just the first, since only
// the JS layer's known-hosts-store knows whether `fingerprint` is new,
// matches what was previously trusted, or has changed. This call itself must
// return quickly (see RdpBackend::AwaitCertificateTrust, which blocks on it
// separately) — it's expected to hop off this thread (e.g. dispatch_async)
// and return immediately, not to resolve the trust decision synchronously.
using CertificateVerifyCallback = std::function<void(const std::string& fingerprint)>;

}  // namespace nexus
