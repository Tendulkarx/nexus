/**
 * TCP connect port scanning: a port is open when a plain connect() succeeds.
 * Needs no privileges (unlike SYN scans), so it's slower and visible in the
 * target's logs — fine for checking your own hosts, which is what this is for.
 */
import * as net from "net";

/** Well-known services, used to label open ports and as the "Common" preset. */
export const COMMON_PORTS: Record<number, string> = {
  20: "ftp-data",
  21: "ftp",
  22: "ssh",
  23: "telnet",
  25: "smtp",
  53: "dns",
  69: "tftp",
  80: "http",
  110: "pop3",
  111: "rpcbind",
  123: "ntp",
  135: "msrpc",
  139: "netbios",
  143: "imap",
  161: "snmp",
  389: "ldap",
  443: "https",
  445: "smb",
  465: "smtps",
  514: "syslog",
  548: "afp",
  587: "submission",
  631: "ipp",
  636: "ldaps",
  873: "rsync",
  993: "imaps",
  995: "pop3s",
  1433: "mssql",
  1521: "oracle",
  1883: "mqtt",
  2049: "nfs",
  2375: "docker",
  2376: "docker-tls",
  3000: "dev-http",
  3306: "mysql",
  3389: "rdp",
  5000: "upnp",
  5432: "postgres",
  5900: "vnc",
  5985: "winrm",
  6379: "redis",
  6443: "k8s-api",
  8006: "proxmox",
  8080: "http-alt",
  8123: "home-assistant",
  8443: "https-alt",
  9000: "portainer",
  9090: "prometheus",
  9100: "node-exporter",
  27017: "mongodb",
  32400: "plex",
};

export const MAX_PORT = 65535;

/**
 * Parses "22,80,443", "1-1024" or a mix ("22, 8000-8100"). Returns unique
 * ports in ascending order; throws with a readable message on bad input.
 */
export function parsePortList(spec: string): number[] {
  const ports = new Set<number>();
  const parts = spec
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("Enter at least one port, e.g. 22,80,443 or 1-1024");

  const asPort = (text: string): number => {
    if (!/^\d+$/.test(text)) throw new Error(`"${text}" is not a port number`);
    const port = Number(text);
    if (port < 1 || port > MAX_PORT) throw new Error(`Port ${port} is outside 1-${MAX_PORT}`);
    return port;
  };

  for (const part of parts) {
    const range = part.split("-").map((p) => p.trim());
    if (range.length === 1) {
      ports.add(asPort(range[0]));
    } else if (range.length === 2) {
      const start = asPort(range[0]);
      const end = asPort(range[1]);
      if (start > end) throw new Error(`Range ${part} runs backwards`);
      for (let p = start; p <= end; p++) ports.add(p);
    } else {
      throw new Error(`"${part}" is not a port or range`);
    }
  }
  return Array.from(ports).sort((a, b) => a - b);
}

export type ProbeResult =
  | { state: "open"; latencyMs: number }
  /** The host answered with a reset: it's up, the port is closed. */
  | { state: "closed" }
  /** No answer before the timeout, or another network error. */
  | { state: "filtered" };

/** One TCP connect attempt. Never rejects. */
export function probeTcpPort(host: string, port: number, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish({ state: "filtered" }));
    socket.once("connect", () => finish({ state: "open", latencyMs: Math.round(performance.now() - started) }));
    socket.once("error", (err: NodeJS.ErrnoException) =>
      finish(err.code === "ECONNREFUSED" ? { state: "closed" } : { state: "filtered" }),
    );
  });
}

/**
 * Runs `worker` over `items` with at most `concurrency` in flight, stopping
 * early (without starting new items) once `signal` aborts.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!signal.aborted && next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}
