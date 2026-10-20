/**
 * Runs each server on 127.0.0.1 with an ephemeral-ish port and talks to it
 * with a real client: HTTP via fetch, TFTP via raw UDP, SFTP via ssh2.
 */
import * as dgram from "dgram";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

import { Client } from "ssh2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startHttpServer } from "./http-server.js";
import { startSftpServer } from "./sftp-server.js";
import { startTftpServer } from "./tftp-server.js";
import { ackPacket, dataPacket, OP, parsePacket } from "./tftp-packets.js";

import type { LocalServerConfig } from "@shared/ipc-contract";
import type { ServerContext } from "./types.js";

let tmp: string;
let root: string;
const PORT_BASE = 20_000 + Math.floor(Math.random() * 20_000);

function ctx(config: Partial<LocalServerConfig> & Pick<LocalServerConfig, "kind" | "port">): ServerContext {
  return {
    config: { rootDir: root, lan: false, allowWrites: false, ...config },
    host: "127.0.0.1",
    dataDir: tmp,
    log: () => {},
    onFatal: () => {},
  };
}

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nexus-servers-")));
  root = path.join(tmp, "share");
  await fs.mkdir(path.join(root, "fw"), { recursive: true });
  await fs.writeFile(path.join(root, "fw", "boot.bin"), Buffer.alloc(1300, 7));
  await fs.writeFile(path.join(root, "hello.txt"), "hello");
  await fs.writeFile(path.join(tmp, "secret.txt"), "secret");
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("HTTP server", () => {
  it("serves files and listings, and never anything outside the folder", async () => {
    const port = PORT_BASE;
    const server = await startHttpServer(ctx({ kind: "http", port }));
    try {
      const base = `http://127.0.0.1:${port}`;
      expect(await (await fetch(`${base}/hello.txt`)).text()).toBe("hello");
      const listing = await (await fetch(`${base}/`)).text();
      expect(listing).toContain("hello.txt");
      expect(listing).toContain("fw/");
      expect((await fetch(`${base}/../secret.txt`)).status).toBe(404);
      expect((await fetch(`${base}/%2e%2e/secret.txt`)).status).toBe(404);
      expect((await fetch(`${base}/hello.txt`, { method: "PUT", body: "x" })).status).toBe(405);
    } finally {
      await server.stop();
    }
  });
});

/** Minimal TFTP client: one request, then ACK every DATA until a short block. */
async function tftpGet(port: number, filename: string): Promise<Buffer | string> {
  const socket = dgram.createSocket("udp4");
  await new Promise<void>((r) => socket.bind(0, "127.0.0.1", () => r()));
  try {
    return await new Promise((resolve) => {
      const chunks: Buffer[] = [];
      socket.on("message", (msg, rinfo) => {
        const p = parsePacket(msg);
        if (p.op === OP.ERROR) return resolve(p.message);
        if (p.op !== OP.DATA) return;
        chunks.push(p.data);
        socket.send(ackPacket(p.block), rinfo.port, rinfo.address);
        if (p.data.length < 512) resolve(Buffer.concat(chunks));
      });
      const rrq = Buffer.concat([Buffer.from([0, OP.RRQ]), Buffer.from(`${filename}\0octet\0`)]);
      socket.send(rrq, port, "127.0.0.1");
    });
  } finally {
    socket.close();
  }
}

async function tftpPut(port: number, filename: string, content: Buffer): Promise<string> {
  const socket = dgram.createSocket("udp4");
  await new Promise<void>((r) => socket.bind(0, "127.0.0.1", () => r()));
  try {
    return await new Promise((resolve) => {
      socket.on("message", (msg, rinfo) => {
        const p = parsePacket(msg);
        if (p.op === OP.ERROR) return resolve(`error: ${p.message}`);
        if (p.op !== OP.ACK) return;
        const next = p.block + 1;
        const chunk = content.subarray((next - 1) * 512, next * 512);
        if (p.block > 0 && (p.block - 1) * 512 + 512 > content.length) return resolve("ok");
        socket.send(dataPacket(next, chunk), rinfo.port, rinfo.address);
      });
      const wrq = Buffer.concat([Buffer.from([0, OP.WRQ]), Buffer.from(`${filename}\0octet\0`)]);
      socket.send(wrq, port, "127.0.0.1");
    });
  } finally {
    socket.close();
  }
}

describe("TFTP server", () => {
  it("sends a multi-block file and refuses escapes and missing files", async () => {
    const port = PORT_BASE + 1;
    const server = await startTftpServer(ctx({ kind: "tftp", port }));
    try {
      const got = await tftpGet(port, "fw/boot.bin");
      expect(Buffer.isBuffer(got) && got.equals(Buffer.alloc(1300, 7))).toBe(true);
      expect(await tftpGet(port, "../secret.txt")).toMatch(/No such file/);
      expect(await tftpGet(port, "nope.bin")).toMatch(/No such file/);
    } finally {
      await server.stop();
    }
  });

  it("refuses uploads when read-only and accepts them when allowed", async () => {
    const readOnly = await startTftpServer(ctx({ kind: "tftp", port: PORT_BASE + 2 }));
    try {
      expect(await tftpPut(PORT_BASE + 2, "switch.cfg", Buffer.from("cfg"))).toMatch(/uploads are off/);
    } finally {
      await readOnly.stop();
    }

    const writable = await startTftpServer(ctx({ kind: "tftp", port: PORT_BASE + 3, allowWrites: true }));
    try {
      const content = Buffer.alloc(700, 1);
      expect(await tftpPut(PORT_BASE + 3, "switch.cfg", content)).toBe("ok");
      await new Promise((r) => setTimeout(r, 50));
      expect((await fs.readFile(path.join(root, "switch.cfg"))).equals(content)).toBe(true);
    } finally {
      await writable.stop();
    }
  });
});

function sftpSession(port: number, password: string): Promise<{ client: Client; sftp: import("ssh2").SFTPWrapper }> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client
      .on("ready", () => client.sftp((err, sftp) => (err ? reject(err) : resolve({ client, sftp }))))
      .on("error", reject)
      .connect({ host: "127.0.0.1", port, username: "tester", password, hostVerifier: () => true });
  });
}

describe("SFTP server", () => {
  it("rejects a wrong password, lists and reads inside the folder, and blocks writes when read-only", async () => {
    const port = PORT_BASE + 4;
    const server = await startSftpServer(ctx({ kind: "sftp", port, username: "tester", password: "s3cret" }));
    try {
      await expect(sftpSession(port, "wrong")).rejects.toThrow(/authentication/i);

      const { client, sftp } = await sftpSession(port, "s3cret");
      try {
        const names = await new Promise<string[]>((res, rej) =>
          sftp.readdir("/", (err, list) => (err ? rej(err) : res(list.map((e) => e.filename).sort()))),
        );
        expect(names).toEqual(expect.arrayContaining(["fw", "hello.txt"]));
        expect(names).not.toContain("secret.txt");

        const text = await new Promise<string>((res, rej) =>
          sftp.readFile("/hello.txt", (err, buf) => (err ? rej(err) : res(buf.toString()))),
        );
        expect(text).toBe("hello");

        await expect(
          new Promise((res, rej) => sftp.readFile("/../secret.txt", (err, buf) => (err ? rej(err) : res(buf)))),
        ).rejects.toThrow();
        await expect(
          new Promise((res, rej) => sftp.writeFile("/new.txt", "x", (err) => (err ? rej(err) : res(null)))),
        ).rejects.toThrow(/read-only|denied/i);
      } finally {
        client.end();
      }
    } finally {
      await server.stop();
    }
  });
});
