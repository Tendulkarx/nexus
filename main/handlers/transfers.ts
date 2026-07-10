/**
 * IPC handlers for file transfers. Start returns a transferId immediately;
 * progress/done/error stream back as events (see TransferManager).
 */
import { ipcMain } from "@glaze/core/backend";

import { asRecord, reqString } from "./validate.js";
import { transferManager } from "../services/transfer-manager.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";

export function registerTransferHandlers(): void {
  ipcMain.handle(IPC.transfer.upload, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "transfer:upload");
    const transferId = transferManager.start(
      "upload",
      reqString(obj, "sessionId", "transfer:upload"),
      reqString(obj, "localPath", "transfer:upload"),
      reqString(obj, "remotePath", "transfer:upload"),
    );
    return { transferId };
  });

  ipcMain.handle(IPC.transfer.download, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "transfer:download");
    const transferId = transferManager.start(
      "download",
      reqString(obj, "sessionId", "transfer:download"),
      reqString(obj, "localPath", "transfer:download"),
      reqString(obj, "remotePath", "transfer:download"),
    );
    return { transferId };
  });

  ipcMain.handle(IPC.transfer.cancel, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "transfer:cancel");
    transferManager.cancel(reqString(obj, "transferId", "transfer:cancel"));
    return { ok: true as const };
  });
}
