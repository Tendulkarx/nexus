/**
 * SSH bootstrap helpers shared by SshSession (SFTP/SSH file sessions) and
 * MoshSession (which opens a plain ssh2 Client purely to run `mosh-server`
 * remotely and read its bootstrap output — see mosh-session.ts).
 */
import * as fsp from "fs/promises";

import { dialog } from "electron";
import { Client } from "ssh2";

import { fingerprintKey, knownHostsStore } from "../known-hosts-store.js";
import { logger } from "../../logger.js";

import type { JumpHost } from "@shared/ipc-contract";
import type { ClientChannel, ConnectConfig } from "ssh2";

/**
 * Trust-on-first-use host key verification. First connection to a host:port
 * records its key fingerprint; later connections compare against it and
 * block (with a native warning dialog) on mismatch, since that indicates a
 * possible MITM attack or a reinstalled/rotated server host key.
 */
export async function verifyHostKey(host: string, port: number, key: Buffer): Promise<boolean> {
  const fingerprint = fingerprintKey(key);
  const stored = await knownHostsStore.get(host, port);

  if (!stored) {
    await knownHostsStore.trust(host, port, fingerprint);
    logger.info("ssh", "Trusting new host key on first use", { host, port });
    return true;
  }

  if (stored === fingerprint) {
    return true;
  }

  logger.warn("ssh", "Host key mismatch — possible MITM or reinstalled server", { host, port });
  const result = await dialog.showMessageBox({
    type: "warning",
    title: "Host Key Changed",
    message: `The host key for ${host}:${port} has changed since you last connected.`,
    detail:
      "This could mean the server was reinstalled or its key was rotated — or it could mean someone is " +
      "intercepting your connection. Only continue if you're sure this is expected.",
    buttons: ["Cancel", "Connect Anyway"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });

  if (result.response === 1) {
    await knownHostsStore.trust(host, port, fingerprint);
    logger.warn("ssh", "User accepted new host key after mismatch warning", { host, port });
    return true;
  }

  return false;
}

/**
 * Connects to a jump/bastion host as a plain ssh2 Client (no SFTP needed
 * there), then opens a direct-tcpip channel through it to the real target.
 * That channel is handed to the target's own connection as `sock`, so the
 * target's SSH handshake tunnels entirely inside the jump host's
 * already-authenticated connection instead of a second real TCP connection.
 */
export async function connectViaJumpHost(
  jump: JumpHost,
  jumpSecret: string | null,
  targetHost: string,
  targetPort: number,
): Promise<{ client: Client; sock: ClientChannel }> {
  const jumpHostAddr = jump.host;
  const jumpPort = jump.port || 22;
  const config: ConnectConfig = {
    host: jumpHostAddr,
    port: jumpPort,
    username: jump.username,
    readyTimeout: 20_000,
    keepaliveInterval: 15_000,
    hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
      verifyHostKey(jumpHostAddr, jumpPort, key)
        .then(verify)
        .catch((err) => {
          logger.error("ssh", "Jump host key verification failed", err);
          verify(false);
        });
    },
  };

  if (jump.authType === "key") {
    if (!jump.privateKeyPath) {
      throw new Error("Jump host key authentication selected but no private key file was provided");
    }
    config.privateKey = await fsp.readFile(jump.privateKeyPath);
    if (jumpSecret) config.passphrase = jumpSecret;
  } else {
    if (!jumpSecret) throw new Error("No password provided for the jump host connection");
    config.password = jumpSecret;
  }

  const client = new Client();
  await new Promise<void>((resolve, reject) => {
    client.once("ready", resolve);
    client.once("error", reject);
    client.connect(config);
  });

  try {
    const sock = await new Promise<ClientChannel>((resolve, reject) => {
      client.forwardOut("127.0.0.1", 0, targetHost, targetPort, (err, stream) => {
        if (err) reject(err);
        else resolve(stream);
      });
    });
    return { client, sock };
  } catch (err) {
    client.end();
    throw err;
  }
}
