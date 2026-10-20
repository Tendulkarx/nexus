/**
 * TFTP wire format (RFC 1350): 2-byte opcode, then
 *   RRQ/WRQ  filename \0 mode \0
 *   DATA     block(2) data(0–512)
 *   ACK      block(2)
 *   ERROR    code(2) message \0
 * Option negotiation (RFC 2347) isn't supported; clients fall back to 512-byte blocks.
 */
export const BLOCK_SIZE = 512;

export const OP = { RRQ: 1, WRQ: 2, DATA: 3, ACK: 4, ERROR: 5 } as const;

export const ERR = {
  NOT_DEFINED: 0,
  FILE_NOT_FOUND: 1,
  ACCESS_VIOLATION: 2,
  ILLEGAL_OPERATION: 4,
  UNKNOWN_TID: 5,
} as const;

export type TftpPacket =
  | { op: typeof OP.RRQ | typeof OP.WRQ; filename: string; mode: string }
  | { op: typeof OP.DATA; block: number; data: Buffer }
  | { op: typeof OP.ACK; block: number }
  | { op: typeof OP.ERROR; code: number; message: string };

/** Throws on anything malformed; callers answer with an ERROR packet. */
export function parsePacket(buf: Buffer): TftpPacket {
  if (buf.length < 4) throw new Error("Packet too short");
  const op = buf.readUInt16BE(0);
  switch (op) {
    case OP.RRQ:
    case OP.WRQ: {
      const parts = buf.subarray(2).toString("ascii").split("\0");
      if (parts.length < 3 || !parts[0] || !parts[1]) throw new Error("Malformed request");
      return { op, filename: parts[0], mode: parts[1].toLowerCase() };
    }
    case OP.DATA:
      return { op, block: buf.readUInt16BE(2), data: buf.subarray(4) };
    case OP.ACK:
      return { op, block: buf.readUInt16BE(2) };
    case OP.ERROR:
      return { op, code: buf.readUInt16BE(2), message: buf.subarray(4).toString("ascii").replace(/\0.*$/, "") };
    default:
      throw new Error(`Unknown opcode ${op}`);
  }
}

export function dataPacket(block: number, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(OP.DATA, 0);
  header.writeUInt16BE(block & 0xffff, 2);
  return Buffer.concat([header, data]);
}

export function ackPacket(block: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(OP.ACK, 0);
  buf.writeUInt16BE(block & 0xffff, 2);
  return buf;
}

export function errorPacket(code: number, message: string): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(OP.ERROR, 0);
  header.writeUInt16BE(code, 2);
  return Buffer.concat([header, Buffer.from(message, "ascii"), Buffer.from([0])]);
}

/** Splits a file into DATA payloads. A file that's an exact multiple of 512 ends with an empty block, per the RFC. */
export function splitBlocks(content: Buffer): Buffer[] {
  const blocks: Buffer[] = [];
  for (let offset = 0; offset <= content.length; offset += BLOCK_SIZE) {
    blocks.push(content.subarray(offset, offset + BLOCK_SIZE));
  }
  return blocks;
}
