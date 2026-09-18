/**
 * Trust-on-first-use (TOFU) host key store, mirroring the classic
 * ~/.ssh/known_hosts model: the first time we connect to a host we record
 * its public key fingerprint, and on every subsequent connection we verify
 * the presented key still matches — refusing silently otherwise.
 */
import { createHash } from "crypto";

import { DataStore } from "./data-store.js";

type KnownHostsFile = Record<string, string>;

function hostKey(host: string, port: number): string {
  return `${host}:${port}`;
}

/** sha256 fingerprint of a raw public key blob, base64-encoded (same shape ssh-keygen -lf uses, minus the "SHA256:" prefix). */
export function fingerprintKey(key: Buffer): string {
  return createHash("sha256").update(key).digest("base64");
}

export class KnownHostsStore {
  private store = new DataStore<KnownHostsFile>("known-hosts.json", {});

  /** Returns the stored fingerprint for host:port, or null if never seen. */
  async get(host: string, port: number): Promise<string | null> {
    const data = await this.store.load();
    return data[hostKey(host, port)] ?? null;
  }

  /** Records/overwrites the trusted fingerprint for host:port. */
  async trust(host: string, port: number, fingerprint: string): Promise<void> {
    const data = await this.store.load();
    data[hostKey(host, port)] = fingerprint;
    await this.store.save(data);
  }

  async forget(host: string, port: number): Promise<void> {
    const data = await this.store.load();
    delete data[hostKey(host, port)];
    await this.store.save(data);
  }
}

export const knownHostsStore = new KnownHostsStore();
