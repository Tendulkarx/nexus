/**
 * Remote Desktop (RDP) pane. Renders NO pixels itself — the actual
 * session is drawn by a native NSView the main process composites directly
 * into the BrowserWindow (see native/nexus-display-host), for full native
 * rendering performance instead of a web-canvas relay. This component is a
 * transparent placeholder whose bounds are reported to main so it can
 * position/size that native view to exactly cover this element.
 *
 * Because the native view is a Cocoa sibling layer, not part of the DOM, it
 * doesn't respect CSS visibility — when this pane is hidden (this session's
 * tab isn't the active one in AppShell's top-level tab strip, see
 * renderer/main/app-shell.tsx), an IntersectionObserver-driven zero-size
 * resize is used to hide it rather than relying on `display:none`.
 */
import * as React from "react";
import { Loader2Icon, MonitorIcon } from "lucide-react";
import { ipc } from "@renderer/lib/ipc";
import { Text } from "@renderer/lib/ui";
import type { SessionInfo, DisplaySessionState } from "@shared/ipc-contract";

interface RemoteDesktopPaneProps {
  session: SessionInfo;
}

export function RemoteDesktopPane({ session }: RemoteDesktopPaneProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const connectedRef = React.useRef(false);
  const visibleRef = React.useRef(true);
  const [state, setState] = React.useState<DisplaySessionState>("connecting");
  const [message, setMessage] = React.useState<string | undefined>(undefined);

  const sendBounds = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const bounds = visibleRef.current
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : { x: rect.x, y: rect.y, width: 0, height: 0 }; // hidden tab — zero-size to hide the native view

    if (!connectedRef.current) {
      connectedRef.current = true;
      void ipc.display.connect({ sessionId: session.sessionId, bounds }).catch((err) => {
        setState("error");
        setMessage(err instanceof Error ? err.message : String(err));
      });
    } else {
      void ipc.display.resize({ sessionId: session.sessionId, bounds }).catch(() => {});
    }
  }, [session.sessionId]);

  React.useEffect(() => {
    const off = ipc.display.onStatus(({ sessionId, state: newState, message: newMessage }) => {
      if (sessionId !== session.sessionId) return;
      setState(newState);
      setMessage(newMessage);
    });
    return off;
  }, [session.sessionId]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const resizeObserver = new ResizeObserver(() => sendBounds());
    resizeObserver.observe(el);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
        sendBounds();
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(el);

    // Initial connect — fires once on mount even before any observer callback.
    sendBounds();

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      if (connectedRef.current) {
        void ipc.display.disconnect({ sessionId: session.sessionId }).catch(() => {});
        connectedRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect/disconnect keyed to session identity only, sendBounds is stable per session
  }, [session.sessionId]);

  return (
    <div className="h-full w-full relative bg-black">
      {/* The native view is composited by macOS at this element's bounds — this div is intentionally transparent/empty. */}
      <div ref={containerRef} className="absolute inset-0" />

      {state !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 pointer-events-none">
          {state === "connecting" && (
            <>
              <Loader2Icon className="size-6 animate-spin text-tertiary" />
              <Text color="secondary">Connecting to {session.host}…</Text>
            </>
          )}
          {state === "error" && (
            <>
              <MonitorIcon className="size-6 text-support-red" />
              <Text color="secondary">{message ?? "Remote desktop connection failed"}</Text>
            </>
          )}
          {state === "closed" && <Text color="secondary">Remote desktop session closed</Text>}
        </div>
      )}
    </div>
  );
}
