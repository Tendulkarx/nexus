#!/usr/bin/env node
/**
 * Tiny RFB 3.8 server for trying the VNC viewer without a real VNC server:
 *
 *   node scripts/fake-vnc-server.mjs [--port 5901] [--auth none|vnc] [--size 640x400] [--stress]
 *
 * --stress answers every update request (incremental ones too) with a full
 * frame of a new colour and logs frames/s and MB/s once a second: a
 * benchmark of the viewer pipeline without a network in the way.
 * Serves a 640×400 test pattern (raw encoding). Each key press changes the
 * panel colour and the mouse leaves a trail, so you can see input arrive.
 * --auth vnc asks for a VNC password and accepts any answer (verifying needs
 * DES, which Node's OpenSSL 3 build doesn't ship); it only exercises the
 * login prompt. Dev tool only; never expose it on a network.
 */
import { randomBytes } from "node:crypto";
import net from "node:net";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const PORT = Number(opt("port", "5901"));
const AUTH = opt("auth", "vnc");
const [W, H] = opt("size", "640x400").split("x").map(Number);
const STRESS = args.includes("--stress");
const PALETTE = [
  [139, 233, 253],
  [80, 250, 123],
  [241, 250, 140],
  [255, 122, 112],
  [189, 147, 249],
];

