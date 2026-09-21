/**
 * Parses the payload of an OSC 7 escape sequence (`file://host/path`) into
 * just the path, in the form xterm.js's `Terminal.parser.registerOscHandler(7, ...)`
 * hands it to a callback — used to drive terminal->file-browser cwd following
 * (see terminal-pane.tsx). The host is intentionally ignored: we only care
 * where the shell is on the one server this terminal is already connected to.
 */
export function parseOsc7Cwd(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") return null;
  if (!url.pathname) return null;
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}
