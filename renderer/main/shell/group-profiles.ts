/**
 * Pure grouping for the Sessions sidebar, kept out of the component so it can
 * be unit tested without React or IPC (see group-profiles.test.ts).
 */
import type { ConnectionProfileDTO, Folder } from "@shared/ipc-contract";

export interface ProfileGroup {
  key: string;
  name: string;
  profiles: ConnectionProfileDTO[];
}

/** Folders in their saved order, then an "Ungrouped" bucket; empty groups are dropped. */
export function groupProfiles(profiles: ConnectionProfileDTO[], folders: Folder[], filter: string): ProfileGroup[] {
  const q = filter.trim().toLowerCase();
  const matches = q
    ? profiles.filter((p) => [p.name, p.host, p.username, ...p.tags].some((v) => v.toLowerCase().includes(q)))
    : profiles;
  const byName = (a: ConnectionProfileDTO, b: ConnectionProfileDTO) => a.name.localeCompare(b.name);
  const folderIds = new Set(folders.map((f) => f.id));
  const groups: ProfileGroup[] = folders.map((f) => ({
    key: f.id,
    name: f.name,
    profiles: matches.filter((p) => p.folderId === f.id).sort(byName),
  }));
  groups.push({
    key: "ungrouped",
    name: folders.length > 0 ? "Ungrouped" : "Connections",
    profiles: matches.filter((p) => !p.folderId || !folderIds.has(p.folderId)).sort(byName),
  });
  return groups.filter((g) => g.profiles.length > 0);
}
