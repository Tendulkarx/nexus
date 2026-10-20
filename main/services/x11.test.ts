import { promises as fs } from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";

import ssh2, { Client } from "ssh2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { attachX11Forwarding, parseDisplay, parseXauthList } from "./x11.js";

describe("parseDisplay", () => {
  it("understands XQuartz launchd sockets, local displays and TCP displays", () => {
    expect(parseDisplay("/private/tmp/com.apple.launchd.abc/org.xquartz:0")).toEqual({
      kind: "unix",
      path: "/private/tmp/com.apple.launchd.abc/org.xquartz:0",
    });
    expect(parseDisplay(":0")).toEqual({ kind: "unix", path: "/tmp/.X11-unix/X0" });
    expect(parseDisplay("unix:1.0")).toEqual({ kind: "unix", path: "/tmp/.X11-unix/X1" });
    expect(parseDisplay("localhost:10.0")).toEqual({ kind: "tcp", host: "localhost", port: 6010 });
    expect(parseDisplay("")).toBeNull();
    expect(parseDisplay("nonsense")).toBeNull();
  });
});

describe("parseXauthList", () => {
  it("takes the first cookie line and ignores noise", () => {
    const out =
      "xauth: file /Users/x/.Xauthority does not exist\nosbmac1/unix:0  MIT-MAGIC-COOKIE-1  a1b2c3d4e5f60718\n";
    expect(parseXauthList(out)).toEqual({ protocol: "MIT-MAGIC-COOKIE-1", cookie: "a1b2c3d4e5f60718" });
    expect(parseXauthList("")).toBeNull();
  });
});

describe("attachX11Forwarding", () => {
  let tmp: string;
  let xSocket: string;
  let xServer: net.Server;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-x11-"));
    xSocket = path.join(tmp, "X0");
    // A fake X server: answers whatever it's sent in upper case.
    xServer = net.createServer((sock) => sock.on("data", (d) => sock.write(d.toString().toUpperCase())));
    await new Promise<void>((r) => xServer.listen(xSocket, () => r()));
  });

  afterAll(async () => {
    await new Promise((r) => xServer.close(r));
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("asks for X11 on the shell and relays X11 channels to the local display", async () => {
    const { private: hostKey } = ssh2.utils.generateKeyPairSync("ed25519");
    let x11Requested: { protocol: string; cookie: string } | null = null;

    // Stub SSH server: accepts any login and, once a shell with X11 is open,
    // opens an X11 channel back to the client like a remote `xclock` would.
    const server = new ssh2.Server({ hostKeys: [hostKey] }, (conn) => {
      conn.on("authentication", (ctx) => ctx.accept());
      conn.on("ready", () => {
        conn.on("session", (acceptSession) => {
          const session = acceptSession();
          session.on("x11", (accept, _reject, info) => {
            // ssh2 hands the server the cookie as the raw bytes of its hex text.
            x11Requested = { protocol: info.protocol, cookie: Buffer.from(info.cookie).toString() };
            accept?.();
          });
          session.on("pty", (accept) => accept?.());
          session.on("shell", (accept) => {
            const shell = accept();
            conn.x11("127.0.0.1", 50000, (err, channel) => {
              if (err) return shell.end(`x11 error: ${err.message}\n`);
              channel.on("data", (d: Buffer) => shell.end(`x reply: ${d.toString()}\n`));
              channel.write("hello x");
            });
          });
        });
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as net.AddressInfo).port;

    const client = new Client();
    try {
      await new Promise<void>((resolve, reject) =>
        client
          .on("ready", () => resolve())
          .on("error", reject)
          .connect({ host: "127.0.0.1", port, username: "u", password: "p", hostVerifier: () => true }),
      );
      const forwarding = attachX11Forwarding(
        client,
        { kind: "unix", path: xSocket },
        { protocol: "MIT-MAGIC-COOKIE-1", cookie: "00112233445566778899aabbccddeeff" },
      );
      const output = await new Promise<string>((resolve, reject) =>
        client.shell({ term: "xterm" }, { x11: forwarding.shellOption }, (err, stream) => {
          if (err) return reject(err);
          let text = "";
          stream.on("data", (d: Buffer) => (text += d.toString()));
          stream.on("close", () => resolve(text));
        }),
      );

      expect(x11Requested).toEqual({ protocol: "MIT-MAGIC-COOKIE-1", cookie: "00112233445566778899aabbccddeeff" });
      expect(output).toContain("x reply: HELLO X");
    } finally {
      client.end();
      await new Promise((r) => server.close(r));
    }
  });
});
