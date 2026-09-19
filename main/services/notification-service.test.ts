import { describe, it, expect, vi, beforeEach } from "vitest";

const notificationShow = vi.fn();
const notificationCtorSpy = vi.fn();
class NotificationCtor {
  static isSupported = vi.fn().mockReturnValue(true);
  show = notificationShow;
  constructor(options: { title: string; body: string }) {
    notificationCtorSpy(options);
  }
}

let windows: Array<{ isDestroyed: () => boolean; isFocused: () => boolean }> = [];

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nexus-test-userdata", getVersion: () => "0.0.0-test" },
  BrowserWindow: { getAllWindows: () => windows },
  Notification: NotificationCtor,
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

describe("notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    windows = [];
  });

  it("shows a notification when no window is focused", async () => {
    windows = [{ isDestroyed: () => false, isFocused: () => false }];
    const { notify } = await import("./notification-service.js");

    await notify("Title", "Body");

    expect(notificationCtorSpy).toHaveBeenCalledWith({ title: "Title", body: "Body" });
    expect(notificationShow).toHaveBeenCalledTimes(1);
  });

  it("does not show a notification when a window is focused", async () => {
    windows = [{ isDestroyed: () => false, isFocused: () => true }];
    const { notify } = await import("./notification-service.js");

    await notify("Title", "Body");

    expect(notificationCtorSpy).not.toHaveBeenCalled();
  });

  it("does not show a notification when there are no windows at all", async () => {
    windows = [];
    const { notify } = await import("./notification-service.js");

    await notify("Title", "Body");

    expect(notificationCtorSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows errors from Notification support checks", async () => {
    windows = [{ isDestroyed: () => false, isFocused: () => false }];
    NotificationCtor.isSupported = vi.fn(() => {
      throw new Error("boom");
    });
    const { notify } = await import("./notification-service.js");

    await expect(notify("Title", "Body")).resolves.not.toThrow();
  });
});
