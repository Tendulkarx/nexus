/**
 * SFTP-only server on ssh2's Server: password login with the username and
 * password set in the Servers sidebar, clients confined to the shared folder
 * (which they see as "/"). No shell or exec channels. Changes (write, mkdir,
 * remove, rename) are refused unless allowWrites is on.
 *
 * The host key is created once and kept in the app's data folder, so clients
 * don't see a new key (and a "host key changed" warning) on every start.
 */
import { timingSafeEqual } from "crypto";
import { promises as fs, type Stats } from "fs";
import * as path from "path";

// Default import on purpose: Node can't detect `Server` (unlike `Client`) as a named
// export of this CommonJS module, so `import { Server } from "ssh2"` fails at app start.
import ssh2 from "ssh2";

import { OutsideRootError, resolveExisting, resolveForWrite } from "./path-safety.js";

import type { RunningServer, ServerStarter } from "./types.js";
import type { Attributes, Connection, SFTPWrapper } from "ssh2";

const { Server, utils } = ssh2;
const { STATUS_CODE } = utils.sftp;

const HOST_KEY_FILE = "sftp-host-key";
const READDIR_BATCH = 100;

export async function loadOrCreateHostKey(dataDir: string): Promise<string> {
  const file = path.join(dataDir, HOST_KEY_FILE);
  const existing = await fs.readFile(file, "utf-8").catch(() => null);
  if (existing) return existing;
  const { private: key } = utils.generateKeyPairSync("ed25519");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(file, key, { mode: 0o600 });
  return key;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function toAttrs(st: Stats): Attributes {
  return {
    mode: st.mode,
    uid: st.uid,
    gid: st.gid,
    size: st.size,
    atime: Math.floor(st.atimeMs / 1000),
    mtime: Math.floor(st.mtimeMs / 1000),
  };
}

/** `ls -l`-style line; some clients (WinSCP, older FileZilla) parse it instead of attrs. */
function longname(name: string, st: Stats): string {
  const type = st.isDirectory() ? "d" : st.isSymbolicLink() ? "l" : "-";
  const perms = [6, 3, 0]
    .map((shift) => {
      const bits = (st.mode >> shift) & 7;
      return `${bits & 4 ? "r" : "-"}${bits & 2 ? "w" : "-"}${bits & 1 ? "x" : "-"}`;
    })
    .join("");
  const date = st.mtime.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${type}${perms} 1 nexus nexus ${String(st.size).padStart(8)} ${date} ${name}`;
}

type Handle =
  | { kind: "file"; fh: fs.FileHandle; vpath: string; wrote: boolean }
  | { kind: "dir"; real: string; entries: string[] | null; offset: number };

export const startSftpServer: ServerStarter = async ({ config, host, log, dataDir }) => {
  const root = config.rootDir!;
  const username = config.username ?? "";
  const password = config.password ?? "";
  if (!username || !password) throw new Error("Set a username and password for the SFTP server first");

  const connections = new Set<Connection>();
  const server = new Server({ hostKeys: [await loadOrCreateHostKey(dataDir)] }, (client, info) => {
    connections.add(client);
    const who = info.ip;
    let user = "";

    client.on("authentication", (ctx) => {
      if (ctx.method === "password" && sameSecret(ctx.username, username) && sameSecret(ctx.password, password)) {
        user = ctx.username;
        return ctx.accept();
      }
      if (ctx.method === "password") log(`${who} failed login as "${ctx.username}"`);
      ctx.reject(["password"]);
    });

    client.on("ready", () => {
      log(`${user}@${who} connected`);
      client.on("session", (accept) => {
        const session = accept();
        // Only the sftp subsystem; shell/exec requests get no handler and are refused.
        session.on("sftp", (acceptSftp) => serveSftp(acceptSftp(), `${user}@${who}`));
      });
    });

    client.on("close", () => {
      connections.delete(client);
      if (user) log(`${user}@${who} disconnected`);
    });
    client.on("error", () => {
      // Dropped connections surface as "close" too; nothing else to do.
    });
  });

  function serveSftp(sftp: SFTPWrapper, who: string) {
    const handles = new Map<number, Handle>();
    let nextHandle = 1;

    const newHandle = (h: Handle) => {
      const id = nextHandle++;
      handles.set(id, h);
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(id);
      return buf;
    };
    const getHandle = (buf: Buffer) => (buf.length === 4 ? handles.get(buf.readUInt32BE(0)) : undefined);
    const vnorm = (p: string) => path.posix.normalize("/" + p);

    const fail = (reqid: number, err: unknown) => {
      const code = (err as NodeJS.ErrnoException)?.code;
      const status =
        err instanceof OutsideRootError || code === "EACCES" || code === "EPERM"
          ? STATUS_CODE.PERMISSION_DENIED
          : code === "ENOENT"
            ? STATUS_CODE.NO_SUCH_FILE
            : STATUS_CODE.FAILURE;
      sftp.status(reqid, status);
    };
    const denyIfReadOnly = (reqid: number): boolean => {
      if (config.allowWrites) return false;
      sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED, "This server is read-only");
      return true;
    };

    sftp.on("REALPATH", (reqid, p) => {
      const v = vnorm(p === "." ? "/" : p);
      sftp.name(reqid, [{ filename: v, longname: v, attrs: {} as Attributes }]);
    });

    const statHandler = (reqid: number, p: string) =>
      void resolveExisting(root, p)
        .then((real) => fs.stat(real))
        .then((st) => sftp.attrs(reqid, toAttrs(st)))
        .catch((err) => fail(reqid, err));
    sftp.on("STAT", statHandler);
    sftp.on("LSTAT", statHandler);

    sftp.on("FSTAT", (reqid, handle) => {
      const h = getHandle(handle);
      if (h?.kind !== "file") return sftp.status(reqid, STATUS_CODE.FAILURE);
      void h.fh
        .stat()
        .then((st) => sftp.attrs(reqid, toAttrs(st)))
        .catch((err) => fail(reqid, err));
    });

    sftp.on("OPENDIR", (reqid, p) => {
      void resolveExisting(root, p)
        .then(async (real) => {
          if (!(await fs.stat(real)).isDirectory()) throw Object.assign(new Error("not a dir"), { code: "ENOTDIR" });
          sftp.handle(reqid, newHandle({ kind: "dir", real, entries: null, offset: 0 }));
        })
        .catch((err) => fail(reqid, err));
    });

    sftp.on("READDIR", (reqid, handle) => {
      const h = getHandle(handle);
      if (h?.kind !== "dir") return sftp.status(reqid, STATUS_CODE.FAILURE);
      void (async () => {
        h.entries ??= await fs.readdir(h.real);
        if (h.offset >= h.entries.length) return sftp.status(reqid, STATUS_CODE.EOF);
        const batch = h.entries.slice(h.offset, h.offset + READDIR_BATCH);
        h.offset += batch.length;
        const names = await Promise.all(
          batch.map(async (name) => {
            const st = await fs.lstat(path.join(h.real, name)).catch(() => null);
            return st ? { filename: name, longname: longname(name, st), attrs: toAttrs(st) } : null;
          }),
        );
        sftp.name(
          reqid,
          names.filter((n) => n !== null),
        );
      })().catch((err) => fail(reqid, err));
    });

    sftp.on("OPEN", (reqid, filename, flags) => {
      const mode = utils.sftp.flagsToString(flags) ?? "r";
      const writing = mode !== "r";
      if (writing && denyIfReadOnly(reqid)) return;
      void (writing ? resolveForWrite(root, filename) : resolveExisting(root, filename))
        .then((real) => fs.open(real, mode))
        .then((fh) => {
          sftp.handle(reqid, newHandle({ kind: "file", fh, vpath: vnorm(filename), wrote: false }));
          if (!writing) log(`${who} downloading ${vnorm(filename)}`);
        })
        .catch((err) => fail(reqid, err));
    });

    sftp.on("READ", (reqid, handle, offset, length) => {
      const h = getHandle(handle);
      if (h?.kind !== "file") return sftp.status(reqid, STATUS_CODE.FAILURE);
      const buf = Buffer.alloc(length);
      void h.fh
        .read(buf, 0, length, offset)
        .then(({ bytesRead }) =>
          bytesRead === 0 ? sftp.status(reqid, STATUS_CODE.EOF) : sftp.data(reqid, buf.subarray(0, bytesRead)),
        )
        .catch((err) => fail(reqid, err));
    });

    sftp.on("WRITE", (reqid, handle, offset, data) => {
      const h = getHandle(handle);
      if (h?.kind !== "file") return sftp.status(reqid, STATUS_CODE.FAILURE);
      if (denyIfReadOnly(reqid)) return;
      h.wrote = true;
      void h.fh
        .write(data, 0, data.length, offset)
        .then(() => sftp.status(reqid, STATUS_CODE.OK))
        .catch((err) => fail(reqid, err));
    });

    sftp.on("CLOSE", (reqid, handle) => {
      const h = getHandle(handle);
      if (!h) return sftp.status(reqid, STATUS_CODE.FAILURE);
      handles.delete(handle.readUInt32BE(0));
      if (h.kind === "dir") return sftp.status(reqid, STATUS_CODE.OK);
      void h.fh
        .close()
        .then(() => {
          if (h.wrote) log(`${who} uploaded ${h.vpath}`);
          sftp.status(reqid, STATUS_CODE.OK);
        })
        .catch((err) => fail(reqid, err));
    });

    const change = (reqid: number, label: string, run: () => Promise<unknown>) => {
      if (denyIfReadOnly(reqid)) return;
      void run()
        .then(() => {
          log(`${who} ${label}`);
          sftp.status(reqid, STATUS_CODE.OK);
        })
        .catch((err) => fail(reqid, err));
    };
    sftp.on("MKDIR", (reqid, p) =>
      change(reqid, `created ${vnorm(p)}`, async () => fs.mkdir(await resolveForWrite(root, p))),
    );
    sftp.on("RMDIR", (reqid, p) =>
      change(reqid, `removed ${vnorm(p)}`, async () => fs.rmdir(await resolveForWrite(root, p))),
    );
    sftp.on("REMOVE", (reqid, p) =>
      change(reqid, `deleted ${vnorm(p)}`, async () => fs.unlink(await resolveForWrite(root, p))),
    );
    sftp.on("RENAME", (reqid, from, to) =>
      change(reqid, `renamed ${vnorm(from)} → ${vnorm(to)}`, async () =>
        fs.rename(await resolveForWrite(root, from), await resolveForWrite(root, to)),
      ),
    );
    // Permission/time changes are accepted and ignored: the files belong to the Mac user running Nexus.
    sftp.on("SETSTAT", (reqid) => (denyIfReadOnly(reqid) ? undefined : sftp.status(reqid, STATUS_CODE.OK)));
    sftp.on("FSETSTAT", (reqid) => (denyIfReadOnly(reqid) ? undefined : sftp.status(reqid, STATUS_CODE.OK)));
    sftp.on("READLINK", (reqid) => sftp.status(reqid, STATUS_CODE.OP_UNSUPPORTED));
    sftp.on("SYMLINK", (reqid) => sftp.status(reqid, STATUS_CODE.OP_UNSUPPORTED));

    sftp.on("close", () => {
      for (const h of handles.values()) if (h.kind === "file") void h.fh.close().catch(() => {});
      handles.clear();
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, host, () => resolve());
  });
  log(`Serving ${root} to "${username}"${config.allowWrites ? " (changes allowed)" : " (read-only)"}`);

  const running: RunningServer = {
    stop: () =>
      new Promise<void>((resolve) => {
        for (const c of connections) c.end();
        server.close(() => resolve());
      }),
  };
  return running;
};
