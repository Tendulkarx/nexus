/**
 * VNC viewer: noVNC (MPL-2.0, used unmodified) drawing to a canvas, over
 * VncChannel's IPC bridge. Handles VNC password and Apple Remote Desktop
 * (macOS Screen Sharing) logins: the saved login is fetched once when the
 * server asks (vnc:credentials); if there's none, or it's rejected, the user
 * is asked in the pane.
 */
import * as React from "react";
import RFB from "@novnc/novnc";
import { ClipboardPasteIcon, EyeIcon, KeyboardIcon, Loader2Icon, MaximizeIcon, RefreshCwIcon } from "lucide-react";
import { Button, Input, Text, toast } from "@renderer/lib/ui";
import { ipc } from "@renderer/lib/ipc";
import { getPreferences, usePreferences } from "@renderer/lib/preferences";
import type { SessionInfo } from "@shared/ipc-contract";
import { VncChannel } from "./vnc-channel";
import { setSessionStatus } from "@renderer/lib/session-status";

type Status =
  | { state: "connecting" }
  | { state: "credentials"; types: string[]; failed: boolean }
  | { state: "connected"; name: string }
  | { state: "disconnected"; message: string | null };

/**
 * noVNC hides the local pointer and draws only the cursor shape the server
 * sends (RFB Cursor pseudo-encoding). Until a shape arrives it sets
 * `cursor: none`, and some servers, macOS Screen Sharing among them, never
 * send one, which leaves no pointer at all. Swap that `none` for the normal
 * arrow; any real server cursor (a `url(...)` value) is left alone. (noVNC's
 * showDotCursor isn't used: it also replaces the missing cursor, with a dot
 * three pixels across.)
 */
export function keepPointerVisible(container: HTMLElement): () => void {
  const fix = (el: HTMLElement) => {
    if (el.style.cursor === "none") el.style.cursor = "default";
  };
  const canvases = () => Array.from(container.querySelectorAll("canvas"));
  canvases().forEach(fix);
  const observer = new MutationObserver((records) => {
    for (const r of records) if (r.target instanceof HTMLCanvasElement) fix(r.target);
    // noVNC can replace its canvas on reconnect.
    canvases().forEach(fix);
  });
  observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
  return () => observer.disconnect();
}

/** " · 3456×2234 · 2.4 MB/s", or "" before the first frame. */
function formatStats({ width, height, bytesPerSecond }: { width: number; height: number; bytesPerSecond: number }) {
  if (!width || !height) return "";
  const rate =
    bytesPerSecond >= 1e6 ? `${(bytesPerSecond / 1e6).toFixed(1)} MB/s` : `${Math.round(bytesPerSecond / 1e3)} KB/s`;
  return ` · ${width}×${height} · ${rate}`;
}

