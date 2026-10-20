/**
 * Opens a shell on this Mac as a new session tab. Shared by the tab strip,
 * Sessions sidebar, command palette and the File › New Local Shell menu item.
 */
import { ipc } from "./ipc";
import { setSession } from "./sessions";
import { addOpenSession } from "./open-sessions-store";
import { toast } from "./ui";

export async function openLocalShell(): Promise<void> {
  try {
    const info = await ipc.session.openLocal();
    setSession(info);
    addOpenSession(info.sessionId);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Couldn't open a local shell");
  }
}
