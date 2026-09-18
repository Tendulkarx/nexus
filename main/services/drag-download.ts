/**
 * Downloads a remote file to a scratch temp path so it can be handed to
 * Chromium's "DownloadURL" drag mechanism — dragging a remote file out of the
 * file pane onto Finder to save it locally. See main/index.ts's `nexus-drag`
 * protocol handler, which fetches through this on drop.
 */
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";

import { sessionManager } from "./session-manager.js";

export async function prepareDragDownload(sessionId: string, remotePath: string): Promise<string> {
  const session = sessionManager.get(sessionId);
  const name = path.posix.basename(remotePath) || "file";
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "nexus-drag-"));
  const tempPath = path.join(dir, name);
  await session.download(remotePath, tempPath, () => {}, new AbortController().signal);
  return tempPath;
}