export function VncPane({ session }: { session: SessionInfo }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rfbRef = React.useRef<RFB | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [status, setStatus] = React.useState<Status>({ state: "connecting" });
  // Toolbar toggles start from Settings › Remote Desktop and then apply to this viewer only.
  const remotePrefs = usePreferences().remoteDesktop;
  const [scale, setScale] = React.useState(() => getPreferences().remoteDesktop.vncFitToWindow);
  const [viewOnly, setViewOnly] = React.useState(() => getPreferences().remoteDesktop.vncViewOnly);
  const shareClipboard = remotePrefs.vncShareClipboard;
  const [prompt, setPrompt] = React.useState({ username: session.username, password: "" });
  const [stats, setStats] = React.useState({ width: 0, height: 0, bytesPerSecond: 0 });

  React.useEffect(() => {
    if (!containerRef.current) return;
    const channel = new VncChannel(session.sessionId);
    const rfb = new RFB(containerRef.current, channel, { shared: true });
    rfb.scaleViewport = scale;
    rfb.background = "#10171d";
    // Best image quality: only lossy (JPEG) encodings look at this, and noVNC's default of 6 visibly degrades them.
    rfb.qualityLevel = 9;
    rfbRef.current = rfb;
    const stopCursorFallback = keepPointerVisible(containerRef.current);
    const container = containerRef.current;
    let lastBytes = 0;
    const statsTimer = window.setInterval(() => {
      const canvas = container.querySelector("canvas");
      setStats({
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
        bytesPerSecond: channel.bytesReceived - lastBytes,
      });
      lastBytes = channel.bytesReceived;
    }, 1000);
    setStatus({ state: "connecting" });
    setSessionStatus(session.sessionId, { state: "connecting" });
    let triedSaved = false;

    // noVNC reports the desktop name during the handshake, before "connect".
    let desktopName = "";
    rfb.addEventListener("desktopname", (e) => {
      desktopName = (e as CustomEvent<{ name: string }>).detail.name;
      setStatus((s) => (s.state === "connected" ? { state: "connected", name: desktopName } : s));
    });
    rfb.addEventListener("connect", () => {
      setStatus({ state: "connected", name: desktopName });
      setSessionStatus(session.sessionId, { state: "connected" });
    });
    rfb.addEventListener("credentialsrequired", (e) => {
      const types = (e as CustomEvent<{ types: string[] }>).detail.types;
      if (triedSaved) return setStatus({ state: "credentials", types, failed: true });
      triedSaved = true;
      void ipc.vnc
        .credentials({ sessionId: session.sessionId })
        .then((saved) => {
          if (saved.password !== null) rfb.sendCredentials({ username: saved.username, password: saved.password });
          else setStatus({ state: "credentials", types, failed: false });
        })
        .catch(() => setStatus({ state: "credentials", types, failed: false }));
    });
    rfb.addEventListener("securityfailure", (e) => {
      const reason = (e as CustomEvent<{ reason?: string }>).detail.reason;
      const message = reason ? `Login failed: ${reason}` : "Login failed";
      setStatus({ state: "disconnected", message });
      setSessionStatus(session.sessionId, { state: "disconnected", detail: message });
    });
    rfb.addEventListener("disconnect", (e) => {
      const clean = (e as CustomEvent<{ clean: boolean }>).detail.clean;
      const detail = channel.error ?? (clean ? undefined : "The connection was lost");
      setSessionStatus(session.sessionId, { state: "disconnected", detail });
      setStatus((s) =>
        s.state === "disconnected"
          ? s
          : { state: "disconnected", message: channel.error ?? (clean ? null : "The connection was lost") },
      );
    });
    rfb.addEventListener("clipboard", (e) => {
      if (!getPreferences().remoteDesktop.vncShareClipboard) return;
      void navigator.clipboard.writeText((e as CustomEvent<{ text: string }>).detail.text).catch(() => {});
    });

    return () => {
      window.clearInterval(statsTimer);
      stopCursorFallback();
      rfbRef.current = null;
      rfb.disconnect();
    };
    // scale is applied live below; reconnecting is driven by `attempt`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId, attempt]);

  React.useEffect(() => {
    if (rfbRef.current) rfbRef.current.scaleViewport = scale;
  }, [scale]);
  React.useEffect(() => {
    if (rfbRef.current) rfbRef.current.viewOnly = viewOnly;
  }, [viewOnly]);

  function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    rfbRef.current?.sendCredentials({ username: prompt.username, password: prompt.password });
    setStatus({ state: "connecting" });
  }

  async function pasteToRemote() {
    try {
      rfbRef.current?.clipboardPasteFrom(await navigator.clipboard.readText());
      toast.success("Clipboard sent. Paste on the remote machine.");
    } catch {
      toast.error("Couldn't read the clipboard");
    }
  }

  const connected = status.state === "connected";

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-separator shrink-0">
        <Text variant="small" color="secondary" className="mr-auto truncate">
          {status.state === "connected"
            ? `Connected${status.name ? ` to ${status.name}` : ""}${formatStats(stats)}`
            : status.state === "connecting"
              ? `Connecting to ${session.host}…`
              : status.state === "credentials"
                ? "Login required"
                : "Disconnected"}
        </Text>
        <Button
          variant={scale ? "filled" : "transparent"}
          size="small"
          className="gap-1.5"
          aria-pressed={scale}
          onClick={() => setScale(!scale)}
        >
          <MaximizeIcon className="size-3.5" /> Fit to window
        </Button>
        <Button
          variant={viewOnly ? "filled" : "transparent"}
          size="small"
          className="gap-1.5"
          aria-pressed={viewOnly}
          onClick={() => setViewOnly((v) => !v)}
        >
          <EyeIcon className="size-3.5" /> View only
        </Button>
        <Button
          variant="transparent"
          size="small"
          className="gap-1.5"
          disabled={!connected}
          onClick={() => rfbRef.current?.sendCtrlAltDel()}
        >
          <KeyboardIcon className="size-3.5" /> Ctrl+Alt+Del
        </Button>
        <Button
          variant="transparent"
          size="small"
          className="gap-1.5"
          disabled={!connected || !shareClipboard}
          title={shareClipboard ? undefined : "Clipboard sharing is off in Settings › Remote Desktop"}
          onClick={() => void pasteToRemote()}
        >
          <ClipboardPasteIcon className="size-3.5" /> Send clipboard
        </Button>
      </div>

      {/* Always dark, like terminals: .terminal-surface re-seeds the theme tokens so overlay buttons stay readable. */}
      <div className="terminal-surface flex-1 min-h-0 relative bg-[#10171d]">
        <div ref={containerRef} className="absolute inset-0" />

        {status.state === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-[#93a1a1]">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            Connecting…
          </div>
        )}

        {status.state === "credentials" && (
          <form
            onSubmit={submitCredentials}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-80 flex flex-col gap-3 rounded-card border border-separator bg-[var(--bg)] p-4 shadow-xl"
          >
            <p className="text-sm font-medium text-primary">Log in to {session.host}</p>
            {status.failed && <p className="text-xs text-support-red">That login didn&apos;t work. Try again.</p>}
            {status.types.includes("username") && (
              <label className="flex flex-col gap-1 text-xs text-secondary">
                Username
                <Input
                  autoFocus
                  value={prompt.username}
                  onChange={(e) => setPrompt({ ...prompt, username: e.target.value })}
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-secondary">
              Password
              <Input
                type="password"
                autoFocus={!status.types.includes("username")}
                value={prompt.password}
                onChange={(e) => setPrompt({ ...prompt, password: e.target.value })}
              />
            </label>
            <Button type="submit" variant="accent">
              Log in
            </Button>
          </form>
        )}

        {status.state === "disconnected" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#10171d]/90">
            <Text color="secondary" className="text-[#c5ced6]">
              {status.message ?? "Disconnected"}
            </Text>
            <Button variant="filled" size="small" className="gap-1.5" onClick={() => setAttempt((n) => n + 1)}>
              <RefreshCwIcon className="size-3.5" /> Reconnect
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
