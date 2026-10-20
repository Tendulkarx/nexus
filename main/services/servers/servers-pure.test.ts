import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

import { afterAll, beforeAll, describe, it, expect } from "vitest";

import { resolveExisting, resolveForWrite, resolveInside } from "./path-safety.js";
import { ackPacket, dataPacket, errorPacket, OP, parsePacket, splitBlocks } from "./tftp-packets.js";

describe("resolveInside", () => {
  const root = "/srv/share";

  it("maps client paths into the root", () => {
    expect(resolveInside(root, "/firmware/a.bin")).toBe("/srv/share/firmware/a.bin");
    expect(resolveInside(root, "firmware\\a.bin")).toBe("/srv/share/firmware/a.bin");
    expect(resolveInside(root, "/")).toBe("/srv/share");
  });

  it("clamps .. and absolute paths at the root instead of escaping", () => {
    expect(resolveInside(root, "../../etc/passwd")).toBe("/srv/share/etc/passwd");
    expect(resolveInside(root, "/../..")).toBe("/srv/share");
    expect(resolveInside(root, "a/../../b")).toBe("/srv/share/b");
  });
});

describe("resolveExisting / resolveForWrite", () => {
  let tmp: string;
  let root: string;

  beforeAll(async () => {
    tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nexus-paths-")));
    root = path.join(tmp, "share");
    await fs.mkdir(path.join(root, "sub"), { recursive: true });
    await fs.writeFile(path.join(root, "sub", "ok.txt"), "ok");
    await fs.writeFile(path.join(tmp, "secret.txt"), "secret");
    await fs.symlink(path.join(tmp, "secret.txt"), path.join(root, "escape.txt"));
    await fs.symlink(tmp, path.join(root, "escape-dir"));
  });

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("allows real files inside the root", async () => {
    expect(await resolveExisting(root, "sub/ok.txt")).toBe(path.join(root, "sub", "ok.txt"));
  });

  it("rejects symlinks that lead outside the root", async () => {
    await expect(resolveExisting(root, "escape.txt")).rejects.toThrow(/outside the shared folder/);
    await expect(resolveExisting(root, "escape-dir/secret.txt")).rejects.toThrow(/outside/);
  });

  it("allows new files in existing folders and refuses writes through links or onto the root", async () => {
    expect(await resolveForWrite(root, "sub/new.cfg")).toBe(path.join(root, "sub", "new.cfg"));
    await expect(resolveForWrite(root, "escape.txt")).rejects.toThrow(/outside/);
    await expect(resolveForWrite(root, "escape-dir/new.cfg")).rejects.toThrow(/outside/);
    await expect(resolveForWrite(root, "/")).rejects.toThrow(/outside/);
  });
});

describe("TFTP packets", () => {
  it("parses read and write requests", () => {
    const rrq = Buffer.concat([Buffer.from([0, 1]), Buffer.from("fw/boot.bin\0OCTET\0", "ascii")]);
    expect(parsePacket(rrq)).toEqual({ op: OP.RRQ, filename: "fw/boot.bin", mode: "octet" });
    const wrq = Buffer.concat([Buffer.from([0, 2]), Buffer.from("switch.cfg\0netascii\0", "ascii")]);
    expect(parsePacket(wrq)).toMatchObject({ op: OP.WRQ, filename: "switch.cfg" });
  });

  it("round-trips DATA, ACK and ERROR", () => {
    expect(parsePacket(dataPacket(7, Buffer.from("hi")))).toEqual({ op: OP.DATA, block: 7, data: Buffer.from("hi") });
    expect(parsePacket(ackPacket(65536))).toEqual({ op: OP.ACK, block: 0 });
    expect(parsePacket(errorPacket(1, "File not found"))).toEqual({ op: OP.ERROR, code: 1, message: "File not found" });
  });

  it("rejects short and unknown packets", () => {
    expect(() => parsePacket(Buffer.from([0, 1]))).toThrow(/too short/);
    expect(() => parsePacket(Buffer.from([0, 9, 0, 0]))).toThrow(/Unknown opcode/);
    expect(() => parsePacket(Buffer.from([0, 1, 0, 0]))).toThrow(/Malformed/);
  });

  it("ends every transfer with a short block, adding an empty one for exact multiples", () => {
    expect(splitBlocks(Buffer.alloc(0)).map((b) => b.length)).toEqual([0]);
    expect(splitBlocks(Buffer.alloc(700)).map((b) => b.length)).toEqual([512, 188]);
    expect(splitBlocks(Buffer.alloc(1024)).map((b) => b.length)).toEqual([512, 512, 0]);
  });
});
