import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PanelGroup, Panel } from "@renderer/lib/ui";
import type { FsEntry, SessionInfo } from "@shared/ipc-contract";
import { ipc } from "@renderer/lib/ipc";
import { FilePane } from "./file-pane";
import { SyncDialog } from "./sync-dialog";
import type { useTransfers } from "@renderer/lib/use-transfers";

interface DualPaneViewProps {
  session: SessionInfo;
  transferState: ReturnType<typeof useTransfers>;
}

export function DualPaneView({ session, transferState }: DualPaneViewProps) {
  const qc = useQueryClient();

  // Bootstrap local root path
  const localRootsQuery = useQuery({
    queryKey: ["local:roots"],
    queryFn: () => ipc.local.roots(),
  });

  const [localPath, setLocalPath] = React.useState<string | null>(null);
  const [remotePath, setRemotePath] = React.useState(session.homeDir);
  const [syncTarget, setSyncTarget] = React.useState<{ localRoot: string; remoteRoot: string } | null>(null);

  // Set local path once roots are loaded
  React.useEffect(() => {
    if (localRootsQuery.data && !localPath) {
      setLocalPath(localRootsQuery.data.home);
    }
  }, [localRootsQuery.data, localPath]);

  async function handleUpload(localFilePath: string, name: string) {
    const remoteTarget = remotePath.endsWith("/")
      ? `${remotePath}${name}`
      : `${remotePath}/${name}`;
    console.log("[DualPaneView:upload]", { localFilePath, remoteTarget });
    await transferState.startUpload({
      sessionId: session.sessionId,
      localPath: localFilePath,
      remotePath: remoteTarget,
      name,
    });
    void qc.invalidateQueries({ queryKey: ["remote", session.sessionId, remotePath] });
  }

  async function handleDownload(remoteFilePath: string, name: string) {
    const localTarget = localPath
      ? (localPath.endsWith("/") ? `${localPath}${name}` : `${localPath}/${name}`)
      : name;
    console.log("[DualPaneView:download]", { remoteFilePath, localTarget });
    await transferState.startDownload({
      sessionId: session.sessionId,
      remotePath: remoteFilePath,
      localPath: localTarget,
      name,
    });
    void qc.invalidateQueries({ queryKey: ["local", localPath] });
  }

  function handleSyncFromLocal(entry: FsEntry) {
    setSyncTarget({ localRoot: entry.path, remoteRoot: remotePath });
  }

  function handleSyncFromRemote(entry: FsEntry) {
    setSyncTarget({ localRoot: localPath ?? entry.path, remoteRoot: entry.path });
  }

  if (!localPath) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-secondary text-small">Loading...</span>
      </div>
    );
  }

  return (
    <>
      <PanelGroup storageKey="dual-pane" className="h-full">
        <Panel minSize={200}>
          <FilePane
            mode="local"
            path={localPath}
            onNavigate={setLocalPath}
            onUpload={handleUpload}
            onDownload={handleDownload}
            sessionId={session.sessionId}
            protocol={session.protocol}
            onDropFromRemote={handleDownload}
            onSyncFolder={handleSyncFromLocal}
          />
        </Panel>
        <Panel minSize={200}>
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
            onSyncFolder={handleSyncFromRemote}
          />
        </Panel>
      </PanelGroup>

      {syncTarget && (
        <SyncDialog
          open={!!syncTarget}
          onOpenChange={(open) => { if (!open) setSyncTarget(null); }}
          sessionId={session.sessionId}
          localRoot={syncTarget.localRoot}
          remoteRoot={syncTarget.remoteRoot}
        />
      )}
    </>
  );
}
