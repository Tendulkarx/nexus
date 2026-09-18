/**
 * Per-profile bookmarked remote paths + recently-visited remote paths.
 * Ad-hoc (profile-less) sessions have no stable identity to key against, so
 * these are only tracked for sessions opened from a saved connection profile
 * — see SessionInfo.profileId.
 */
import { DataStore } from "./data-store.js";

import type { RemotePlace } from "@shared/ipc-contract";

interface ProfilePlaces {
  bookmarks: RemotePlace[];
  recents: string[];
}

interface RemotePlacesFile {
  version: number;
  profiles: Record<string, ProfilePlaces>;
}

const DEFAULT_FILE: RemotePlacesFile = { version: 1, profiles: {} };
const MAX_RECENTS = 15;

function emptyPlaces(): ProfilePlaces {
  return { bookmarks: [], recents: [] };
}

export class RemotePlacesStore {
  private store = new DataStore<RemotePlacesFile>("remote-places.json", DEFAULT_FILE);

  async listBookmarks(profileId: string): Promise<RemotePlace[]> {
    const data = await this.store.load();
    return data.profiles[profileId]?.bookmarks ?? [];
  }

  async addBookmark(profileId: string, path: string, label?: string): Promise<RemotePlace[]> {
    const data = await this.store.load();
    const places = (data.profiles[profileId] ??= emptyPlaces());
    if (!places.bookmarks.some((b) => b.path === path)) {
      places.bookmarks.push({ path, label: label ?? null, addedAt: Date.now() });
      await this.store.save(data);
    }
    return places.bookmarks;
  }

  async removeBookmark(profileId: string, path: string): Promise<RemotePlace[]> {
    const data = await this.store.load();
    const places = data.profiles[profileId];
    if (!places) return [];
    places.bookmarks = places.bookmarks.filter((b) => b.path !== path);
    await this.store.save(data);
    return places.bookmarks;
  }

  async listRecents(profileId: string): Promise<string[]> {
    const data = await this.store.load();
    return data.profiles[profileId]?.recents ?? [];
  }

  async recordVisit(profileId: string, path: string): Promise<void> {
    const data = await this.store.load();
    const places = (data.profiles[profileId] ??= emptyPlaces());
    places.recents = [path, ...places.recents.filter((p) => p !== path)].slice(0, MAX_RECENTS);
    await this.store.save(data);
  }
}

export const remotePlacesStore = new RemotePlacesStore();
