/**
 * A WebSocket-shaped object for noVNC (its Websock.attach() accepts any
 * "raw channel" with send, close, binaryType, the on- handlers, protocol and readyState) that
 * carries bytes over IPC to the TCP stream main opens (vnc:open). No
 * websockify proxy needed, and jump hosts work because main owns the socket.
 *
 * The server speaks first (its RFB version) the instant TCP connects, so data
 * can arrive before vnc:open has told us our channelId. Events for unknown
 * channels are held until the id is known, then replayed or dropped.
 */
import { ipc } from "@renderer/lib/ipc";
import type { VncClosedEvent, VncDataEvent } from "@shared/ipc-contract";

type ReadyState = "connecting" | "open" | "closing" | "closed";

export class VncChannel {
  // Properties noVNC checks for by name; it sets binaryType and the handlers itself.
  binaryType = "arraybuffer";
  protocol = "";
  readyState: ReadyState = "connecting";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  /** Why the connection failed, for the pane to show. */
  error: string | null = null;
  /** Bytes received from the server so far, for the pane's data-rate readout. */
  bytesReceived = 0;
  private channelId: string | null = null;
  private early: (VncDataEvent | VncClosedEvent)[] = [];
  private unsubscribe: (() => void)[] = [];

  constructor(sessionId: string) {
    this.unsubscribe.push(
      ipc.vnc.onData((e) => this.route(e)),
      ipc.vnc.onClosed((e) => this.route(e)),
    );
    void this.open(sessionId);
  }

  private async open(sessionId: string) {
    try {
      const { channelId } = await ipc.vnc.open({ sessionId });
      if (this.readyState === "closed") {
        // Closed by the pane while connecting.
        void ipc.vnc.close({ channelId }).catch(() => {});
        return;
      }
      this.channelId = channelId;
      this.readyState = "open";
      this.onopen?.(new Event("open"));
      const early = this.early;
      this.early = [];
      for (const e of early) this.route(e);
    } catch (err) {
      this.fail(
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
          : String(err),
      );
    }
  }

  private route(e: VncDataEvent | VncClosedEvent) {
    if (this.channelId === null) {
      if (this.readyState === "connecting") this.early.push(e);
      return;
    }
    if (e.channelId !== this.channelId) return;
    if ("data" in e) {
      const { buffer, byteOffset, byteLength } = e.data;
      this.bytesReceived += byteLength;
      this.onmessage?.({ data: buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer });
    } else if (e.error) {
      this.fail(e.error);
    } else {
      this.finish(true, "");
    }
  }

  send(data: ArrayBuffer | Uint8Array) {
    if (this.readyState !== "open" || !this.channelId) return;
    // IPC copies synchronously, so noVNC's reused send buffer is safe to pass as-is.
    ipc.vnc.send({ channelId: this.channelId, data: data instanceof Uint8Array ? data : new Uint8Array(data) });
  }

  close() {
    if (this.readyState === "closed" || this.readyState === "closing") return;
    if (this.channelId) void ipc.vnc.close({ channelId: this.channelId }).catch(() => {});
    this.finish(true, "");
  }

  private fail(message: string) {
    this.error = message;
    this.onerror?.(new Event("error"));
    this.finish(false, message);
  }

  private finish(wasClean: boolean, reason: string) {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.onclose?.({ code: wasClean ? 1000 : 1006, reason, wasClean });
  }
}
