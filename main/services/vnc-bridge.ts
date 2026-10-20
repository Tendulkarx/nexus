/**
 * Moves VNC bytes between noVNC (renderer) and the server stream (main).
 * Each channel belongs to the window that opened it, and its data goes only
 * there — not broadcast like emitToRenderer, since a framebuffer can be many
 * megabytes a second.
 */
import { randomUUID } from "crypto";

import { logger } from "../logger.js";

import { sessionManager } from "./session-manager.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { VncClosedEvent, VncDataEvent } from "@shared/ipc-contract";
import type { WebContents } from "electron";
import type { Duplex } from "stream";

interface Channel {
  stream: Duplex;
  owner: WebContents;
}

export class VncBridge {
  private channels = new Map<string, Channel>();

  async open(sessionId: string, owner: WebContents): Promise<string> {
    const stream = await sessionManager.getVnc(sessionId).openStream();
    const channelId = randomUUID();
    this.channels.set(channelId, { stream, owner });

    const sendToOwner = (channel: string, payload: unknown) => {
      if (!owner.isDestroyed()) owner.send(channel, payload);
    };
    stream.on("data", (chunk: Buffer) => sendToOwner(IPC.vnc.data, { channelId, data: chunk } satisfies VncDataEvent));
    let error: string | undefined;
    stream.on("error", (err: Error) => (error = err.message));
    stream.on("close", () => {
      this.channels.delete(channelId);
      sendToOwner(IPC.vnc.closed, { channelId, error } satisfies VncClosedEvent);
    });
    // The window going away (closed, reloaded) ends its viewers.
    owner.once("destroyed", () => this.close(channelId));

    logger.info("vnc", "Opened VNC channel", { sessionId, channelId });
    return channelId;
  }

  send(channelId: string, data: Uint8Array): void {
    this.channels.get(channelId)?.stream.write(data);
  }

  close(channelId: string): void {
    this.channels.get(channelId)?.stream.destroy();
    this.channels.delete(channelId);
  }
}

export const vncBridge = new VncBridge();
