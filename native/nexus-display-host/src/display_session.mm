#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>

#include "display_session.h"

#include <cstring>
#include <vector>

// ── NexusDisplayNSView ───────────────────────────────────────────────────
// A layer-backed NSView that draws whatever BGRA32 framebuffer the protocol
// backend last handed it, and forwards real Cocoa mouse/keyboard events to
// the backend. Making this view the window's first responder for its bounds
// is what gets us native input handling for free — no synthetic event relay
// from the Electron renderer.
@interface NexusDisplayNSView : NSView
@property(nonatomic, assign) nexus::InputSink* backend;  // not owned — the session's RdpBackend
- (void)presentFrameBGRA:(const uint8_t*)bgra width:(int)width height:(int)height;
@end

@implementation NexusDisplayNSView {
  CGImageRef _lastFrame;
}

- (instancetype)initWithFrame:(NSRect)frameRect {
  self = [super initWithFrame:frameRect];
  if (self) {
    self.wantsLayer = YES;
    self.layer.backgroundColor = [NSColor blackColor].CGColor;
  }
  return self;
}

- (void)dealloc {
  if (_lastFrame) CGImageRelease(_lastFrame);
}

- (BOOL)acceptsFirstResponder {
  return YES;
}

- (void)presentFrameBGRA:(const uint8_t*)bgra width:(int)width height:(int)height {
  // Called on the main thread (see DisplaySession::Connect's dispatch_async
  // wrapping) — safe to touch AppKit/CoreAnimation here.
  //
  // The data provider must own a copy of the pixel bytes: CoreAnimation can
  // defer actually reading `layer.contents` until a later commit (not
  // synchronously during this call), so a provider built from a bare,
  // caller-owned pointer (CGDataProviderCreateWithData with no release
  // callback) can end up reading memory that's already been freed by then.
  // Wrapping the bytes in NSData first and building the provider from that
  // (CGDataProviderCreateWithCFData) makes the provider retain its own copy
  // for exactly as long as it's needed.
  NSData* data = [NSData dataWithBytes:bgra length:static_cast<NSUInteger>(width) * height * 4];
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)data);
  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
  CGImageRef image = CGImageCreate(width, height, 8, 32, static_cast<size_t>(width) * 4, colorSpace,
                                    kCGBitmapByteOrder32Little | kCGImageAlphaNoneSkipFirst, provider, nullptr, NO,
                                    kCGRenderingIntentDefault);
  CGDataProviderRelease(provider);
  CGColorSpaceRelease(colorSpace);

  if (_lastFrame) CGImageRelease(_lastFrame);
  _lastFrame = image;

  self.layer.contents = (__bridge id)image;
}

// ── Input forwarding ───────────────────────────────────────────────────
// Forwards basic mouse position/buttons + keyboard; a full mapping (modifier
// keys, keysym translation beyond ASCII, scroll wheel) is real follow-up
// work, flagged in the README.

- (void)mouseMoved:(NSEvent*)event {
  [self forwardMouse:event buttonMask:0];
}
- (void)mouseDragged:(NSEvent*)event {
  [self forwardMouse:event buttonMask:1];
}
- (void)mouseDown:(NSEvent*)event {
  [self.window makeFirstResponder:self];
  [self forwardMouse:event buttonMask:1];
}
- (void)mouseUp:(NSEvent*)event {
  [self forwardMouse:event buttonMask:0];
}

- (void)forwardMouse:(NSEvent*)event buttonMask:(int)buttonMask {
  if (!self.backend) return;
  NSPoint p = [self convertPoint:event.locationInWindow fromView:nil];
  // Cocoa's origin is bottom-left; RFB's is top-left.
  int x = static_cast<int>(p.x);
  int y = static_cast<int>(self.bounds.size.height - p.y);
  self.backend->SendPointerEvent(x, y, buttonMask);
}

- (void)keyDown:(NSEvent*)event {
  if (!self.backend) return;
  NSString* chars = event.charactersIgnoringModifiers;
  if (chars.length > 0) {
    self.backend->SendKeyEvent(static_cast<uint32_t>([chars characterAtIndex:0]), true);
  }
}
- (void)keyUp:(NSEvent*)event {
  if (!self.backend) return;
  NSString* chars = event.charactersIgnoringModifiers;
  if (chars.length > 0) {
    self.backend->SendKeyEvent(static_cast<uint32_t>([chars characterAtIndex:0]), false);
  }
}

@end

namespace {

// The renderer reports bounds in web/CSS coordinates (origin top-left, y
// grows downward — same convention as getBoundingClientRect()). AppKit's
// NSView coordinates default to origin bottom-left, y grows upward. Convert
// using the content view's own height so the child view lands under the
// renderer's placeholder <div> regardless of window chrome/traffic-light
// inset.
NSRect ConvertWebBoundsToCocoa(NSView* contentView, const nexus::DisplayBounds& bounds) {
  CGFloat contentHeight = contentView.bounds.size.height;
  CGFloat cocoaY = contentHeight - bounds.y - bounds.height;
  return NSMakeRect(bounds.x, cocoaY, bounds.width, bounds.height);
}

}  // namespace

