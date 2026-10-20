import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ConnectionProfile, SessionInfo } from "@shared/ipc-contract";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  app: { isPackaged: false },
}));

class FakeSshSession {
  static connect = vi.fn();
  info: SessionInfo;
  close = vi.fn().mockResolvedValue(undefined);
  onUnexpectedClose = vi.fn();
  constructor(info: SessionInfo) {
    this.info = info;
  }
}

class FakeFtpSession {
  static connect = vi.fn();
  info: SessionInfo;
  close = vi.fn().mockResolvedValue(undefined);
  constructor(info: SessionInfo) {
    this.info = info;
  }
}

class FakeMoshSession {
  static connect = vi.fn();
  info: SessionInfo;
  close = vi.fn().mockResolvedValue(undefined);
  constructor(info: SessionInfo) {
    this.info = info;
  }
}

vi.mock("./sessions/ssh-session.js", () => ({ SshSession: FakeSshSession }));
vi.mock("./sessions/ftp-session.js", () => ({ FtpSession: FakeFtpSession }));
vi.mock("./sessions/mosh-session.js", () => ({ MoshSession: FakeMoshSession }));

const connectionStore = { getRaw: vi.fn(), recordConnected: vi.fn().mockResolvedValue(undefined) };
vi.mock("./connection-store.js", () => ({ connectionStore }));

const credentialVault = { decrypt: vi.fn() };
vi.mock("./credential-vault.js", () => ({ credentialVault }));

const activityLog = { record: vi.fn().mockResolvedValue(undefined) };
vi.mock("./activity-log.js", () => ({ activityLog }));

vi.mock("./notification-service.js", () => ({ notify: vi.fn() }));

// BaseSession is a real abstract class (no side effects) — leave unmocked so
// `session instanceof BaseSession` in session-manager.ts still works against
// our fakes, which we register as BaseSession subclasses below.
const { BaseSession } = await import("./sessions/base-session.js");
Object.setPrototypeOf(FakeSshSession.prototype, BaseSession.prototype);
Object.setPrototypeOf(FakeFtpSession.prototype, BaseSession.prototype);

const { SessionManager } = await import("./session-manager.js");
const { DisplaySession } = await import("./sessions/display-session.js");
const { MoshSession } = await import("./sessions/mosh-session.js");

function makeInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: "unset",
    profileId: null,
    name: "test",
    protocol: "sftp",
    host: "example.com",
    username: "root",
    homeDir: "/",
    supportsTerminal: true,
    kind: "filesystem",
    ...overrides,
  } as SessionInfo;
}

// Default behavior: mirror the sessionId SessionManager generates, the way a
// real SshSession/FtpSession.connect(sessionId, profile, secret) would.
// Individual tests may override this with their own instance/mockImplementation.
function resetDefaultConnectBehavior() {
  FakeSshSession.connect.mockImplementation(
    async (sessionId: string, profile: ConnectionProfile) =>
      new FakeSshSession(makeInfo({ sessionId, protocol: profile.protocol, host: profile.host, username: profile.username })),
  );
  FakeFtpSession.connect.mockImplementation(
    async (sessionId: string, profile: ConnectionProfile) =>
      new FakeFtpSession(makeInfo({ sessionId, protocol: profile.protocol, host: profile.host, username: profile.username })),
  );
  FakeMoshSession.connect.mockImplementation(
    async (sessionId: string, profile: ConnectionProfile) =>
      new FakeMoshSession(
        makeInfo({ sessionId, protocol: profile.protocol, host: profile.host, username: profile.username, kind: "terminal" }),
      ),
  );
}

function inlineRequest(protocol: ConnectionProfile["protocol"]) {
  return {
    inlineProfile: {
      name: "test",
      protocol,
      host: "example.com",
      port: 22,
      username: "root",
      authType: "password" as const,
      tags: [],
      secret: "hunter2",
    },
  };
}

