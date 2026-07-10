/**
 * Owns all live connections keyed by sessionId. Resolves credentials at connect
 * time (decrypting stored secrets or accepting an ad-hoc one) and tears sessions
 * down on disconnect / app quit.
 */
import { randomUUID } from "crypto";

import { logger } from "@glaze/core/backend";

import { connectionStore } from "./connection-store.js";
import { credentialVault } from "./credential-vault.js";
import { BaseSession } from "./sessions/base-session.js";
import { FtpSession } from "./sessions/ftp-session.js";
import { SshSession } from "./sessions/ssh-session.js";

import type { ConnectionProfile, SessionConnectRequest, SessionInfo } from "@shared/ipc-contract";

export class SessionManager {
  private sessions = new Map<string, BaseSession>();

  async connect(request: SessionConnectRequest): Promise<SessionInfo> {
    const { profile, secret } = await this.resolveProfile(request);
    const sessionId = randomUUID();

    let session: BaseSession;
    if (profile.protocol === "ftp" || profile.protocol === "ftps") {
      session = await FtpSession.connect(sessionId, profile, secret);
    } else {
      session = await SshSession.connect(sessionId, profile, secret);
    }

    this.sessions.set(sessionId, session);
    logger.info("session-manager", "Connected", {
      sessionId,
      protocol: profile.protocol,
      host: profile.host,
    });
    return session.info;
  }

  private async resolveProfile(
    request: SessionConnectRequest,
  ): Promise<{ profile: ConnectionProfile; secret: string | null }> {
    if (request.profileId) {
      const stored = await connectionStore.getRaw(request.profileId);
      if (!stored) throw new Error(`Connection profile not found: ${request.profileId}`);
      // A freshly-typed password (request.secret) overrides any stored one.
      const secret = request.secret ?? (stored.secret ? await credentialVault.decrypt(stored.secret) : null);
      return { profile: stored, secret };
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
      };
      return { profile, secret: input.secret ?? request.secret ?? null };
    }

    throw new Error("session:connect requires either profileId or inlineProfile");
  }

  get(sessionId: string): BaseSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No active session: ${sessionId}`);
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

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    await session.close();
    logger.info("session-manager", "Disconnected", { sessionId });
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
