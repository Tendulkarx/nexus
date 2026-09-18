/**
 * IPC handlers for per-profile bookmarked + recently-visited remote paths.
 * See remote-places-store.ts.
 */
import { ipcMain } from "electron";

import { asRecord, optString, reqString } from "./validate.js";
import { remotePlacesStore } from "../services/remote-places-store.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";

export function registerRemotePlacesHandlers(): void {
  ipcMain.handle(IPC.remotePlaces.listBookmarks, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "remotePlaces:listBookmarks");
    const bookmarks = await remotePlacesStore.listBookmarks(reqString(obj, "profileId", "remotePlaces:listBookmarks"));
    return { bookmarks };
  });

  ipcMain.handle(IPC.remotePlaces.addBookmark, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "remotePlaces:addBookmark");
    const bookmarks = await remotePlacesStore.addBookmark(
      reqString(obj, "profileId", "remotePlaces:addBookmark"),
      reqString(obj, "path", "remotePlaces:addBookmark"),
      optString(obj, "label"),
    );
    return { bookmarks };
  });

  ipcMain.handle(IPC.remotePlaces.removeBookmark, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "remotePlaces:removeBookmark");
    const bookmarks = await remotePlacesStore.removeBookmark(
      reqString(obj, "profileId", "remotePlaces:removeBookmark"),
      reqString(obj, "path", "remotePlaces:removeBookmark"),
    );
    return { bookmarks };
  });

  ipcMain.handle(IPC.remotePlaces.listRecents, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "remotePlaces:listRecents");
    const recents = await remotePlacesStore.listRecents(reqString(obj, "profileId", "remotePlaces:listRecents"));
    return { recents };
  });

  ipcMain.handle(IPC.remotePlaces.recordVisit, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "remotePlaces:recordVisit");
    await remotePlacesStore.recordVisit(
      reqString(obj, "profileId", "remotePlaces:recordVisit"),
      reqString(obj, "path", "remotePlaces:recordVisit"),
    );
    return { ok: true as const };
  });
}
