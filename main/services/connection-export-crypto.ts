/**
 * Password-based encryption for connection-profile export files.
 *
 * CredentialVault's safeStorage ciphertext is bound to this machine's/user's
 * OS keychain — it cannot be decrypted on another machine (or even another
 * user account), so it's useless for a portable export file. Instead, when a
 * user opts in to including secrets in an export, each one is decrypted from
 * the vault, then re-encrypted here with a key derived from a user-supplied
 * export password (scrypt) using AES-256-GCM. The same password is required
 * to import those secrets back.
 */
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

export interface KdfParams {
  salt: string;
  n: number;
  r: number;
  p: number;
}

export interface EncryptedPayload {
  iv: string;
  authTag: string;
  ciphertext: string;
}

export function generateKdfParams(): KdfParams {
  return { salt: randomBytes(SALT_LENGTH).toString("base64"), n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P };
}

export function deriveExportKey(password: string, params: KdfParams): Buffer {
  return scryptSync(password, Buffer.from(params.salt, "base64"), KEY_LENGTH, {
    N: params.n,
    r: params.r,
    p: params.p,
  });
}

export function encryptSecret(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

/** Throws if `key` doesn't match the key the payload was encrypted with (wrong password). */
export function decryptSecret(payload: EncryptedPayload, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf-8");
}
