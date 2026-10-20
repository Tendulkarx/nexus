/**
 * Compact remote file browser for the shell's Files sidebar. Rendered by
 * WorkspaceView through a portal (lib/files-sidebar-slot.ts) so uploads and
 * downloads land in that session's transfer queue. Follows the terminal's
 * working directory like the dual-pane view's remote side. With no local pane
 * beside it, downloads go to Settings › Files' folder (~/Downloads by default)
 * and uploads come from Finder drops.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@renderer/lib/ipc";
import { useRemoteCwd } from "@renderer/lib/remote-cwd-store";
import { getPreferences } from "@renderer/lib/preferences";
import { expandHome } from "@shared/preferences";
import type { useTransfers } from "@renderer/lib/use-transfers";
import type { SessionInfo } from "@shared/ipc-contract";
import { FilePane } from "./file-pane";

interface RemoteFilesPanelProps {
  session: SessionInfo;
  transferState: ReturnType<typeof useTransfers>;
}

function joinPath(base: string, name: string): string {
  return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
}

export function RemoteFilesPanel({ session, transferState }: RemoteFilesPanelProps) {
  const qc = useQueryClient();
  const [remotePath, setRemotePath] = React.useState(session.homeDir);
  const rootsQuery = useQuery({ queryKey: ["local:roots"], queryFn: () => ipc.local.roots() });

  const remoteCwd = useRemoteCwd(session.sessionId);
  React.useEffect(() => {
    if (remoteCwd) setRemotePath(remoteCwd.path);
  }, [remoteCwd]);

  async function handleUpload(localFilePath: string, name: string) {
    await transferState.startUpload({
      sessionId: session.sessionId,
      localPath: localFilePath,
      remotePath: joinPath(remotePath, name),
      name,
    });
    void qc.invalidateQueries({ queryKey: ["remote", session.sessionId, remotePath] });
  }

  async function handleDownload(remoteFilePath: string, name: string) {
    const home = rootsQuery.data?.home;
    const chosen = getPreferences().files.downloadDir;
    if (!home) return;
    await transferState.startDownload({
      sessionId: session.sessionId,
      remotePath: remoteFilePath,
      localPath: joinPath(chosen ? expandHome(chosen, home) : joinPath(home, "Downloads"), name),
      name,
    });
  }

  return (
    <FilePane
      mode="remote"
      path={remotePath}
      onNavigate={setRemotePath}
      onUpload={handleUpload}
      onDownload={handleDownload}
      sessionId={session.sessionId}
      protocol={session.protocol}
      profileId={session.profileId}
      onDropFromLocal={handleUpload}
    />
  );
}
