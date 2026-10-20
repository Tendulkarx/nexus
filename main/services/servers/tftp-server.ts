/**
 * TFTP server (RFC 1350) for firmware and config files: the usual way
 * switches, routers, IP phones and PXE boot fetch files. Each transfer gets
 * its own UDP socket (its "TID"), as the RFC requires. Lock-step with a 2 s
 * retransmit, 5 tries per block. Uploads (WRQ) are refused unless allowWrites
 * is on, and are written to a temp file that replaces the target only once
 * the whole file has arrived.
 */
import * as dgram from "dgram";
import { promises as fs } from "fs";
import * as path from "path";

import { OutsideRootError, resolveExisting, resolveForWrite } from "./path-safety.js";
import { ackPacket, BLOCK_SIZE, dataPacket, ERR, errorPacket, OP, parsePacket, splitBlocks } from "./tftp-packets.js";

import type { RunningServer, ServerStarter } from "./types.js";

const RETRY_MS = 2_000;
const MAX_TRIES = 5;
/** Block numbers are 16-bit; a client that doesn't roll over can't take more than this. */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

interface Peer {
  address: string;
  port: number;
}

/** A per-transfer socket bound to the request's interface, talking only to the one client. */
function openTransferSocket(host: string): Promise<dgram.Socket> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", reject);
    socket.bind(0, host, () => resolve(socket));
  });
}

/** Resolves once the packet has left, so the socket can be closed right after without dropping it. */
function sendAndFlush(socket: dgram.Socket, peer: Peer, packet: Buffer): Promise<void> {
  return new Promise((resolve) => socket.send(packet, peer.port, peer.address, () => resolve()));
}

/** Sends `packet` and waits for an acceptable reply, retransmitting on timeout. */
function exchange(
  socket: dgram.Socket,
  peer: Peer,
  packet: Buffer,
  accept: (reply: Buffer) => boolean,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let tries = 0;
    let timer: NodeJS.Timeout;
    const onMessage = (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      if (rinfo.address !== peer.address || rinfo.port !== peer.port) {
        // Another host poking this transfer's port: tell it off, keep waiting.
        socket.send(errorPacket(ERR.UNKNOWN_TID, "Unknown transfer ID"), rinfo.port, rinfo.address);
        return;
      }
      // accept() throws when the client sends ERROR; that ends this transfer, not the process.
      let accepted: boolean;
      try {
        accepted = accept(msg);
      } catch (err) {
        return finish(() => reject(err));
      }
      if (accepted) finish(() => resolve(msg));
    };
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      settle();
    };
    const send = () => {
      if (++tries > MAX_TRIES) return finish(() => reject(new Error("timed out")));
      try {
        socket.send(packet, peer.port, peer.address);
      } catch (err) {
        // The socket was closed under us (server stopping).
        return finish(() => reject(err));
      }
      timer = setTimeout(send, RETRY_MS);
    };
    socket.on("message", onMessage);
    send();
  });
}

/** Accepts the matching ACK, throws on a client ERROR, and ignores anything else (malformed or duplicate packets). */
function isAck(block: number) {
  return (msg: Buffer) => {
    let p;
    try {
      p = parsePacket(msg);
    } catch {
      return false;
    }
    if (p.op === OP.ERROR) throw new Error(`client aborted: ${p.message}`);
    return p.op === OP.ACK && p.block === (block & 0xffff);
  };
}

async function sendFile(socket: dgram.Socket, peer: Peer, content: Buffer): Promise<void> {
  const blocks = splitBlocks(content);
  for (let i = 0; i < blocks.length; i++) {
    await exchange(socket, peer, dataPacket(i + 1, blocks[i]), isAck(i + 1));
  }
}

async function receiveFile(socket: dgram.Socket, peer: Peer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let received = 0;
  let expected = 1;
  let ack = ackPacket(0);
  for (;;) {
    const reply = await exchange(socket, peer, ack, (msg) => {
      let p;
      try {
        p = parsePacket(msg);
      } catch {
        return false;
      }
      if (p.op === OP.ERROR) throw new Error(`client aborted: ${p.message}`);
      return p.op === OP.DATA && p.block === (expected & 0xffff);
    });
    const packet = parsePacket(reply) as { op: typeof OP.DATA; block: number; data: Buffer };
    received += packet.data.length;
    if (received > MAX_UPLOAD_BYTES) throw new Error("upload too large");
    chunks.push(packet.data);
    ack = ackPacket(expected);
    if (packet.data.length < BLOCK_SIZE) {
      await sendAndFlush(socket, peer, ack);
      return Buffer.concat(chunks);
    }
    expected++;
  }
}

export const startTftpServer: ServerStarter = async ({ config, host, log }) => {
  const root = config.rootDir!;
  const listener = dgram.createSocket("udp4");
  const transfers = new Set<dgram.Socket>();

  async function handle(msg: Buffer, peer: Peer) {
    const socket = await openTransferSocket(host);
    transfers.add(socket);
    const who = `${peer.address}:${peer.port}`;
    const fail = async (code: number, message: string) => {
      log(`${who} ${message}`);
      await sendAndFlush(socket, peer, errorPacket(code, message));
    };
    try {
      const request = parsePacket(msg);
      if (request.op !== OP.RRQ && request.op !== OP.WRQ)
        return await fail(ERR.ILLEGAL_OPERATION, "Expected a read or write request");
      if (request.mode === "mail") return await fail(ERR.ILLEGAL_OPERATION, "Mail mode isn't supported");

      if (request.op === OP.RRQ) {
        let target: string;
        try {
          target = await resolveExisting(root, request.filename);
        } catch (err) {
          return await fail(
            err instanceof OutsideRootError ? ERR.ACCESS_VIOLATION : ERR.FILE_NOT_FOUND,
            `No such file: ${request.filename}`,
          );
        }
        const content = await fs.readFile(target).catch(() => null);
        if (!content) return await fail(ERR.FILE_NOT_FOUND, `Can't read ${request.filename}`);
        log(`${who} reading ${request.filename} (${content.length} bytes)`);
        await sendFile(socket, peer, content);
        log(`${who} sent ${request.filename}`);
      } else {
        if (!config.allowWrites)
          return await fail(ERR.ACCESS_VIOLATION, `Upload of ${request.filename} refused (uploads are off)`);
        let target: string;
        try {
          target = await resolveForWrite(root, request.filename);
        } catch {
          return await fail(ERR.ACCESS_VIOLATION, `Can't write ${request.filename}`);
        }
        log(`${who} uploading ${request.filename}`);
        const content = await receiveFile(socket, peer);
        const temp = path.join(path.dirname(target), `.${path.basename(target)}.nexus-upload`);
        await fs.writeFile(temp, content);
        await fs.rename(temp, target);
        log(`${who} saved ${request.filename} (${content.length} bytes)`);
      }
    } catch (err) {
      log(`${who} transfer failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // stop() may already have closed it.
      if (transfers.delete(socket)) socket.close();
    }
  }

  listener.on("message", (msg, rinfo) => void handle(msg, { address: rinfo.address, port: rinfo.port }));
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.bind(config.port, host, () => resolve());
  });
  log(`Serving ${root}${config.allowWrites ? " (uploads allowed)" : " (read-only)"}`);

  const running: RunningServer = {
    stop: async () => {
      for (const socket of transfers) socket.close();
      transfers.clear();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    },
  };
  return running;
};