describe("SessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDefaultConnectBehavior();
  });

  it("routes sftp/ssh profiles to SshSession", async () => {
    const manager = new SessionManager();

    const info = await manager.connect(inlineRequest("sftp"));

    expect(FakeSshSession.connect).toHaveBeenCalledTimes(1);
    expect(FakeFtpSession.connect).not.toHaveBeenCalled();
    expect(info.protocol).toBe("sftp");
  });

  it("routes ftp/ftps profiles to FtpSession", async () => {
    const manager = new SessionManager();

    await manager.connect(inlineRequest("ftp"));

    expect(FakeFtpSession.connect).toHaveBeenCalledTimes(1);
    expect(FakeSshSession.connect).not.toHaveBeenCalled();
  });

  it("routes rdp profiles to a DisplaySession without opening a real connection", async () => {
    const manager = new SessionManager();

    const info = await manager.connect(inlineRequest("rdp"));

    expect(info.kind).toBe("display");
    expect(FakeSshSession.connect).not.toHaveBeenCalled();
    expect(FakeFtpSession.connect).not.toHaveBeenCalled();
    expect(manager.getDisplay(info.sessionId)).toBeInstanceOf(DisplaySession);
  });

  it("routes mosh profiles to a MoshSession", async () => {
    const manager = new SessionManager();

    const info = await manager.connect(inlineRequest("mosh"));

    expect(info.kind).toBe("terminal");
    expect(FakeMoshSession.connect).toHaveBeenCalledTimes(1);
    expect(FakeSshSession.connect).not.toHaveBeenCalled();
    expect(FakeFtpSession.connect).not.toHaveBeenCalled();
    expect(manager.getTerminal(info.sessionId)).toBeInstanceOf(MoshSession);
  });

  it("decrypts a stored profile's secret, but an inline request secret overrides it", async () => {
    connectionStore.getRaw.mockResolvedValue({
      id: "p1",
      protocol: "sftp",
      secret: "encrypted-blob",
    } as unknown as ConnectionProfile);
    credentialVault.decrypt.mockResolvedValue("stored-password");

    const manager = new SessionManager();
    await manager.connect({ profileId: "p1", secret: "typed-override" });

    expect(credentialVault.decrypt).not.toHaveBeenCalled();
    expect(FakeSshSession.connect).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: "p1" }),
      "typed-override",
      null,
    );
  });

  it("decrypts a stored profile's jump-host secret separately from its own secret", async () => {
    connectionStore.getRaw.mockResolvedValue({
      id: "p1",
      protocol: "sftp",
      secret: "encrypted-blob",
      jumpHost: {
        host: "bastion.example.com",
        port: 22,
        username: "jumpuser",
        authType: "password",
        secret: "jump-encrypted-blob",
      },
    } as unknown as ConnectionProfile);
    credentialVault.decrypt.mockImplementation(async (value: string) =>
      value === "encrypted-blob" ? "stored-password" : "stored-jump-password",
    );

    const manager = new SessionManager();
    await manager.connect({ profileId: "p1" });

    expect(credentialVault.decrypt).toHaveBeenCalledWith("encrypted-blob");
    expect(credentialVault.decrypt).toHaveBeenCalledWith("jump-encrypted-blob");
    expect(FakeSshSession.connect).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: "p1" }),
      "stored-password",
      "stored-jump-password",
    );
  });

  it("passes an inline profile's jump-host secret through as plaintext, without decrypting, and keeps profile.jumpHost.secret null", async () => {
    const request = {
      inlineProfile: {
        name: "test",
        protocol: "sftp" as const,
        host: "example.com",
        port: 22,
        username: "root",
        authType: "password" as const,
        tags: [],
        secret: "hunter2",
        jumpHost: {
          host: "bastion.example.com",
          port: 2222,
          username: "jumpuser",
          authType: "password" as const,
          secret: "jump-hunter2",
        },
      },
    };

    const manager = new SessionManager();
    await manager.connect(request);

    expect(credentialVault.decrypt).not.toHaveBeenCalled();
    expect(FakeSshSession.connect).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        jumpHost: expect.objectContaining({ host: "bastion.example.com", secret: null }),
      }),
      "hunter2",
      "jump-hunter2",
    );
  });

  it("throws when the referenced profileId does not exist", async () => {
    connectionStore.getRaw.mockResolvedValue(null);
    const manager = new SessionManager();

    await expect(manager.connect({ profileId: "missing" })).rejects.toThrow(/not found/i);
  });

  it("throws when neither profileId nor inlineProfile is given", async () => {
    const manager = new SessionManager();
    await expect(manager.connect({})).rejects.toThrow(/profileId or inlineProfile/);
  });

  it("get() rejects a display session as having no filesystem", async () => {
    const manager = new SessionManager();
    const info = await manager.connect(inlineRequest("rdp"));

    expect(() => manager.get(info.sessionId)).toThrow(/Remote Desktop session/);
  });

  it("get() rejects a mosh session as having no filesystem", async () => {
    const manager = new SessionManager();
    const info = await manager.connect(inlineRequest("mosh"));

    expect(() => manager.get(info.sessionId)).toThrow(/Mosh session/);
  });

  it("get() throws for an unknown sessionId", () => {
    const manager = new SessionManager();
    expect(() => manager.get("nope")).toThrow(/No active session/);
  });

  it("getSsh() rejects a filesystem session that isn't SSH-capable (e.g. FTP)", async () => {
    const manager = new SessionManager();
    const info = await manager.connect(inlineRequest("ftp"));

    expect(() => manager.getSsh(info.sessionId)).toThrow(/interactive terminal/);
  });

  it("getSsh() rejects a mosh session — search/port-forward need real SSH exec, which mosh doesn't have", async () => {
    const manager = new SessionManager();
    const info = await manager.connect(inlineRequest("mosh"));

    expect(() => manager.getSsh(info.sessionId)).toThrow();
  });

  it("getDisplay() rejects a filesystem session", async () => {
    const manager = new SessionManager();
    const info = await manager.connect(inlineRequest("sftp"));

    expect(() => manager.getDisplay(info.sessionId)).toThrow(/not a Remote Desktop session/);
  });

  it("getTerminal() accepts SSH and Mosh sessions but rejects FTP", async () => {
    const manager = new SessionManager();
    const sshInfo = await manager.connect(inlineRequest("sftp"));
    const moshInfo = await manager.connect(inlineRequest("mosh"));
    const ftpInfo = await manager.connect(inlineRequest("ftp"));

    expect(manager.getTerminal(sshInfo.sessionId)).toBeInstanceOf(FakeSshSession);
    expect(manager.getTerminal(moshInfo.sessionId)).toBeInstanceOf(MoshSession);
    expect(() => manager.getTerminal(ftpInfo.sessionId)).toThrow(/interactive terminal/);
  });

  it("openLocal() registers a terminal-only local shell session without a profile", () => {
    const manager = new SessionManager();
    const info = manager.openLocal();

    expect(info).toMatchObject({ protocol: "local", kind: "terminal", supportsTerminal: true, profileId: null });
    expect(manager.list()).toEqual([info]);
    expect(manager.getTerminal(info.sessionId)).toBe(manager.getTerminal(info.sessionId));
    expect(() => manager.get(info.sessionId)).toThrow(/local shell session and has no filesystem/);
    expect(() => manager.getDisplay(info.sessionId)).toThrow(/not a Remote Desktop session/);
  });

  it("openLocal() gives each call its own session", () => {
    const manager = new SessionManager();
    const a = manager.openLocal();
    const b = manager.openLocal();

    expect(a.sessionId).not.toBe(b.sessionId);
    expect(manager.list()).toHaveLength(2);
  });

  it("disconnect() closes and removes the session; is a no-op for an unknown id", async () => {
    const session = new FakeSshSession(makeInfo());
    FakeSshSession.connect.mockImplementation(async (sessionId: string) => {
      session.info = { ...session.info, sessionId };
      return session;
    });
    const manager = new SessionManager();
    const info = await manager.connect(inlineRequest("sftp"));

    await manager.disconnect(info.sessionId);
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(manager.list()).toHaveLength(0);

    await expect(manager.disconnect("unknown")).resolves.toBeUndefined();
  });

  it("closeAll() closes every session even if one rejects, and clears the registry first", async () => {
    const failing = new FakeSshSession(makeInfo());
    failing.close.mockRejectedValue(new Error("boom"));
    const ok = new FakeFtpSession(makeInfo({ protocol: "ftp" }));

    FakeSshSession.connect.mockImplementation(async (sessionId: string) => {
      failing.info = { ...failing.info, sessionId };
      return failing;
    });
    FakeFtpSession.connect.mockImplementation(async (sessionId: string) => {
      ok.info = { ...ok.info, sessionId };
      return ok;
    });

    const manager = new SessionManager();
    await manager.connect(inlineRequest("sftp"));
    await manager.connect(inlineRequest("ftp"));

    await expect(manager.closeAll()).resolves.toBeUndefined();
    expect(failing.close).toHaveBeenCalledTimes(1);
    expect(ok.close).toHaveBeenCalledTimes(1);
    expect(manager.list()).toHaveLength(0);
  });
});
