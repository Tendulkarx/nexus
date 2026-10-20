/**
 * Tool tabs share the open-tabs store with sessions (lib/open-sessions-store.ts)
 * under ids like "tool:port-scanner", so they get the same tab strip, ⌘W and
 * keep-mounted behaviour. One tab per tool: opening it again focuses it.
 * Kept free of React components so the shell, palette and tests can import it.
 */
import { addOpenSession, closeOpenSession } from "../lib/open-sessions-store";

export type ToolId = "port-scanner" | "network-scanner" | "diff" | "folder-compare" | "homebrew" | "cron";

export const TOOL_IDS: readonly ToolId[] = [
  "port-scanner",
  "network-scanner",
  "diff",
  "folder-compare",
  "homebrew",
  "cron",
];

export const TOOL_INFO: Record<ToolId, { name: string; description: string }> = {
  "port-scanner": { name: "Port scanner", description: "Find open TCP ports on a host" },
  "network-scanner": { name: "Network scanner", description: "Find live hosts on a subnet" },
  diff: { name: "Diff", description: "Compare two texts or files side by side" },
  "folder-compare": { name: "Folder compare", description: "Compare two local folders" },
  homebrew: { name: "Homebrew", description: "Install and update tools and apps" },
  cron: { name: "Cron", description: "Edit scheduled jobs on a server or this Mac" },
};

const PREFIX = "tool:";

export function toolTabId(id: ToolId): string {
  return `${PREFIX}${id}`;
}

/** The tool a tab id refers to, or null for session ids and "connections". */
export function parseToolTab(viewId: string): ToolId | null {
  if (!viewId.startsWith(PREFIX)) return null;
  const id = viewId.slice(PREFIX.length) as ToolId;
  return TOOL_IDS.includes(id) ? id : null;
}

export function openTool(id: ToolId): void {
  addOpenSession(toolTabId(id));
}

export function closeTool(id: ToolId): void {
  closeOpenSession(toolTabId(id));
}

// ── Network scanner → port scanner hand-off ──────────────────────────────

/** Fired when a host is queued for an already-open port scanner. */
export const PORT_SCAN_HOST_EVENT = "nexus:port-scan-host";

let pendingPortScanHost: string | null = null;

/**
 * Opens the port scanner with `host` filled in. Held in a module variable
 * because the scanner may not be mounted yet; it takes the value on mount, or
 * on PORT_SCAN_HOST_EVENT when it already is.
 */
export function openPortScannerFor(host: string): void {
  pendingPortScanHost = host;
  openTool("port-scanner");
  window.dispatchEvent(new CustomEvent(PORT_SCAN_HOST_EVENT));
}

export function takePendingPortScanHost(): string | null {
  const host = pendingPortScanHost;
  pendingPortScanHost = null;
  return host;
}