function serve(socket) {
  let buf = Buffer.alloc(0);
  let stage = "version";
  // Client pixel format; noVNC asks for 32bpp true colour.
  let pf = { bpp: 32, bigEndian: false, rShift: 16, gShift: 8, bShift: 0 };
  let colour = 0;
  let wantsUpdate = false;
  let fullFrame = true;
  const dots = [];
  const log = (m) => console.log(`[${socket.remoteAddress}:${socket.remotePort}] ${m}`);

  const pixel = (r, g, b) => {
    const v = (r << pf.rShift) | (g << pf.gShift) | (b << pf.bShift);
    const p = Buffer.alloc(4);
    pf.bigEndian ? p.writeUInt32BE(v >>> 0) : p.writeUInt32LE(v >>> 0);
    return p;
  };
  const rgbAt = (x, y) => {
    const [r, g, b] = PALETTE[colour % PALETTE.length];
    const inPanel = x >= W * 0.19 && x < W * 0.81 && y >= H * 0.25 && y < H * 0.75;
    const stripe = Math.floor(x / 40) % 2 === 0;
    return inPanel ? [r, g, b] : stripe ? [24, 32, 40] : [16, 23, 29];
  };
  const rect = (x, y, w, h, fill) => {
    const header = Buffer.alloc(12);
    header.writeUInt16BE(x, 0);
    header.writeUInt16BE(y, 2);
    header.writeUInt16BE(w, 4);
    header.writeUInt16BE(h, 6);
    header.writeInt32BE(0, 8); // raw encoding
    const pixels = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pixels.push(pixel(...fill(x + i, y + j)));
    return Buffer.concat([header, ...pixels]);
  };
  let frames = 0;
  let bytes = 0;
  const meter = STRESS
    ? setInterval(() => {
        if (frames) log(`${frames} frames/s, ${(bytes / 1e6).toFixed(1)} MB/s at ${W}x${H}`);
        frames = 0;
        bytes = 0;
      }, 1000)
    : null;
  socket.on("close", () => meter && clearInterval(meter));
  // A full frame is built once per colour: per-pixel Buffer.concat is far too slow at Retina sizes.
  const frameCache = new Map();
  const fullRect = () => {
    const format = `${pf.rShift}:${pf.gShift}:${pf.bShift}:${pf.bigEndian}`;
    const key = `${colour % PALETTE.length}:${format}`;
    if (!frameCache.has(key)) {
      // Only a pixel-format change invalidates frames; one per palette colour is kept.
      for (const k of frameCache.keys()) if (!k.endsWith(format)) frameCache.delete(k);
      const header = Buffer.alloc(12);
      header.writeUInt16BE(W, 4);
      header.writeUInt16BE(H, 6);
      const body = Buffer.alloc(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pixel(...rgbAt(x, y)).copy(body, (y * W + x) * 4);
      frameCache.set(key, Buffer.concat([header, body]));
    }
    return frameCache.get(key);
  };
  const flush = () => {
    if (STRESS && wantsUpdate) {
      colour++;
      fullFrame = true;
    }
    if (!wantsUpdate || (!fullFrame && dots.length === 0)) return;
    const rects = fullFrame ? [fullRect()] : dots.splice(0).map(([x, y]) => rect(x, y, 4, 4, () => [255, 255, 255]));
    fullFrame = false;
    wantsUpdate = false;
    const head = Buffer.from([0, 0, 0, 0]);
    head.writeUInt16BE(rects.length, 2);
    const out = Buffer.concat([head, ...rects]);
    frames++;
    bytes += out.length;
    socket.write(out);
  };

  socket.write("RFB 003.008\n");
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (stage === "version") {
        if (buf.length < 12) return;
        log(`client ${buf.subarray(0, 11).toString()}`);
        buf = buf.subarray(12);
        socket.write(Buffer.from([1, AUTH === "none" ? 1 : 2]));
        stage = "security";
      } else if (stage === "security") {
        if (buf.length < 1) return;
        buf = buf.subarray(1);
        if (AUTH === "none") {
          socket.write(Buffer.from([0, 0, 0, 0]));
          stage = "init";
        } else {
          socket.write(randomBytes(16));
          stage = "auth";
        }
      } else if (stage === "auth") {
        if (buf.length < 16) return;
        buf = buf.subarray(16);
        log("password response received (accepted)");
        socket.write(Buffer.from([0, 0, 0, 0]));
        stage = "init";
      } else if (stage === "init") {
        if (buf.length < 1) return;
        buf = buf.subarray(1);
        const name = Buffer.from("Nexus test pattern");
        const init = Buffer.alloc(24);
        init.writeUInt16BE(W, 0);
        init.writeUInt16BE(H, 2);
        Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]).copy(init, 4);
        init.writeUInt32BE(name.length, 20);
        socket.write(Buffer.concat([init, name]));
        stage = "normal";
      } else {
        if (buf.length < 1) return;
        const type = buf[0];
        const need = { 0: 20, 2: 4, 3: 10, 4: 8, 5: 6, 6: 8 }[type];
        if (need === undefined) return socket.destroy(new Error(`unknown message ${type}`));
        if (buf.length < need) return;
        if (type === 2) {
          const total = 4 + buf.readUInt16BE(2) * 4;
          if (buf.length < total) return;
          buf = buf.subarray(total);
          continue;
        }
        if (type === 6) {
          const total = 8 + buf.readUInt32BE(4);
          if (buf.length < total) return;
          log(`clipboard from client: ${JSON.stringify(buf.subarray(8, total).toString("latin1"))}`);
          buf = buf.subarray(total);
          continue;
        }
        const msg = buf.subarray(0, need);
        buf = buf.subarray(need);
        if (type === 0) {
          pf = { bpp: msg[4], bigEndian: msg[6] === 1, rShift: msg[14], gShift: msg[15], bShift: msg[16] };
          fullFrame = true;
        } else if (type === 3) {
          wantsUpdate = true;
          if (msg[1] === 0) fullFrame = true;
          flush();
        } else if (type === 4 && msg[1] === 1) {
          colour++;
          fullFrame = true;
          log(`key down 0x${msg.readUInt32BE(4).toString(16)}`);
          flush();
        } else if (type === 5) {
          const x = msg.readUInt16BE(2);
          const y = msg.readUInt16BE(4);
          if (x < W - 4 && y < H - 4) dots.push([x, y]);
          flush();
        }
      }
    }
  });
  socket.on("error", () => {});
  socket.on("close", () => log("disconnected"));
}

net.createServer(serve).listen(PORT, "127.0.0.1", () => console.log(`fake VNC server on 127.0.0.1:${PORT} (auth: ${AUTH})`));
