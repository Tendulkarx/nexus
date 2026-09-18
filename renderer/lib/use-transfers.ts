/**
 * Transfer queue state — tracks active/queued/done transfers.
 * Subscribes to backend events and maintains a React-friendly map.
 */

import { useEffect, useReducer, useCallback } from "react";
import { ipc } from "@renderer/lib/ipc";
import type {
  TransferItem,
  TransferStatus,
  TransferDirection,
} from "@shared/ipc-contract";

type TransferAction =
  | { type: "add"; item: TransferItem }
  | { type: "progress"; transferId: string; transferred: number; total: number; bytesPerSec: number }
  | { type: "done"; transferId: string }
  | { type: "error"; transferId: string; message: string }
  | { type: "cancel"; transferId: string };

function transfersReducer(
  state: Map<string, TransferItem>,
  action: TransferAction,
): Map<string, TransferItem> {
  const next = new Map(state);
  switch (action.type) {
    case "add":
      next.set(action.item.transferId, action.item);
      return next;
    case "progress": {
      const existing = next.get(action.transferId);
      if (!existing) return state;
      next.set(action.transferId, {
        ...existing,
        status: "active" as TransferStatus,
        transferred: action.transferred,
        total: action.total,
        bytesPerSec: action.bytesPerSec,
      });
      return next;
    }
    case "done": {
      const existing = next.get(action.transferId);
      if (!existing) return state;
      next.set(action.transferId, { ...existing, status: "done" as TransferStatus });
      return next;
    }
    case "error": {
      const existing = next.get(action.transferId);
      if (!existing) return state;
      next.set(action.transferId, {
        ...existing,
        status: "error" as TransferStatus,
        error: action.message,
      });
      return next;
    }
    case "cancel": {
      const existing = next.get(action.transferId);
      if (!existing) return state;
      next.set(action.transferId, { ...existing, status: "canceled" as TransferStatus });
      return next;
    }
  }
}

export function useTransfers() {
  const [transferMap, dispatch] = useReducer(
    transfersReducer,
    new Map<string, TransferItem>(),
  );

  useEffect(() => {
    const offQueued = ipc.transfer.onQueued((item) => {
      console.log("[useTransfers:queued]", item);
      dispatch({ type: "add", item });
    });
    const offProgress = ipc.transfer.onProgress((payload) => {
      console.log("[useTransfers:progress]", payload);
      dispatch({
        type: "progress",
        transferId: payload.transferId,
        transferred: payload.transferred,
        total: payload.total,
        bytesPerSec: payload.bytesPerSec,
      });
    });
    const offDone = ipc.transfer.onDone((payload) => {
      console.log("[useTransfers:done]", payload);
      dispatch({ type: "done", transferId: payload.transferId });
    });
    const offError = ipc.transfer.onError((payload) => {
      console.log("[useTransfers:error]", payload);
      dispatch({ type: "error", transferId: payload.transferId, message: payload.message });
    });
    return () => {
      offQueued();
      offProgress();
      offDone();
      offError();
    };
  }, []);

  const startUpload = useCallback(
    async (params: {
      sessionId: string;
      localPath: string;
      remotePath: string;
      name: string;
    }) => {
      console.log("[useTransfers:upload]", params);
      const { transferId } = await ipc.transfer.upload({
        sessionId: params.sessionId,
        localPath: params.localPath,
        remotePath: params.remotePath,
      });
      const item: TransferItem = {
        transferId,
        sessionId: params.sessionId,
        direction: "upload" as TransferDirection,
        name: params.name,
        localPath: params.localPath,
        remotePath: params.remotePath,
        status: "queued",
        transferred: 0,
        total: 0,
        bytesPerSec: 0,
      };
      dispatch({ type: "add", item });
      return transferId;
    },
    [],
  );

  const startDownload = useCallback(
    async (params: {
      sessionId: string;
      remotePath: string;
      localPath: string;
      name: string;
    }) => {
      console.log("[useTransfers:download]", params);
      const { transferId } = await ipc.transfer.download({
        sessionId: params.sessionId,
        remotePath: params.remotePath,
        localPath: params.localPath,
      });
      const item: TransferItem = {
        transferId,
        sessionId: params.sessionId,
        direction: "download" as TransferDirection,
        name: params.name,
        localPath: params.localPath,
        remotePath: params.remotePath,
        status: "queued",
        transferred: 0,
        total: 0,
        bytesPerSec: 0,
      };
      dispatch({ type: "add", item });
      return transferId;
    },
    [],
  );

  const cancelTransfer = useCallback(async (transferId: string) => {
    console.log("[useTransfers:cancel]", { transferId });
    await ipc.transfer.cancel({ transferId });
    dispatch({ type: "cancel", transferId });
  }, []);

  const transfers = Array.from(transferMap.values());
  const active = transfers.filter((t) => t.status === "active" || t.status === "queued");

  return { transfers, active, startUpload, startDownload, cancelTransfer };
}
