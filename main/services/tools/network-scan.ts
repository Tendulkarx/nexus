/**
 * Subnet discovery: a host counts as live if it answers one ping or any TCP
 * probe of a few common ports — a refused connection proves the host is up
 * even when ICMP is blocked. Uses the system `ping` because raw ICMP sockets
 * need root.
 */
import { execFile } from "child_process";
import { promises as dns } from "dns";
import * as os from "os";

import { probeTcpPort } from "./port-scan.js";

import type { LocalNetwork, NetworkHost } from "@shared/ipc-contract";

/** Smallest prefix accepted: a /22 is 1022 hosts, which a scan covers in well under a minute. */
export const MIN_PREFIX = 22;

/** Ports probed on every address: remote access, web, file sharing, Proxmox. */
export const DISCOVERY_PORTS = [22, 80, 443, 445, 3389, 8006];

export function ipv4ToInt(address: string): number {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) {
    throw new Error(`"${address}" is not an IPv4 address`);
  }
  return parts.reduce((acc, p) => acc * 256 + Number(p), 0);
}

export function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join(".");
}

/**
 * Host addresses in an IPv4 CIDR. Network and broadcast addresses are left
 * out except for /31 and /32, where every address is a host.
 */
export function expandCidr(cidr: string): string[] {
  const match = /^\s*([\d.]+)\/(\d{1,2})\s*$/.exec(cidr);
  if (!match) throw new Error(`"${cidr}" is not a CIDR range like 192.168.1.0/24`);
  const prefix = Number(match[2]);
  if (prefix > 32) throw new Error(`/${prefix} is not a valid prefix`);
  if (prefix < MIN_PREFIX) throw new Error(`/${prefix} is too large to scan; use /${MIN_PREFIX} or smaller`);

  const size = 2 ** (32 - prefix);
  const network = ipv4ToInt(match[1]) - (ipv4ToInt(match[1]) % size);
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? network + size - 1 : network + size - 2;
  const hosts: string[] = [];
  for (let v = first; v <= last; v++) hosts.push(intToIpv4(v));
  return hosts;
}

/** Network address for an interface address and netmask, as CIDR. */
export function cidrFor(address: string, netmask: string): string {
  const mask = ipv4ToInt(netmask);
  const prefix = mask.toString(2).replace(/0+$/, "").length;
  const size = 2 ** (32 - prefix);
  const network = ipv4ToInt(address) - (ipv4ToInt(address) % size);
  return `${intToIpv4(network)}/${prefix}`;
}

/** Non-internal IPv4 interfaces, narrowed to at most /24 so the default scan stays quick. */
export function localNetworks(interfaces = os.networkInterfaces()): LocalNetwork[] {
  const result: LocalNetwork[] = [];
  for (const [interfaceName, addrs] of Object.entries(interfaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const cidr = cidrFor(a.address, a.netmask);
      const prefix = Number(cidr.split("/")[1]);
      result.push({
        interfaceName,
        address: a.address,
        cidr: prefix < 24 ? cidrFor(a.address, "255.255.255.0") : cidr,
      });
    }
  }
  return result;
}

/** Round trip in ms from one ping, or null on no reply. */
export function ping(address: string): Promise<number | null> {
  // macOS: -t is the overall timeout in seconds. Linux: -W is the reply wait in seconds (its -t is TTL).
  const args = process.platform === "darwin" ? ["-c", "1", "-t", "1", address] : ["-c", "1", "-W", "1", address];
  return new Promise((resolve) => {
    execFile("/sbin/ping", args, { timeout: 2_000 }, (err, stdout) => {
      if (err) return resolve(null);
      const match = /time[=<]([\d.]+)\s*ms/.exec(stdout);
      resolve(match ? Math.round(Number(match[1])) : 0);
    });
  });
}

async function reverseLookup(address: string): Promise<string | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000));
  const lookup = dns.reverse(address).then(
    (names) => names[0] ?? null,
    () => null,
  );
  return Promise.race([lookup, timeout]);
}

/** Probes one address; null when nothing answers. */
export async function probeHost(address: string): Promise<NetworkHost | null> {
  const [latencyMs, probes] = await Promise.all([
    ping(address),
    Promise.all(DISCOVERY_PORTS.map(async (port) => ({ port, result: await probeTcpPort(address, port, 600) }))),
  ]);
  const answeredTcp = probes.some((p) => p.result.state !== "filtered");
  if (latencyMs === null && !answeredTcp) return null;
  return {
    address,
    hostname: await reverseLookup(address),
    latencyMs,
    openPorts: probes.filter((p) => p.result.state === "open").map((p) => p.port),
  };
}
