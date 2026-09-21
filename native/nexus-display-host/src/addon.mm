// Node-API entry point. Exposes createSession/resizeSession/destroySession
// to main/services/native-display-host.ts. Only ever called from Nexus's
// Electron main process (never the renderer — see that file's header
// comment for the security rationale).
//
// Threading note: Electron's main process pumps the Cocoa run loop and
// Node's libuv loop on the SAME OS thread, so a callback dispatched via
// `dispatch_async(dispatch_get_main_queue(), ...)` (used throughout
// display_session.mm/rdp_backend.mm to hop off the RDP backend's worker
// thread) lands back on the very thread V8/Node is running on. That's what
// makes it safe to call back into JS directly from those blocks below,
// without a Napi::ThreadSafeFunction — we're never calling into V8 from a
// thread other than the one that's already running the event loop.
#import <Cocoa/Cocoa.h>

#include <napi.h>

#include <cstring>
#include <map>
#include <memory>
#include <string>

#include "display_session.h"

namespace {

std::map<std::string, std::unique_ptr<nexus::DisplaySession>> g_sessions;
// One persistent status-callback reference per session, kept alive until
// destroySession (or process exit) so async status events can still find it.
std::map<std::string, std::shared_ptr<Napi::FunctionReference>> g_statusCallbacks;
// Same idea, for the certificate-trust prompt (see resolveCertificateTrust).
std::map<std::string, std::shared_ptr<Napi::FunctionReference>> g_certificateVerifyCallbacks;

nexus::DisplayBounds ReadBounds(const Napi::Object& obj) {
  nexus::DisplayBounds b;
  b.x = obj.Get("x").As<Napi::Number>().DoubleValue();
  b.y = obj.Get("y").As<Napi::Number>().DoubleValue();
  b.width = obj.Get("width").As<Napi::Number>().DoubleValue();
  b.height = obj.Get("height").As<Napi::Number>().DoubleValue();
  return b;
}

Napi::Value CreateSession(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "createSession(options) expects an object").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object opts = info[0].As<Napi::Object>();

  std::string sessionId = opts.Get("sessionId").As<Napi::String>();
  std::string protocol = opts.Get("protocol").As<Napi::String>();
  std::string host = opts.Get("host").As<Napi::String>();
  int port = opts.Get("port").As<Napi::Number>().Int32Value();
  std::string username = opts.Get("username").As<Napi::String>();
  Napi::Value secretVal = opts.Get("secret");
  std::string secret = (secretVal.IsString()) ? secretVal.As<Napi::String>().Utf8Value() : "";
  Napi::Buffer<uint8_t> handleBuf = opts.Get("nativeWindowHandle").As<Napi::Buffer<uint8_t>>();
  nexus::DisplayBounds bounds = ReadBounds(opts.Get("bounds").As<Napi::Object>());
  Napi::Function onStatusJs = opts.Get("onStatus").As<Napi::Function>();
  Napi::Function onCertificateVerifyJs = opts.Get("onCertificateVerify").As<Napi::Function>();

  if (g_sessions.count(sessionId)) {
    Napi::Error::New(env, "A display session with this sessionId is already active").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // `nativeWindowHandle` is a Buffer wrapping the raw NSView* pointer bytes
  // that Electron's BrowserWindow.getNativeWindowHandle() returns.
  void* nativeWindowHandle = nullptr;
  if (handleBuf.ByteLength() >= sizeof(void*)) {
    memcpy(&nativeWindowHandle, handleBuf.Data(), sizeof(void*));
  }

  auto statusRef = std::make_shared<Napi::FunctionReference>(Napi::Persistent(onStatusJs));
  g_statusCallbacks[sessionId] = statusRef;
  auto certVerifyRef = std::make_shared<Napi::FunctionReference>(Napi::Persistent(onCertificateVerifyJs));
  g_certificateVerifyCallbacks[sessionId] = certVerifyRef;

  auto session = std::make_unique<nexus::DisplaySession>(sessionId, nativeWindowHandle);
  nexus::DisplaySession* sessionPtr = session.get();
  g_sessions[sessionId] = std::move(session);

  // Captured by value where cheap; env/statusRef/certVerifyRef captured for
  // the delayed JS callback (see the threading note above for why this is safe).
  bool started = sessionPtr->Connect(
      protocol, host, port, username, secret, bounds,
      [env, statusRef, sessionId](bool connected, const std::string& message) {
        if (!g_statusCallbacks.count(sessionId)) return;  // session torn down since
        Napi::HandleScope scope(env);
        statusRef->Value().Call(
            {Napi::String::New(env, connected ? "connected" : "error"), Napi::String::New(env, message)});
      },
      [env, certVerifyRef, sessionId](const std::string& fingerprint) {
        if (!g_certificateVerifyCallbacks.count(sessionId)) return;  // session torn down since
        Napi::HandleScope scope(env);
        certVerifyRef->Value().Call({Napi::String::New(env, fingerprint)});
      });

  if (!started) {
    g_sessions.erase(sessionId);
    g_statusCallbacks.erase(sessionId);
    g_certificateVerifyCallbacks.erase(sessionId);
  }

  return env.Undefined();
}

Napi::Value ResizeSession(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string sessionId = info[0].As<Napi::String>();
  auto it = g_sessions.find(sessionId);
  if (it == g_sessions.end()) return env.Undefined();
  it->second->Resize(ReadBounds(info[1].As<Napi::Object>()));
  return env.Undefined();
}

Napi::Value DestroySession(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string sessionId = info[0].As<Napi::String>();
  auto it = g_sessions.find(sessionId);
  if (it != g_sessions.end()) {
    it->second->Disconnect();
    g_sessions.erase(it);
  }
  g_statusCallbacks.erase(sessionId);
  g_certificateVerifyCallbacks.erase(sessionId);
  return env.Undefined();
}

Napi::Value ResolveCertificateTrust(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string sessionId = info[0].As<Napi::String>();
  bool trusted = info[1].As<Napi::Boolean>();
  auto it = g_sessions.find(sessionId);
  if (it != g_sessions.end()) it->second->ResolveCertificateTrust(trusted);
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createSession", Napi::Function::New(env, CreateSession));
  exports.Set("resizeSession", Napi::Function::New(env, ResizeSession));
  exports.Set("destroySession", Napi::Function::New(env, DestroySession));
  exports.Set("resolveCertificateTrust", Napi::Function::New(env, ResolveCertificateTrust));
  return exports;
}

}  // namespace

NODE_API_MODULE(nexus_display_host, Init)
