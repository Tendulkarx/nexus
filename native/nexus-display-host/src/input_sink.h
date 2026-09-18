// Tiny interface so NexusDisplayNSView (display_session.mm) can forward
// Cocoa mouse/keyboard events to the active RdpBackend without depending on
// its concrete type.
#pragma once

#include <cstdint>

namespace nexus {

class InputSink {
 public:
  virtual ~InputSink() = default;
  virtual void SendPointerEvent(int x, int y, int buttonMask) = 0;
  // `code` is a Windows virtual-key scancode (RdpBackend's expected shape) —
  // the NSView layer just passes through what it has (see its keyDown/keyUp
  // handlers).
  virtual void SendKeyEvent(uint32_t code, bool down) = 0;
};

}  // namespace nexus
