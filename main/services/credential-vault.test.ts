import { describe, it, expect, vi, beforeEach } from "vitest";

const safeStorage = {
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
};

vi.mock("electron", () => ({ safeStorage }));

describe("CredentialVault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("round-trips a secret through encrypt/decrypt as base64", async () => {
    safeStorage.isEncryptionAvailable.mockResolvedValue(true);
    safeStorage.encryptString.mockReturnValue(Buffer.from("cipher"));
    safeStorage.decryptString.mockResolvedValue("hunter2");

    const { CredentialVault } = await import("./credential-vault.js");
    const vault = new CredentialVault();

    const encrypted = await vault.encrypt("hunter2");
    expect(encrypted).toBe(Buffer.from("cipher").toString("base64"));
    expect(safeStorage.encryptString).toHaveBeenCalledWith("hunter2");

    const decrypted = await vault.decrypt(encrypted);
    expect(decrypted).toBe("hunter2");
  });

  it("throws on encrypt when safeStorage is unavailable rather than silently storing plaintext", async () => {
    safeStorage.isEncryptionAvailable.mockResolvedValue(false);

    const { CredentialVault } = await import("./credential-vault.js");
    const vault = new CredentialVault();

    await expect(vault.encrypt("hunter2")).rejects.toThrow(/unavailable/i);
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
  });

  it("returns null on decrypt when safeStorage is unavailable", async () => {
    safeStorage.isEncryptionAvailable.mockResolvedValue(false);

    const { CredentialVault } = await import("./credential-vault.js");
    const vault = new CredentialVault();

    await expect(vault.decrypt("anything")).resolves.toBeNull();
  });

  it("returns null (not a throw) when decryption fails on malformed ciphertext", async () => {
    safeStorage.isEncryptionAvailable.mockResolvedValue(true);
    safeStorage.decryptString.mockRejectedValue(new Error("bad tag"));

    const { CredentialVault } = await import("./credential-vault.js");
    const vault = new CredentialVault();

    await expect(vault.decrypt("not-valid-ciphertext")).resolves.toBeNull();
  });

  it("caches the availability check across calls", async () => {
    safeStorage.isEncryptionAvailable.mockResolvedValue(true);
    safeStorage.encryptString.mockReturnValue(Buffer.from("c"));

    const { CredentialVault } = await import("./credential-vault.js");
    const vault = new CredentialVault();

    await vault.encrypt("a");
    await vault.encrypt("b");
    expect(safeStorage.isEncryptionAvailable).toHaveBeenCalledTimes(1);
  });
});
