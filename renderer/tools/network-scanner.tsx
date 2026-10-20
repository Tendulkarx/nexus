import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input } from "@renderer/lib/ui";
import { ipc } from "@renderer/lib/ipc";
import type { NetworkHost, NetworkScanProgressEvent } from "@shared/ipc-contract";
import { ToolLayout, Field, ResultsTable, EmptyResults } from "./tool-layout";
import { useScan } from "./use-scan";
import { openPortScannerFor } from "./tool-tabs";

/** Numeric IPv4 order, so 10.0.0.9 sorts before 10.0.0.10. */
function addressKey(address: string): number {
  return address.split(".").reduce((acc, p) => acc * 256 + Number(p), 0);
}

export function NetworkScannerTool() {
  const networksQuery = useQuery({ queryKey: ["tools:localNetworks"], queryFn: () => ipc.tools.localNetworks() });
  const [cidr, setCidr] = React.useState("");
  const scan = useScan<NetworkScanProgressEvent, NetworkHost>(ipc.tools.onNetworkScanProgress, (e) => e.hosts);
  const { state } = scan;

  // Default to this Mac's own network once it's known, unless the user has typed something.
  const firstNetwork = networksQuery.data?.[0]?.cidr;
  React.useEffect(() => {
    if (firstNetwork) setCidr((current) => current || firstNetwork);
  }, [firstNetwork]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (scan.busy) return scan.cancel();
    void scan.start(() => ipc.tools.startNetworkScan({ cidr }));
  }

  const hosts = [...state.items].sort((a, b) => addressKey(a.address) - addressKey(b.address));
  const statusText =
    state.status === "error"
      ? state.error
      : state.status === "idle"
        ? null
        : `${hosts.length} live · ${state.done} of ${state.total} addresses checked${
            state.status === "canceled" ? " · stopped" : state.status === "done" ? " · finished" : ""
          }`;

  return (
    <ToolLayout
      title="Network scanner"
      description="Pings each address and tries a few common ports, so hosts that block ping still show up."
      progress={
        state.status === "idle" || state.status === "error" ? undefined : state.total ? state.done / state.total : 0
      }
      status={
        statusText && <span className={state.status === "error" ? "text-support-red" : undefined}>{statusText}</span>
      }
      form={
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2 w-full">
          <Field label="Range (CIDR, up to /22)" className="w-56">
            <Input value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="192.168.1.0/24" required />
          </Field>
          {(networksQuery.data?.length ?? 0) > 1 && (
            <div className="flex gap-1" role="group" aria-label="This Mac's networks">
              {networksQuery.data!.map((n) => (
                <Button
                  key={n.interfaceName + n.cidr}
                  type="button"
                  variant={cidr === n.cidr ? "filled" : "transparent"}
                  onClick={() => setCidr(n.cidr)}
                >
                  {n.interfaceName} {n.cidr}
                </Button>
              ))}
            </div>
          )}
          <Button type="submit" variant={scan.busy ? "filled" : "accent"} className="w-20">
            {scan.busy ? "Stop" : "Scan"}
          </Button>
        </form>
      }
    >
      {hosts.length === 0 ? (
        <EmptyResults>
          {state.status === "idle"
            ? "Pick a range to scan."
            : scan.busy
              ? "Scanning…"
              : state.status === "error"
                ? "The scan didn't run."
                : "No hosts answered."}
        </EmptyResults>
      ) : (
        <ResultsTable columns={["Address", "Name", "Ping", "Open ports", ""]}>
          {hosts.map((h) => (
            <tr key={h.address} className="border-b border-separator/50">
              <td className="px-5 py-1.5 font-mono tabular-nums">{h.address}</td>
              <td className="px-5 py-1.5 text-secondary">{h.hostname ?? "—"}</td>
              <td className="px-5 py-1.5 tabular-nums text-secondary">
                {h.latencyMs === null ? "no reply" : `${h.latencyMs} ms`}
              </td>
              <td className="px-5 py-1.5 font-mono text-xs text-secondary">{h.openPorts.join(", ") || "—"}</td>
              <td className="px-5 py-1 text-right">
                <Button size="small" variant="transparent" onClick={() => openPortScannerFor(h.address)}>
                  Scan ports
                </Button>
              </td>
            </tr>
          ))}
        </ResultsTable>
      )}
    </ToolLayout>
  );
}
