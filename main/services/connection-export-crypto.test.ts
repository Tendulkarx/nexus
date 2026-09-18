import { describe, it, expect } from "vitest";

import { generateKdfParams, deriveExportKey, encryptSecret, decryptSecret } from "./connection-export-crypto.js";

describe("connection export crypto", () => {
  it("round-trips a secret through encrypt/decrypt with the correct password", () => {
    const kdf = generateKdfParams();
    const key = deriveExportKey("correct horse battery staple", kdf);

    const payload = encryptSecret("hunter2", key);
    expect(payload.ciphertext).not.toContain("hunter2");

    expect(decryptSecret(payload, key)).toBe("hunter2");
  });

  it("fails to decrypt with the wrong password", () => {
    const kdf = generateKdfParams();
    const rightKey = deriveExportKey("correct horse battery staple", kdf);
    const wrongKey = deriveExportKey("incorrect horse", kdf);

    const payload = encryptSecret("hunter2", rightKey);

    expect(() => decryptSecret(payload, wrongKey)).toThrow();
  });

  it("derives different keys for different salts even with the same password", () => {
    const kdfA = generateKdfParams();
    const kdfB = generateKdfParams();
    expect(kdfA.salt).not.toBe(kdfB.salt);

    const keyA = deriveExportKey("same password", kdfA);
    const keyB = deriveExportKey("same password", kdfB);
    expect(keyA.equals(keyB)).toBe(false);
  });

  it("produces different ciphertext for the same plaintext on repeated calls (random IV)", () => {
    const kdf = generateKdfParams();
    const key = deriveExportKey("password", kdf);

    const first = encryptSecret("hunter2", key);
    const second = encryptSecret("hunter2", key);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects a tampered ciphertext (auth tag mismatch)", () => {
    const kdf = generateKdfParams();
    const key = deriveExportKey("password", kdf);
    const payload = encryptSecret("hunter2", key);

    const tampered = { ...payload, ciphertext: Buffer.from("tampered-data").toString("base64") };
    expect(() => decryptSecret(tampered, key)).toThrow();
  });
});
