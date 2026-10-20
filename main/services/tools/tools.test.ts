import * as net from "net";

import { describe, it, expect } from "vitest";

import { compareFileLists } from "./folder-compare.js";
import { cidrFor, expandCidr, intToIpv4, ipv4ToInt, localNetworks } from "./network-scan.js";
import { parsePortList, probeTcpPort, runPool } from "./port-scan.js";

describe("parsePortList", () => {
  it("accepts lists, ranges and a mix, deduped and sorted", () => {
    expect(parsePortList("443, 22,80")).toEqual([22, 80, 443]);
    expect(parsePortList("8000-8003")).toEqual([8000, 8001, 8002, 8003]);
    expect(parsePortList("22,20-23")).toEqual([20, 21, 22, 23]);
    expect(parsePortList("1-65535")).toHaveLength(65535);
  });

  it("rejects empty, non-numeric, out-of-range and backwards input", () => {
    expect(() => parsePortList(" , ")).toThrow(/at least one port/);
    expect(() => parsePortList("ssh")).toThrow(/not a port number/);
    expect(() => parsePortList("0")).toThrow(/outside 1-65535/);
    expect(() => parsePortList("70000")).toThrow(/outside/);
    expect(() => parsePortList("100-10")).toThrow(/backwards/);
    expect(() => parsePortList("1-2-3")).toThrow(/not a port or range/);
  });
});

describe("runPool", () => {
  it("never exceeds the concurrency limit and processes every item", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, new AbortController().signal, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      inFlight--;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("stops starting new items once aborted", async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 1, controller.signal, async (n) => {
      seen.push(n);
      if (n === 2) controller.abort();
    });
    expect(seen).toEqual([1, 2]);
  });
});

describe("probeTcpPort", () => {
  it("reports a listening port as open and a free one as closed", async () => {
    const server = net.createServer((s) => s.destroy());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
      expect((await probeTcpPort("127.0.0.1", port, 1_000)).state).toBe("open");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    expect((await probeTcpPort("127.0.0.1", port, 1_000)).state).toBe("closed");
  });
});

describe("IPv4 helpers", () => {
  it("round-trips addresses", () => {
    expect(intToIpv4(ipv4ToInt("192.168.1.42"))).toBe("192.168.1.42");
    expect(() => ipv4ToInt("192.168.1.300")).toThrow(/not an IPv4 address/);
  });

  it("expands a CIDR without network and broadcast addresses", () => {
    expect(expandCidr("192.168.1.0/30")).toEqual(["192.168.1.1", "192.168.1.2"]);
    expect(expandCidr("192.168.1.77/24")).toHaveLength(254);
    expect(expandCidr("192.168.1.77/24")[0]).toBe("192.168.1.1");
    expect(expandCidr("10.0.0.5/32")).toEqual(["10.0.0.5"]);
    expect(expandCidr("10.0.0.4/31")).toEqual(["10.0.0.4", "10.0.0.5"]);
  });

  it("refuses ranges larger than /22 and malformed input", () => {
    expect(expandCidr("10.0.0.0/22")).toHaveLength(1022);
    expect(() => expandCidr("10.0.0.0/16")).toThrow(/too large/);
    expect(() => expandCidr("10.0.0.0")).toThrow(/not a CIDR/);
  });

  it("derives the network CIDR from address and netmask", () => {
    expect(cidrFor("192.168.1.42", "255.255.255.0")).toBe("192.168.1.0/24");
    expect(cidrFor("10.20.30.40", "255.255.0.0")).toBe("10.20.0.0/16");
  });

  it("lists external IPv4 interfaces, narrowing wide networks to /24", () => {
    const nets = localNetworks({
      lo0: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true, mac: "", cidr: null }],
      en0: [
        { address: "10.20.30.40", netmask: "255.255.0.0", family: "IPv4", internal: false, mac: "", cidr: null },
        { address: "fe80::1", netmask: "ffff::", family: "IPv6", internal: false, mac: "", cidr: null, scopeid: 0 },
      ],
    });
    expect(nets).toEqual([{ interfaceName: "en0", address: "10.20.30.40", cidr: "10.20.30.0/24" }]);
  });
});

describe("compareFileLists", () => {
  it("classifies files as left-only, right-only, different or same, sorted by path", () => {
    const t = 1_700_000_000_000;
    const entries = compareFileLists(
      [
        { relPath: "b.txt", size: 10, mtime: t },
        { relPath: "a.txt", size: 10, mtime: t },
        { relPath: "only-left.txt", size: 1, mtime: t },
        { relPath: "changed.txt", size: 5, mtime: t },
      ],
      [
        { relPath: "a.txt", size: 10, mtime: t + 1_500 },
        { relPath: "b.txt", size: 10, mtime: t + 60_000 },
        { relPath: "changed.txt", size: 6, mtime: t },
        { relPath: "dir/only-right.txt", size: 2, mtime: t },
      ],
    );
    expect(entries.map((e) => [e.relPath, e.status])).toEqual([
      ["a.txt", "same"],
      ["b.txt", "different"],
      ["changed.txt", "different"],
      ["dir/only-right.txt", "right-only"],
      ["only-left.txt", "left-only"],
    ]);
  });
});
