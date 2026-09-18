/**
 * electron-builder `afterPack` hook — makes the native display-host addon's
 * dynamic library dependencies self-contained inside the .app bundle, so a
 * built .dmg works on a Mac that doesn't have Homebrew (or these specific
 * packages) installed.
 *
 * Without this, `native/nexus-display-host/build/Release/nexus_display_host.node`
 * (and the vendored FreeRDP/WinPR libs it links against — see
 * native/nexus-display-host/README.md's "Dependency licensing" section for
 * why those are a from-source build, not Homebrew's) still resolve their
 * remaining external dependencies (OpenSSL, uriparser, jansson) via absolute
 * `/opt/homebrew/...` paths baked in at build time, and the vendored libs
 * themselves via `@rpath` pointing at the dev machine's vendor/ directory.
 * The app would launch fine on any Mac (nothing else depends on this addon —
 * see the README), but connecting to an RDP profile on a machine without
 * those exact Homebrew packages (or the repo checkout) would fail with a
 * dyld "Library not loaded" error.
 *
 * This hook: copies every non-system dependency (vendored FreeRDP/WinPR, plus
 * their own OpenSSL/uriparser/jansson dependencies) flat into
 * Contents/Frameworks, rewrites every copy's own install name, embedded
 * rpath, and inter-dependencies so they resolve against sibling files in that
 * same directory, and adds an rpath to the .node file pointing at it. Only
 * runs for macOS, and no-ops cleanly if the addon hasn't been built (RDP is
 * optional — see native/nexus-display-host/README.md).
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const VENDOR_FREERDP_LIB = path.join(
  __dirname,
  "..",
  "native",
  "nexus-display-host",
  "vendor",
  "freerdp",
  "lib",
);

function otoolDeps(binaryPath) {
  const output = execFileSync("otool", ["-L", binaryPath], { encoding: "utf-8" });
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" ")[0])
    .filter(Boolean);
}

function otoolRpaths(binaryPath) {
  const output = execFileSync("otool", ["-l", binaryPath], { encoding: "utf-8" });
  const lines = output.split("\n");
  const rpaths = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "cmd LC_RPATH") {
      const match = lines[i + 2]?.match(/path (.+) \(offset/);
      if (match) rpaths.push(match[1]);
    }
  }
  return rpaths;
}

function isSystemPath(depPath) {
  return depPath.startsWith("/usr/lib/") || depPath.startsWith("/System/");
}

/**
 * Resolves a dependency string from `otool -L` to the actual file to read its
 * bytes from (`realPath`, following symlinks) and the filename other
 * binaries actually reference it by (`bundleName` — e.g. the SONAME-style
 * symlink `liburiparser.1.dylib`, NOT the versioned real file
 * `liburiparser.1.2.2.dylib` that symlink points at). Returns null for a
 * system path with nothing to bundle.
 */
function resolveDep(depPath) {
  if (isSystemPath(depPath)) return null;
  if (depPath.startsWith("@rpath/")) {
    const bundleName = path.basename(depPath);
    const candidate = path.join(VENDOR_FREERDP_LIB, bundleName);
    if (!fs.existsSync(candidate)) {
      throw new Error(`Could not resolve ${depPath} against ${VENDOR_FREERDP_LIB}`);
    }
    return { realPath: fs.realpathSync(candidate), bundleName };
  }
  return { realPath: fs.realpathSync(depPath), bundleName: path.basename(depPath) };
}

/** Walks the dependency graph starting from `rootPaths`, returning a Map of bundleName -> realPath for every non-system dylib found (excluding the roots themselves). */
function collectNonSystemDeps(rootPaths) {
  const found = new Map();
  const queue = [...rootPaths];
  const visitedRealPaths = new Set();
  while (queue.length > 0) {
    const current = queue.pop();
    const currentRealPath = fs.realpathSync(current);
    if (visitedRealPaths.has(currentRealPath)) continue;
    visitedRealPaths.add(currentRealPath);
    for (const dep of otoolDeps(currentRealPath)) {
      const resolved = resolveDep(dep);
      if (!resolved || resolved.realPath === currentRealPath) continue; // a dylib's own -id entry, or unresolvable system dep
      found.set(resolved.bundleName, resolved.realPath);
      queue.push(resolved.realPath);
    }
  }
  return found;
}

