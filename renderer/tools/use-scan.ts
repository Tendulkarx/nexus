/**
 * State for one background scan (port or network): start it, collect the
 * batched progress events that belong to it, and finish on its scan:done
 * event. Cancels a still-running scan when the tool tab closes.
 */
import * as React from "react";
import { ipc } from "@renderer/lib/ipc";
import type { ScanStartResult } from "@shared/ipc-contract";

export type ScanStatus = "idle" | "starting" | "running" | "done" | "canceled" | "error";

export interface ScanState<T> {
  status: ScanStatus;
  done: number;
  total: number;
  items: T[];
  error: string | null;
}

interface ProgressShape {
  scanId: string;
  done: number;
  total: number;
}

function idle<T>(status: ScanStatus = "idle"): ScanState<T> {
  return { status, done: 0, total: 0, items: [], error: null };
}

export function useScan<E extends ProgressShape, T>(
  subscribe: (handler: (event: E) => void) => () => void,
  pick: (event: E) => T[],
) {
  const [state, setState] = React.useState<ScanState<T>>(() => idle<T>());
  const scanIdRef = React.useRef<string | null>(null);
  // Held in refs so the subscriptions below are made once, not per render.
  const pickRef = React.useRef(pick);
  pickRef.current = pick;

  React.useEffect(() => {
    const offProgress = subscribe((event) => {
      if (event.scanId !== scanIdRef.current) return;
      const found = pickRef.current(event);
      setState((s) => ({
        ...s,
        done: event.done,
        total: event.total,
        items: found.length ? [...s.items, ...found] : s.items,
      }));
    });
    const offDone = ipc.tools.onScanDone((event) => {
      if (event.scanId !== scanIdRef.current) return;
      scanIdRef.current = null;
      setState((s) => ({
        ...s,
        status: event.error ? "error" : event.canceled ? "canceled" : "done",
        error: event.error ?? null,
      }));
    });
    return () => {
      offProgress();
      offDone();
      if (scanIdRef.current) void ipc.tools.cancelScan({ scanId: scanIdRef.current }).catch(() => {});
    };
    // subscribe is a stable ipc.tools.* function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start(begin: () => Promise<ScanStartResult>) {
    if (scanIdRef.current) void ipc.tools.cancelScan({ scanId: scanIdRef.current }).catch(() => {});
    scanIdRef.current = null;
    setState(idle<T>("starting"));
    try {
      const { scanId, total } = await begin();
      scanIdRef.current = scanId;
      setState((s) => ({ ...s, status: "running", total }));
    } catch (err) {
      setState({ ...idle<T>("error"), error: cleanIpcError(err instanceof Error ? err.message : String(err)) });
    }
  }

  function cancel() {
    if (scanIdRef.current) void ipc.tools.cancelScan({ scanId: scanIdRef.current }).catch(() => {});
  }

  const busy = state.status === "starting" || state.status === "running";
  return { state, busy, start, cancel };
}

/** Error text from ipcRenderer.invoke without Electron's "Error invoking remote method …: Error:" prefix. */
export function cleanIpcError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