// ── nexus::DisplaySession ─────────────────────────────────────────────────

namespace nexus {

DisplaySession::DisplaySession(std::string sessionId, void* nativeWindowHandle)
    : sessionId_(std::move(sessionId)), nativeWindowHandle_(nativeWindowHandle) {}

DisplaySession::~DisplaySession() { Disconnect(); }

bool DisplaySession::Connect(const std::string& protocol, const std::string& host, int port,
                             const std::string& username, const std::string& secret, const DisplayBounds& bounds,
                             std::function<void(bool, const std::string&)> onStatus) {
  if (protocol != "rdp") {
    onStatus(false, "Unknown display protocol: " + protocol);
    return false;
  }

  // Electron's BrowserWindow.getNativeWindowHandle() returns a Buffer whose
  // bytes are the native handle: on macOS this is an NSView* (the window's
  // content view), not an NSWindow* — see Electron's native_window_mac.mm.
  NSView* contentView = (__bridge NSView*)nativeWindowHandle_;
  if (!contentView) {
    onStatus(false, "No native window handle");
    return false;
  }

  NSRect frame = ConvertWebBoundsToCocoa(contentView, bounds);
  view_ = [[NexusDisplayNSView alloc] initWithFrame:frame];
  // Electron's own WebContentsView (Chromium's compositor surface) is
  // already a subview of contentView by the time we get here, and on macOS
  // it's backed by an IOSurface/CALayer that composites above plain sibling
  // NSViews regardless of AppKit's normal "later-added subviews draw on
  // top" ordering — a plain addSubview: here was landing our view visually
  // *behind* the web page, so nothing ever appeared even though the RDP
  // session connected fine underneath. Explicitly positioning above
  // every existing sibling (and giving the layer a high zPosition) is what
  // actually makes it paint on top.
  [contentView addSubview:view_ positioned:NSWindowAbove relativeTo:nil];
  view_.layer.zPosition = 1000;

  NexusDisplayNSView* viewRef = view_;  // captured by the lambdas below; ARC keeps it alive via the strong capture
  auto onFrame = [viewRef](const uint8_t* bgra, int w, int h) {
    // Backend thread → hop to main thread before touching AppKit.
    std::vector<uint8_t> copy(bgra, bgra + (static_cast<size_t>(w) * h * 4));
    dispatch_async(dispatch_get_main_queue(), ^{
      [viewRef presentFrameBGRA:copy.data() width:w height:h];
    });
  };
  auto onStatusHop = [onStatus](bool connected, const std::string& message) {
    dispatch_async(dispatch_get_main_queue(), ^{
      onStatus(connected, message);
    });
  };

  rdpBackend_ = std::make_unique<RdpBackend>();
  view_.backend = rdpBackend_.get();
  RdpConnectOptions options;
  options.host = host;
  options.port = port;
  options.username = username;
  options.password = secret;
  rdpBackend_->Start(options, onFrame, onStatusHop);

  return true;
}

void DisplaySession::Resize(const DisplayBounds& bounds) {
  if (!view_) return;
  void* nativeWindowHandle = nativeWindowHandle_;
  NexusDisplayNSView* viewRef = view_;
  // `bounds` is a reference bound to a temporary at the call site (see
  // addon.mm's ResizeSession) that's destroyed the instant this function
  // returns. dispatch_async defers the block well past that point, so it
  // must capture an actual value copy here — capturing `bounds` itself would
  // capture a dangling reference to already-freed stack memory by the time
  // the block runs, silently reading garbage (usually all-zero) coordinates.
  DisplayBounds boundsCopy = bounds;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSView* contentView = (__bridge NSView*)nativeWindowHandle;
    viewRef.frame = ConvertWebBoundsToCocoa(contentView, boundsCopy);
    // Re-assert topmost stacking on every resize — Electron can reinsert or
    // re-layer its own WebContentsView (e.g. on window resize), which would
    // otherwise silently push our view back behind the page again.
    [contentView addSubview:viewRef positioned:NSWindowAbove relativeTo:nil];
  });
  if (rdpBackend_) rdpBackend_->RequestResize(static_cast<int>(bounds.width), static_cast<int>(bounds.height));
}

void DisplaySession::Disconnect() {
  if (rdpBackend_) {
    rdpBackend_->Stop();
    rdpBackend_.reset();
  }
  if (view_) {
    NexusDisplayNSView* viewToRemove = view_;
    view_ = nullptr;
    dispatch_async(dispatch_get_main_queue(), ^{
      [viewToRemove removeFromSuperview];
    });
  }
}

}  // namespace nexus
