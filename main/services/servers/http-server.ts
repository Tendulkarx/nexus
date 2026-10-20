/**
 * Read-only static file server for one folder, with plain directory listings
 * (an index.html in a folder is served instead). GET and HEAD only.
 */
import { createReadStream, promises as fs } from "fs";
import * as http from "http";
import * as path from "path";

import { OutsideRootError, resolveExisting } from "./path-safety.js";

import type { RunningServer, ServerStarter } from "./types.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".iso": "application/octet-stream",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function directoryListing(urlPath: string, entries: { name: string; isDir: boolean; size: number }[]): string {
  const base = urlPath.endsWith("/") ? urlPath : `${urlPath}/`;
  const rows = entries
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
    .map((e) => {
      const name = e.isDir ? `${e.name}/` : e.name;
      const href = base + encodeURIComponent(e.name) + (e.isDir ? "/" : "");
      return `<tr><td><a href="${escapeHtml(href)}">${escapeHtml(name)}</a></td><td>${e.isDir ? "" : e.size}</td></tr>`;
    })
    .join("");
  const up = base === "/" ? "" : `<tr><td><a href="../">../</a></td><td></td></tr>`;
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(base)}</title><style>body{font:14px system-ui;margin:2rem}td{padding:2px 16px 2px 0}</style><h1>${escapeHtml(base)}</h1><table>${up}${rows}</table>`;
}

export const startHttpServer: ServerStarter = async ({ config, host, log }) => {
  const root = config.rootDir!;
  const server = http.createServer((req, res) => {
    void (async () => {
      let urlPath: string;
      try {
        urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      } catch {
        res.writeHead(400).end("Bad request");
        return;
      }
      const respond = (status: number, message: string) => {
        res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(message);
        log(`${req.socket.remoteAddress} ${req.method} ${urlPath} → ${status}`);
      };
      if (req.method !== "GET" && req.method !== "HEAD") return respond(405, "Read-only server");
      try {
        let target = await resolveExisting(root, urlPath);
        let stat = await fs.stat(target);
        if (stat.isDirectory()) {
          if (!urlPath.endsWith("/")) {
            res.writeHead(301, { Location: `${encodeURI(urlPath)}/` }).end();
            return;
          }
          const index = path.join(target, "index.html");
          const indexStat = await fs.stat(index).catch(() => null);
          if (indexStat?.isFile()) {
            target = await resolveExisting(root, path.posix.join(urlPath, "index.html"));
            stat = indexStat;
          } else {
            const dirents = await fs.readdir(target, { withFileTypes: true });
            const entries = await Promise.all(
              dirents
                .filter((d) => !d.name.startsWith("."))
                .map(async (d) => ({
                  name: d.name,
                  isDir: d.isDirectory(),
                  size: d.isFile() ? ((await fs.stat(path.join(target, d.name)).catch(() => null))?.size ?? 0) : 0,
                })),
            );
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(req.method === "HEAD" ? undefined : directoryListing(urlPath, entries));
            log(`${req.socket.remoteAddress} ${req.method} ${urlPath} → 200 (listing)`);
            return;
          }
        }
        res.writeHead(200, {
          "Content-Type": CONTENT_TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream",
          "Content-Length": stat.size,
        });
        if (req.method === "HEAD") return void res.end();
        createReadStream(target).pipe(res);
        log(`${req.socket.remoteAddress} GET ${urlPath} → 200 (${stat.size} bytes)`);
      } catch (err) {
        if (err instanceof OutsideRootError) return respond(403, "Forbidden");
        respond(404, "Not found");
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, host, () => resolve());
  });
  log(`Serving ${root}`);

  const running: RunningServer = {
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  return running;
};
