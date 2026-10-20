/**
 * `postinstall` hook — restores the execute bit on node-pty's `spawn-helper`.
 *
 * node-pty 1.1.0 ships its macOS prebuilds with `spawn-helper` as 0644, and
 * every pty.spawn() then fails with "posix_spawnp failed." because node-pty
 * execs that helper to start the shell. node-pty's own install script only
 * checks the prebuilds exist, so nothing upstream fixes the mode. Runs on
 * every `npm install` and is a no-op when the files are already executable or
 * absent (e.g. on a platform without prebuilds).
 */
const fs = require("node:fs");
const path = require("node:path");

const ptyRoot = path.join(__dirname, "..", "node_modules", "node-pty");
const candidates = [path.join(ptyRoot, "build", "Release", "spawn-helper")];
const prebuilds = path.join(ptyRoot, "prebuilds");
if (fs.existsSync(prebuilds)) {
  for (const dir of fs.readdirSync(prebuilds)) {
    candidates.push(path.join(prebuilds, dir, "spawn-helper"));
  }
}

for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  const mode = fs.statSync(file).mode;
  if ((mode & 0o111) === 0o111) continue;
  fs.chmodSync(file, mode | 0o755);
  console.log(`[fix-node-pty-permissions] made ${path.relative(process.cwd(), file)} executable`);
}
