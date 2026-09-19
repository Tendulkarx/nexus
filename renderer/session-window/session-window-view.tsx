/**
 * Standalone window body for a single popped-out session: no tab strip, no
 * connection manager — just that session's WorkspaceView. The sessionId comes
 * from the window's URL (?sessionId=...) rather than app shell state, since
 * this is a separate renderer realm from the main window (see
 * main/windows/session-window.ts).
 */
import * as React from "react";
import { useTheme } from "@renderer/lib/hooks";
import { setSession, getSession } from "@renderer/lib/sessions";
import { ipc } from "@renderer/lib/ipc";
import { Button, Text } from "@renderer/lib/ui";
import { WorkspaceView } from "@renderer/workspace/workspace-view";

function getSessionIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("sessionId");
}

export function SessionWindowView() {
  useTheme();

  const [sessionId] = React.useState(getSessionIdFromUrl);
  const [status, setStatus] = React.useState<"loading" | "ready" | "not-found">("loading");

  React.useEffect(() => {
    if (!sessionId) {
      setStatus("not-found");
      return;
    }
    if (getSession(sessionId)) {
      setStatus("ready");
      return;
    }
    let canceled = false;
    ipc.session
      .list()
      .then((sessions) => {
        if (canceled) return;
        const info = sessions.find((s) => s.sessionId === sessionId);
        if (info) {
          setSession(info);
          setStatus("ready");
        } else {
          setStatus("not-found");
        }
      })
      .catch(() => {
        if (!canceled) setStatus("not-found");
      });
    return () => {
      canceled = true;
    };
  }, [sessionId]);

  // Something else (an unexpected disconnect, or the app quitting) can remove
  // the session from lib/sessions.ts's module-level map, but (unlike the main
  // window's AppShell) nothing here is subscribed to that to unmount
  // WorkspaceView in response — poll for it instead so the window doesn't
  // keep rendering a dead session.
  React.useEffect(() => {
    if (status !== "ready" || !sessionId) return;
    const interval = setInterval(() => {
      if (!getSession(sessionId)) setStatus("not-found");
    }, 1000);
    return () => clearInterval(interval);
  }, [status, sessionId]);

  if (status !== "ready" || !sessionId) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <div className="drag-region fixed top-0 left-0 right-0 h-13" />
        <Text color="secondary">
          {status === "loading" ? "Loading session…" : "Session not found — it may have disconnected"}
        </Text>
        {status === "not-found" && <Button onClick={() => window.close()}>Close Window</Button>}
      </div>
    );
  }

  return (
    <div className="h-full relative">
      <WorkspaceView sessionId={sessionId} />
    </div>
  );
}
