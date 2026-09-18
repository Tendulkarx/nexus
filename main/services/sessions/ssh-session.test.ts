import { EventEmitter } from "events";

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ConnectionProfile, JumpHost } from "@shared/ipc-contract";

vi.mock("electron", () => ({ dialog: { showMessageBox: vi.fn() } }));

const knownHostsStore = { get: vi.fn(), trust: vi.fn() };
vi.mock("../known-hosts-store.js", () => ({
  knownHostsStore,
  fingerprintKey: vi.fn(() => "fingerprint"),
}));

class FakeSftpClient {
  static instances: FakeSftpClient[] = [];
  static nextConnectError: Error | null = null;

  client = {
    forwardOut: vi.fn(),
    forwardIn: vi.fn(),
    unforwardIn: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    shell: vi.fn(),
  };
  connect: ReturnType<typeof vi.fn>;
  cwd = vi.fn().mockResolvedValue("/home/test");
  end = vi.fn().mockResolvedValue(true);

  constructor() {
    const err = FakeSftpClient.nextConnectError;
    FakeSftpClient.nextConnectError = null;
    this.connect = err ? vi.fn().mockRejectedValue(err) : vi.fn().mockResolvedValue(undefined);
    FakeSftpClient.instances.push(this);
  }
}
vi.mock("ssh2-sftp-client", () => ({ default: FakeSftpClient }));

// Stands in for the plain ssh2 Client used to authenticate to a jump host
// (separate from SftpClient's own internal `.client`, which the fake above covers).
class FakeJumpClient extends EventEmitter {
  static instances: FakeJumpClient[] = [];
  static forwardOutResult: { stream: unknown } | { error: Error } = { stream: { fake: "sock" } };

  connect = vi.fn(() => {
    queueMicrotask(() => this.emit("ready"));
  });
  forwardOut = vi.fn(
    (
      _srcHost: string,
      _srcPort: number,
      _dstHost: string,
      _dstPort: number,
      cb: (err: Error | undefined, stream: unknown) => void,
    ) => {
      const result = FakeJumpClient.forwardOutResult;
      if ("error" in result) cb(result.error, undefined);
      else cb(undefined, result.stream);
    },
  );
  end = vi.fn();

  constructor() {
    super();
    FakeJumpClient.instances.push(this);
  }
}
vi.mock("ssh2", () => ({ Client: FakeJumpClient }));

const { SshSession } = await import("./ssh-session.js");

function makeProfile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: "p1",
    name: "test",
    protocol: "sftp",
    host: "target.example.com",
    port: 22,
    username: "root",
    authType: "password",
    tags: [],
    secret: null,
    ...overrides,
  };
}

const JUMP_HOST: JumpHost = {
  host: "bastion.example.com",
  port: 2222,
  username: "jumpuser",
  authType: "password",
  secret: null,
};

describe("SshSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeSftpClient.instances = [];
    FakeSftpClient.nextConnectError = null;
    FakeJumpClient.instances = [];
    FakeJumpClient.forwardOutResult = { stream: { fake: "sock" } };
    knownHostsStore.get.mockResolvedValue(null);
  });

  it("connects directly to the target when no jump host is configured", async () => {
    const session = await SshSession.connect("s1", makeProfile(), "pw");

    expect(FakeJumpClient.instances).toHaveLength(0);
    const sftp = FakeSftpClient.instances[0];
    expect(sftp.connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: "target.example.com", port: 22, username: "root", password: "pw" }),
    );
    expect(sftp.connect.mock.calls[0][0].sock).toBeUndefined();
    expect(session.info.host).toBe("target.example.com");
  });

  it("authenticates to the jump host first, then tunnels the target connection through forwardOut", async () => {
    const profile = makeProfile({ jumpHost: JUMP_HOST });

    await SshSession.connect("s1", profile, "target-pw", "jump-pw");

    expect(FakeJumpClient.instances).toHaveLength(1);
    const jumpClient = FakeJumpClient.instances[0];
    expect(jumpClient.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "bastion.example.com",
        port: 2222,
        username: "jumpuser",
        password: "jump-pw",
      }),
    );
    expect(jumpClient.forwardOut).toHaveBeenCalledWith(
      "127.0.0.1",
      0,
      "target.example.com",
      22,
      expect.any(Function),
    );

    const sftp = FakeSftpClient.instances[0];
    expect(sftp.connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: "target.example.com", password: "target-pw", sock: { fake: "sock" } }),
    );
  });

  it("ends the jump-host connection if the target connection then fails", async () => {
    FakeSftpClient.nextConnectError = new Error("target auth failed");
    const profile = makeProfile({ jumpHost: JUMP_HOST });

    await expect(SshSession.connect("s1", profile, "target-pw", "jump-pw")).rejects.toThrow(
      "target auth failed",
    );

    expect(FakeJumpClient.instances[0].end).toHaveBeenCalledTimes(1);
  });

  it("ends the jump-host connection if opening the forwardOut tunnel fails", async () => {
    FakeJumpClient.forwardOutResult = { error: new Error("tunnel refused") };
    const profile = makeProfile({ jumpHost: JUMP_HOST });

    await expect(SshSession.connect("s1", profile, "target-pw", "jump-pw")).rejects.toThrow(
      "tunnel refused",
    );

    expect(FakeJumpClient.instances[0].end).toHaveBeenCalledTimes(1);
    expect(FakeSftpClient.instances[0].connect).not.toHaveBeenCalled();
  });

  it("forwardOut/forwardIn/unforwardIn/onTcpConnection delegate to the underlying ssh2 client", async () => {
    const session = await SshSession.connect("s1", makeProfile(), "pw");
    const rawClient = FakeSftpClient.instances[0].client;

    rawClient.forwardOut.mockImplementation(
      (_a: string, _b: number, _c: string, _d: number, cb: (err: undefined, stream: string) => void) =>
        cb(undefined, "the-stream"),
    );
    await expect(session.forwardOut("127.0.0.1", 0, "dest", 80)).resolves.toBe("the-stream");
    expect(rawClient.forwardOut).toHaveBeenCalledWith("127.0.0.1", 0, "dest", 80, expect.any(Function));

    rawClient.forwardIn.mockImplementation((_a: string, _b: number, cb: (err: undefined, port: number) => void) =>
      cb(undefined, 4000),
    );
    await expect(session.forwardIn("0.0.0.0", 0)).resolves.toBe(4000);

    rawClient.unforwardIn.mockImplementation((_a: string, _b: number, cb: (err: undefined) => void) => cb(undefined));
    await expect(session.unforwardIn("0.0.0.0", 4000)).resolves.toBeUndefined();

    const handler = vi.fn();
    const unsubscribe = session.onTcpConnection(handler);
    expect(rawClient.on).toHaveBeenCalledWith("tcp connection", handler);
    unsubscribe();
    expect(rawClient.removeListener).toHaveBeenCalledWith("tcp connection", handler);
  });

  it("close() ends both the SFTP connection and the jump-host connection", async () => {
    const profile = makeProfile({ jumpHost: JUMP_HOST });
    const session = await SshSession.connect("s1", profile, "target-pw", "jump-pw");

    await session.close();

    expect(FakeSftpClient.instances[0].end).toHaveBeenCalledTimes(1);
    expect(FakeJumpClient.instances[0].end).toHaveBeenCalledTimes(1);
  });

  it("close() is a no-op for the jump client when there was no jump host", async () => {
    const session = await SshSession.connect("s1", makeProfile(), "pw");
    await session.close();
    expect(FakeJumpClient.instances).toHaveLength(0);
  });
});
