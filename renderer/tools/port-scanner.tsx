import * as React from "react";
import { Button, Input } from "@renderer/lib/ui";
import { ipc } from "@renderer/lib/ipc";
import type { PortScanHit, PortScanProgressEvent } from "@shared/ipc-contract";
import { ToolLayout, Field, ResultsTable, EmptyResults } from "./tool-layout";
import { useScan } from "./use-scan";
import { takePendingPortScanHost, PORT_SCAN_HOST_EVENT } from "./tool-tabs";

/** Mirrors the well-known ports labelled in main/services/tools/port-scan.ts. */
const PRESETS = [
  {
    label: "Common",
    ports:
      "21,22,23,25,53,69,80,110,111,135,139,143,161,389,443,445,548,587,631,873,993,995,1433,1521,1883,2049,2375,3000,3306,3389,5000,5432,5900,5985,6379,6443,8006,8080,8123,8443,9000,9090,9100,27017,32400",
  },
  { label: "1–1024", ports: "1-1024" },
  { label: "All", ports: "1-65535" },
];

export function PortScannerTool() {
  const [host, setHost] = React.useState(() => takePendingPortScanHost() ?? "");
  const [ports, setPorts] = React.useState(PRESETS[0].ports);
  const scan = useScan<PortScanProgressEvent, PortScanHit>(ipc.tools.onPortScanProgress, (e) => e.open);
  const { state } = scan;

  // "Scan ports" from the network scanner while this tab is already open.
  React.useEffect(() => {
    const handler = () => {
      const pending = takePendingPortScanHost();
      if (pending) setHost(pending);
    };
    window.addEventListener(PORT_SCAN_HOST_EVENT, handler);
    return () => window.removeEventListener(PORT_SCAN_HOST_EVENT, handler);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (scan.busy) return scan.cancel();
    void scan.start(() => ipc.tools.startPortScan({ host, ports }));
  }

  const open = [...state.items].sort((a, b) => a.port - b.port);
  const statusText =
    state.status === "error"
      ? state.error
      : state.status === "idle"
        ? null
        : `${open.length} open · ${state.done.toLocaleString()} of ${state.total.toLocaleString()} ports checked${
            state.status === "canceled" ? " · stopped" : state.status === "done" ? " · finished" : ""
          }`;

  return (
    <ToolLayout
      title="Port scanner"
      description="Checks which TCP ports accept a connection. Only scan hosts you own or have permission to test."
      progress={
        state.status === "idle" || state.status === "error" ? undefined : state.total ? state.done / state.total : 0
      }
      status={
        statusText && <span className={state.status === "error" ? "text-support-red" : undefined}>{statusText}</span>
      }
      form={
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2 w-full">
          <Field label="Host" className="w-56">
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="10.0.10.11 or pve-01.lan"
              required
            />
          </Field>
          <Field label="Ports" className="flex-1 min-w-48">
            <Input
              value={ports}
              onChange={(e) => setPorts(e.target.value)}
              placeholder="22,80,443 or 1-1024"
              required
            />
          </Field>
          <div className="flex gap-1" role="group" aria-label="Port presets">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                type="button"
                variant={ports === p.ports ? "filled" : "transparent"}
                onClick={() => setPorts(p.ports)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Button type="submit" variant={scan.busy ? "filled" : "accent"} className="w-20">
            {scan.busy ? "Stop" : "Scan"}
          </Button>
        </form>
      }
    >
      {open.length === 0 ? (
        <EmptyResults>
          {state.status === "idle"
            ? "Enter a host and the ports to check."
            : scan.busy
              ? "Scanning…"
              : state.status === "error"
                ? "The scan didn't run."
                : "No open ports found."}
        </EmptyResults>
      ) : (
        <ResultsTable columns={["Port", "Service", "Connect time"]}>
          {open.map((hit) => (
            <tr key={hit.port} className="border-b border-separator/50">
              <td className="px-5 py-1.5 font-mono tabular-nums">{hit.port}</td>
              <td className="px-5 py-1.5 text-secondary">{hit.service ?? "—"}</td>
              <td className="px-5 py-1.5 tabular-nums text-secondary">{hit.latencyMs} ms</td>
            </tr>
          ))}
        </ResultsTable>
      )}
    </ToolLayout>
  );
}
