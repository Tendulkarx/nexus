/**
 * An RDP "display" session — unlike SshSession/FtpSession (which are
 * filesystem-shaped: list/mkdir/rename/delete/upload/download), a display
 * session's pixels are rendered by a native macOS view composited directly
 * into the BrowserWindow (see native-display-host.ts), not by anything the
 * renderer draws. This class just tracks the connection profile/credentials
 * and proxies the connect/resize/close lifecycle to that native layer.
 *
 * Deliberately NOT a BaseSession subclass — BaseSession's abstract methods
 * are all filesystem operations that have no meaning for a remote desktop.
 */
import { BrowserWindow } from "electron";

import { logger } from "../../logger.js";
import { knownHostsStore } from "../known-hosts-store.js";
import { nativeDisplayHost } from "../native-display-host.js";

import type { ConnectionProfile } from "@shared/ipc-contract";
import type { DisplayBounds, DisplaySessionState, DisplayTrustPromptEvent, SessionInfo } from "@shared/ipc-contract";

export class DisplaySession {
  readonly info: SessionInfo;
  private readonly profile: ConnectionProfile;
  private readonly secret: string | null;
  private nativeStarted = false;
  private statusListeners = new Set<(state: DisplaySessionState, message?: string) => void>();
  private trustListeners = new Set<(event: Omit<DisplayTrustPromptEvent, "sessionId">) => void>();
  /** The fingerprint most recently handed to a trust listener, awaiting resolveTrust() — see handleCertificateVerify. */
  private pendingTrustFingerprint: string | null = null;

  constructor(sessionId: string, profile: ConnectionProfile, secret: string | null) {
    if (profile.protocol !== "rdp") {
      throw new Error(`DisplaySession created for non-display protocol: ${profile.protocol}`);
    }
    this.profile = profile;
    this.secret = secret;
    this.info = {
      sessionId,
      profileId: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      host: profile.host,
      username: profile.username,
      homeDir: "",
      supportsTerminal: false,
      kind: "display",
    };
  }

  onStatus(listener: (state: DisplaySessionState, message?: string) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private emitStatus(state: DisplaySessionState, message?: string): void {
    for (const listener of this.statusListeners) listener(state, message);
  }

  /** Fires when the native layer needs a trust decision for the server's TLS certificate — see handleCertificateVerify. */
  onTrustPrompt(listener: (event: Omit<DisplayTrustPromptEvent, "sessionId">) => void): () => void {
    this.trustListeners.add(listener);
    return () => this.trustListeners.delete(listener);
  }

  private emitTrustPrompt(event: Omit<DisplayTrustPromptEvent, "sessionId">): void {
    for (const listener of this.trustListeners) listener(event);
  }

  /**
   * Trust-on-first-use for the RDP TLS certificate, mirroring SshSession's
   * verifyHostKey — same store (known-hosts-store.ts), same "sha256
   * fingerprint" model, just keyed under the "rdp" protocol. Called from
   * native-display-host.ts's onCertificateVerify, itself invoked (via
   * addon.mm) from rdp_backend.mm's NexusVerifyCertificateEx, which BLOCKS
   * the native connect handshake on its own background thread until
   * resolveTrust() answers — so this must always eventually call
   * nativeDisplayHost.resolveCertificateTrust, on every path, including errors.
   */
  private async handleCertificateVerify(fingerprint: string): Promise<void> {
    const { host, port } = this.profile;
    try {
      const stored = await knownHostsStore.get("rdp", host, port);
      if (stored === fingerprint) {
        nativeDisplayHost.resolveCertificateTrust(this.info.sessionId, true);
        return;
      }
      const changed = stored !== null;
      if (changed) {
        logger.warn("display-session", "RDP certificate fingerprint changed — possible MITM", {
          sessionId: this.info.sessionId,
          host,
          port,
        });
      }
      this.pendingTrustFingerprint = fingerprint;
      this.emitTrustPrompt({ fingerprint, changed, previousFingerprint: stored });
    } catch (err) {
      logger.error("display-session", "RDP certificate verification failed", { sessionId: this.info.sessionId, err });
      nativeDisplayHost.resolveCertificateTrust(this.info.sessionId, false);
    }
  }

  /** Answers the trust prompt raised by handleCertificateVerify — called from the display:trustDecision IPC handler. */
  async resolveTrust(trusted: boolean): Promise<void> {
    const fingerprint = this.pendingTrustFingerprint;
    this.pendingTrustFingerprint = null;
    if (trusted && fingerprint) {
      await knownHostsStore.trust("rdp", this.profile.host, this.profile.port, fingerprint);
    }
    nativeDisplayHost.resolveCertificateTrust(this.info.sessionId, trusted);
  }

  /** Starts (or, if already started, no-ops) the native view + RDP session, attached to `window` at `bounds`. */
  connectNative(window: BrowserWindow, bounds: DisplayBounds): void {
    if (this.nativeStarted) {
      this.resizeNative(bounds);
      return;
    }
    this.nativeStarted = true;
    this.emitStatus("connecting");
    try {
      nativeDisplayHost.connect({
        sessionId: this.info.sessionId,
        protocol: this.profile.protocol as "rdp",
        host: this.profile.host,
        port: this.profile.port,
        username: this.profile.username,
        secret: this.secret,
        nativeWindowHandle: window.getNativeWindowHandle(),
        bounds,
        onStatus: (state, message) => this.emitStatus(state, message),
        onCertificateVerify: (fingerprint) => void this.handleCertificateVerify(fingerprint),
      });
    } catch (err) {
      this.nativeStarted = false;
      const message = err instanceof Error ? err.message : String(err);
      logger.error("display-session", "Failed to start native display session", { sessionId: this.info.sessionId, message });
      this.emitStatus("error", message);
      throw err;
    }
  }

  resizeNative(bounds: DisplayBounds): void {
    if (!this.nativeStarted) return;
    try {
      nativeDisplayHost.resize(this.info.sessionId, bounds);
    } catch (err) {
      logger.warn("display-session", "Resize failed", { sessionId: this.info.sessionId, err });
    }
  }

  async close(): Promise<void> {
    if (this.nativeStarted) {
      nativeDisplayHost.destroy(this.info.sessionId);
      this.nativeStarted = false;
    }
    this.emitStatus("closed");
    this.statusListeners.clear();
    this.trustListeners.clear();
  }
}
