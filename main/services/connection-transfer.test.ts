import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ConnectionInput, ConnectionProfile, Folder } from "@shared/ipc-contract";

// connection-transfer.ts pulls in connection-store.ts (which needs Electron's
// app.getPath) and credential-vault.ts (safeStorage) — fake both module
// boundaries with simple in-memory equivalents, same approach as
// sync-manager.test.ts.
const profiles: ConnectionProfile[] = [];
const folders: Folder[] = [];
const created: ConnectionInput[] = [];

vi.mock("./connection-store.js", () => ({
  connectionStore: {
    list: vi.fn(async () => ({
      profiles: profiles.map(({ secret: _secret, jumpHost, ...rest }) => ({
        ...rest,
        hasSecret: Boolean(_secret),
        jumpHost: jumpHost ? { ...jumpHost, hasSecret: Boolean(jumpHost.secret) } : null,
      })),
      folders,
    })),
    getRaw: vi.fn(async (id: string) => profiles.find((p) => p.id === id) ?? null),
    create: vi.fn(async (input: ConnectionInput) => {
      created.push(input);
      return { ...input, id: `new-${created.length}`, hasSecret: Boolean(input.secret), jumpHost: null };
    }),
    createFolder: vi.fn(async (name: string) => ({ id: `folder-${name}`, name, parentId: null })),
  },
}));

vi.mock("./credential-vault.js", () => ({
  credentialVault: {
    encrypt: vi.fn(async (plaintext: string) => `vault:${plaintext}`),
    decrypt: vi.fn(async (ciphertext: string) =>
      ciphertext.startsWith("vault:") ? ciphertext.slice("vault:".length) : null,
    ),
  },
}));

const { exportConnections, importConnections } = await import("./connection-transfer.js");

function profile(overrides: Partial<ConnectionProfile>): ConnectionProfile {
  return {
    id: "p1",
    name: "Prod",
    protocol: "sftp",
    host: "example.com",
    port: 22,
    username: "root",
    authType: "password",
    privateKeyPath: null,
    folderId: null,
    tags: [],
    defaultRemotePath: null,
    color: null,
    lastConnectedAt: null,
    secret: "vault:hunter2",
    jumpHost: null,
    ...overrides,
  };
}

describe("connection export/import", () => {
  let tmpFile: string;

  beforeEach(async () => {
    profiles.length = 0;
    folders.length = 0;
    created.length = 0;
    tmpFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "nexus-export-test-")), "export.json");
  });

  afterEach(async () => {
    await fs.rm(path.dirname(tmpFile), { recursive: true, force: true });
  });

  it("omits secrets by default and never writes plaintext to disk", async () => {
    profiles.push(profile({ id: "p1", secret: "vault:hunter2" }));

    const result = await exportConnections({ filePath: tmpFile, includeSecrets: false });
    expect(result).toEqual({ profileCount: 1, folderCount: 0 });

    const written = await fs.readFile(tmpFile, "utf-8");
    expect(written).not.toContain("hunter2");
    const parsed = JSON.parse(written);
    expect(parsed.secretsIncluded).toBe(false);
    expect(parsed.profiles[0].secret).toBeNull();
  });

  it("round-trips a secret through export (with password) and import (same password)", async () => {
    profiles.push(profile({ id: "p1", secret: "vault:hunter2" }));

    await exportConnections({ filePath: tmpFile, includeSecrets: true, password: "export-pw" });
    const written = await fs.readFile(tmpFile, "utf-8");
    expect(written).not.toContain("hunter2");

    const result = await importConnections({ filePath: tmpFile, password: "export-pw" });
    expect(result.profileCount).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0]?.secret).toBe("hunter2");
  });

  it("rejects import with the wrong password", async () => {
    profiles.push(profile({ id: "p1", secret: "vault:hunter2" }));
    await exportConnections({ filePath: tmpFile, includeSecrets: true, password: "export-pw" });

    await expect(importConnections({ filePath: tmpFile, password: "wrong-pw" })).rejects.toThrow(/incorrect password/i);
    expect(created).toHaveLength(0);
  });

  it("rejects import of a secrets-included file when no password is supplied", async () => {
    profiles.push(profile({ id: "p1", secret: "vault:hunter2" }));
    await exportConnections({ filePath: tmpFile, includeSecrets: true, password: "export-pw" });

    await expect(importConnections({ filePath: tmpFile })).rejects.toThrow(/password/i);
    expect(created).toHaveLength(0);
  });

  it("rejects exporting with secrets but no password", async () => {
    profiles.push(profile({ id: "p1" }));
    await expect(exportConnections({ filePath: tmpFile, includeSecrets: true })).rejects.toThrow(/password/i);
  });

  it("imports profiles with no secret at all when the file has secrets omitted", async () => {
    profiles.push(profile({ id: "p1", secret: "vault:hunter2" }));
    await exportConnections({ filePath: tmpFile, includeSecrets: false });

    const result = await importConnections({ filePath: tmpFile });
    expect(result.profileCount).toBe(1);
    expect(created[0]?.secret).toBeUndefined();
  });

  it("only exports folders actually referenced by the selected profiles", async () => {
    folders.push({ id: "f1", name: "Prod servers", parentId: null }, { id: "f2", name: "Unused", parentId: null });
    profiles.push(profile({ id: "p1", folderId: "f1" }));

    await exportConnections({ filePath: tmpFile, includeSecrets: false });
    const parsed = JSON.parse(await fs.readFile(tmpFile, "utf-8"));
    expect(parsed.folders).toEqual([{ id: "f1", name: "Prod servers" }]);
  });

  it("remaps folder ids on import and rejects unrecognized export files", async () => {
    folders.push({ id: "f1", name: "Prod servers", parentId: null });
    profiles.push(profile({ id: "p1", folderId: "f1" }));
    await exportConnections({ filePath: tmpFile, includeSecrets: false });

    await importConnections({ filePath: tmpFile });
    expect(created[0]?.folderId).toBe("folder-Prod servers");

    await fs.writeFile(tmpFile, JSON.stringify({ not: "an export file" }), "utf-8");
    await expect(importConnections({ filePath: tmpFile })).rejects.toThrow(/not a valid/i);
  });
});
