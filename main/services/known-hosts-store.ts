/**
 * Trust-on-first-use (TOFU) fingerprint store, mirroring the classic
 * ~/.ssh/known_hosts model: the first time we connect to a host we record
 * its key/certificate fingerprint, and on every subsequent connection we
 * verify the presented one still matches — refusing silently otherwise.
 *
 * Shared between SSH host keys and RDP TLS certificates — the trust logic is
 * identical for both, so they're kept in one store keyed by
 * `protocol:host:port` rather than two near-duplicate stores.
 */
import { createHash } from "crypto";

import { DataStore } from "./data-store.js";

export type TrustedProtocol = "ssh" | "rdp";

type KnownHostsFile = Record<string, string>;

function hostKey(protocol: TrustedProtocol, host: string, port: number): string {
  return `${protocol}:${host}:${port}`;
}

/** sha256 fingerprint of a raw public key blob, base64-encoded (same shape ssh-keygen -lf uses, minus the "SHA256:" prefix). */
export function fingerprintKey(key: Buffer): string {
  return createHash("sha256").update(key).digest("base64");
}

export class KnownHostsStore {
  private store = new DataStore<KnownHostsFile>("known-hosts.json", {});

  /** Returns the stored fingerprint for protocol:host:port, or null if never seen. */
  async get(protocol: TrustedProtocol, host: string, port: number): Promise<string | null> {
    const data = await this.store.load();
    return data[hostKey(protocol, host, port)] ?? null;
  }

  /** Records/overwrites the trusted fingerprint for protocol:host:port. */
  async trust(protocol: TrustedProtocol, host: string, port: number, fingerprint: string): Promise<void> {
    const data = await this.store.load();
    data[hostKey(protocol, host, port)] = fingerprint;
    await this.store.save(data);
  }

  async forget(protocol: TrustedProtocol, host: string, port: number): Promise<void> {
    const data = await this.store.load();
    delete data[hostKey(protocol, host, port)];
    await this.store.save(data);
  }
}

export const knownHostsStore = new KnownHostsStore();
