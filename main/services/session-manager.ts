/**
 * Owns all live connections keyed by sessionId. Resolves credentials at connect
 * time (decrypting stored secrets or accepting an ad-hoc one) and tears sessions
 * down on disconnect / app quit.
 */
import { randomUUID } from "crypto";

import { logger } from "../logger.js";

import { activityLog } from "./activity-log.js";
import { connectionStore } from "./connection-store.js";
import { credentialVault } from "./credential-vault.js";
import { notify } from "./notification-service.js";
import { BaseSession } from "./sessions/base-session.js";
import { DisplaySession } from "./sessions/display-session.js";
import { FtpSession } from "./sessions/ftp-session.js";
import { SshSession } from "./sessions/ssh-session.js";

import type { ConnectionProfile, SessionConnectRequest, SessionInfo } from "@shared/ipc-contract";

/** Anything SessionManager can track: a filesystem session (BaseSession) or a display session. Both expose `info` + `close()`. */
type ManagedSession = BaseSession | DisplaySession;

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();

  async connect(request: SessionConnectRequest): Promise<SessionInfo> {
    const { profile, secret, jumpSecret } = await this.resolveProfile(request);
    const sessionId = randomUUID();

    // Real switch (not the old two-way ftp/ftps-else-ssh branch) so every
    // protocol is routed explicitly — previously anything that wasn't
    // ftp/ftps silently fell through to SshSession, which would have quietly
    // mishandled rdp instead of erroring.
    let session: ManagedSession;
    switch (profile.protocol) {
      case "ftp":
      case "ftps":
        session = await FtpSession.connect(sessionId, profile, secret);
        break;
      case "sftp":
      case "ssh":
        session = await SshSession.connect(sessionId, profile, secret, jumpSecret);
        break;
      case "rdp":
        // Unlike file sessions, this doesn't open a real connection yet — the
        // native view/session only starts once the renderer's Remote Desktop
        // tab is mounted and reports its bounds via display:connect.
        session = new DisplaySession(sessionId, profile, secret);
        break;
    }

    this.sessions.set(sessionId, session);
    logger.info("session-manager", "Connected", {
      sessionId,
      protocol: profile.protocol,
      host: profile.host,
    });
    // Only a saved profile (not an ad-hoc quick-connect) has a lastConnectedAt to record.
    if (request.profileId) {
      connectionStore
        .recordConnected(request.profileId)
        .catch((err) => logger.warn("session-manager", "Failed to record lastConnectedAt", err));
    }
    activityLog
      .record("connect", `Connected to ${profile.name} (${profile.host})`)
      .catch((err) => logger.warn("session-manager", "Failed to record activity log entry", err));

    // Only SshSession currently detects the underlying connection dying on
    // its own (ssh2's Client is a real EventEmitter for this) — FtpSession
    // and DisplaySession don't expose an equivalent signal yet.
    if (session instanceof SshSession) {
      session.onUnexpectedClose((reason) => {
        void this.handleUnexpectedDisconnect(sessionId, session.info, reason);
      });
    }

    return session.info;
  }

  /** Called when a session's underlying connection drops on its own (network loss, server restart, etc.) rather than via disconnect(). */
  private async handleUnexpectedDisconnect(sessionId: string, info: SessionInfo, reason: string): Promise<void> {
    // Already torn down by an explicit disconnect() that raced this — nothing to do.
    if (!this.sessions.has(sessionId)) return;
    this.sessions.delete(sessionId);
    logger.warn("session-manager", "Session disconnected unexpectedly", { sessionId, reason });
    await activityLog
      .record("disconnect", `${info.name} (${info.host}) disconnected unexpectedly`, reason)
      .catch((err) => logger.warn("session-manager", "Failed to record activity log entry", err));
    notify("Session disconnected", `${info.name} (${info.host}) disconnected unexpectedly`);
  }

  private async resolveProfile(
    request: SessionConnectRequest,
  ): Promise<{ profile: ConnectionProfile; secret: string | null; jumpSecret: string | null }> {
    if (request.profileId) {
      const stored = await connectionStore.getRaw(request.profileId);
      if (!stored) throw new Error(`Connection profile not found: ${request.profileId}`);
      // A freshly-typed password (request.secret) overrides any stored one.
      const secret = request.secret ?? (stored.secret ? await credentialVault.decrypt(stored.secret) : null);
      const jumpSecret = stored.jumpHost?.secret ? await credentialVault.decrypt(stored.jumpHost.secret) : null;
      return { profile: stored, secret, jumpSecret };
    }

    if (request.inlineProfile) {
      const input = request.inlineProfile;
      const profile: ConnectionProfile = {
        id: randomUUID(),
        name: input.name || `${input.username}@${input.host}`,
        protocol: input.protocol,
        host: input.host,
        port: input.port,
        username: input.username,
        authType: input.authType,
        privateKeyPath: input.privateKeyPath ?? null,
        folderId: null,
        tags: [],
        defaultRemotePath: input.defaultRemotePath ?? null,
        color: input.color ?? null,
        secret: null,
        jumpHost: input.jumpHost
          ? {
              host: input.jumpHost.host,
              port: input.jumpHost.port,
              username: input.jumpHost.username,
              authType: input.jumpHost.authType,
              privateKeyPath: input.jumpHost.privateKeyPath ?? null,
              secret: null,
            }
          : null,
      };
      return {
        profile,
        secret: input.secret ?? request.secret ?? null,
        jumpSecret: input.jumpHost?.secret ?? null,
      };
    }

    throw new Error("session:connect requires either profileId or inlineProfile");
  }

  /** Returns the session as a filesystem session (SFTP/SSH/FTP/FTPS), or throws for a display (rdp) session. */
  get(sessionId: string): BaseSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No active session: ${sessionId}`);
    if (!(session instanceof BaseSession)) {
      throw new Error("This connection is a Remote Desktop session and has no filesystem");
    }
    return session;
  }

  /** Returns the session as an SSH session, or throws if it cannot host a terminal. */
  getSsh(sessionId: string): SshSession {
    const session = this.get(sessionId);
    if (!(session instanceof SshSession)) {
      throw new Error("This connection does not support an interactive terminal");
    }
    return session;
  }

  /** Returns the session as a display (rdp) session, or throws if it's a filesystem session. */
  getDisplay(sessionId: string): DisplaySession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No active session: ${sessionId}`);
    if (!(session instanceof DisplaySession)) {
      throw new Error("This connection is not a Remote Desktop session");
    }
    return session;
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    await session.close();
    logger.info("session-manager", "Disconnected", { sessionId });
    activityLog
      .record("disconnect", `Disconnected from ${session.info.name} (${session.info.host})`)
      .catch((err) => logger.warn("session-manager", "Failed to record activity log entry", err));
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => s.info);
  }

  async closeAll(): Promise<void> {
    const all = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.all(all.map((s) => s.close().catch(() => undefined)));
  }
}

export const sessionManager = new SessionManager();
