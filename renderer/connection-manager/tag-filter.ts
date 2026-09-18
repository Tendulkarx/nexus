/**
 * Pure tag-filter logic for the connection-manager sidebar's tag chips.
 * Multi-select is OR semantics: a profile matches if it carries ANY of the
 * selected tags (the more expected reading of "filter by these tags" —
 * requiring ALL selected tags would make selecting a second chip narrow
 * results in a way most users don't expect from filter chips).
 */
import type { ConnectionProfileDTO } from "@shared/ipc-contract";

/** All distinct tags in use across `profiles`, alphabetically sorted. */
export function collectTags(profiles: ConnectionProfileDTO[]): string[] {
  const tags = new Set<string>();
  for (const profile of profiles) {
    for (const tag of profile.tags) tags.add(tag);
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

/** True when `profileTags` should be shown under the given `selectedTags` filter (OR semantics). */
export function matchesTagFilter(profileTags: string[], selectedTags: string[]): boolean {
  if (selectedTags.length === 0) return true;
  return profileTags.some((tag) => selectedTags.includes(tag));
}