exports.default = async function bundleNativeDeps(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const contentsDir = path.join(appOutDir, `${appName}.app`, "Contents");
  const nodeFile = path.join(
    contentsDir,
    "Resources",
    "app.asar.unpacked",
    "native",
    "nexus-display-host",
    "build",
    "Release",
    "nexus_display_host.node",
  );

  if (!fs.existsSync(nodeFile)) {
    console.log("[bundle-native-deps] nexus_display_host.node not built — skipping (RDP will be unavailable).");
    return;
  }

  console.log("[bundle-native-deps] Bundling native addon's dynamic library dependencies...");

  const frameworksDir = path.join(contentsDir, "Frameworks");
  fs.mkdirSync(frameworksDir, { recursive: true });

  const deps = collectNonSystemDeps([nodeFile]); // bundleName -> realPath
  const bundledFilenames = new Set(deps.keys());

  for (const [bundleName, realPath] of deps) {
    const dest = path.join(frameworksDir, bundleName);
    fs.copyFileSync(realPath, dest);
    fs.chmodSync(dest, 0o755);
  }

  // Every dylib we just bundled needs: its own -id set to @rpath/<itself>
  // (so other bundled dylibs' dependency references resolve consistently),
  // every reference to another bundled dylib rewritten to @rpath/<that one>,
  // and any of its own embedded rpaths pointing at its *original* install
  // layout (e.g. FreeRDP's own build sets `@loader_path/../lib`, correct
  // only when lib/ siblings live one directory up) replaced with a single
  // `@loader_path` — since every bundled dependency now lives flat, as
  // siblings, directly in Contents/Frameworks.
  const bundledPaths = [...bundledFilenames].map((name) => path.join(frameworksDir, name));
  for (const bundledPath of bundledPaths) {
    execFileSync("install_name_tool", ["-id", `@rpath/${path.basename(bundledPath)}`, bundledPath]);
    for (const dep of otoolDeps(bundledPath)) {
      const filename = path.basename(dep);
      if (!bundledFilenames.has(filename)) continue;
      execFileSync("install_name_tool", ["-change", dep, `@rpath/${filename}`, bundledPath]);
    }
    for (const existingRpath of otoolRpaths(bundledPath)) {
      execFileSync("install_name_tool", ["-delete_rpath", existingRpath, bundledPath]);
    }
    execFileSync("install_name_tool", ["-add_rpath", "@loader_path", bundledPath]);

    // Homebrew ships these dylibs pre-signed. install_name_tool invalidates
    // that signature (it warns about this) without removing it, and macOS's
    // code-signing enforcement kills the process outright — SIGKILL "Code
    // Signature Invalid" — the moment it's loaded, which is a much less
    // obvious failure than an unsigned binary (those load fine locally). Ad-hoc
    // re-signing after every install_name_tool edit keeps the signature valid.
    execFileSync("codesign", ["--force", "--sign", "-", bundledPath]);
  }

  // The addon .node's own top-level references to the vendored FreeRDP/WinPR
  // dylibs are already @rpath/<name> (see native/nexus-display-host/README.md)
  // — they resolve correctly once the .node has an rpath pointing at
  // Contents/Frameworks, added below. Nothing to `-change` here.

  // binding.gyp bakes in an absolute rpath to vendor/freerdp/lib for local
  // dev builds (npm run dev/build:native run the addon straight out of
  // build/Release, with no bundling step). That path doesn't exist on
  // another machine — harmless (dyld just skips rpaths that don't resolve)
  // but pointless to ship, and it leaks the build machine's home directory
  // into the binary. Drop it from this packaged copy only.
  for (const existingRpath of otoolRpaths(nodeFile)) {
    if (existingRpath.includes("vendor/freerdp/lib")) {
      execFileSync("install_name_tool", ["-delete_rpath", existingRpath, nodeFile]);
    }
  }

  // The .node file is loaded via dlopen (Node's process.dlopen), which
  // resolves @rpath against LC_RPATH entries embedded in the loading image
  // itself, not the process's — so the addon needs its own rpath pointing at
  // Contents/Frameworks, relative via @loader_path so it works regardless of
  // where the .app is installed.
  const relFrameworks = path.relative(path.dirname(nodeFile), frameworksDir);
  execFileSync("install_name_tool", ["-add_rpath", `@loader_path/${relFrameworks}`, nodeFile]);

  // Same signature-invalidation concern as the bundled dylibs above.
  execFileSync("codesign", ["--force", "--sign", "-", nodeFile]);

  console.log(`[bundle-native-deps] Bundled ${bundledFilenames.size} dependencies into Contents/Frameworks.`);
};
