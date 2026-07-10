/**
 * Encrypts/decrypts connection secrets (passwords, key passphrases) with the
 * native safeStorage backend. Ciphertext is stored base64-encoded inside
 * connections.json. Secret VALUES are never logged.
 */
import { safeStorage, logger } from "@glaze/core/backend";

export class CredentialVault {
  private availability: boolean | null = null;

  private async isAvailable(): Promise<boolean> {
    if (this.availability === null) {
      this.availability = await safeStorage.isEncryptionAvailable();
      if (!this.availability) {
        logger.warn("credential-vault", "safeStorage encryption is unavailable on this system");
      }
    }
    return this.availability;
  }

  /** Encrypt a plaintext secret to a base64 string suitable for JSON storage. */
  async encrypt(plaintext: string): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error("Secure credential storage is unavailable on this system");
    }
    const buffer = await safeStorage.encryptString(plaintext);
    return buffer.toString("base64");
  }

  /** Decrypt a base64 ciphertext back to plaintext. Returns null on failure. */
  async decrypt(ciphertextBase64: string): Promise<string | null> {
    if (!(await this.isAvailable())) {
      return null;
    }
    try {
      const buffer = Buffer.from(ciphertextBase64, "base64");
      return await safeStorage.decryptString(buffer);
    } catch (err) {
      logger.error("credential-vault", "Failed to decrypt stored secret", err);
      return null;
    }
  }
}

export const credentialVault = new CredentialVault();
