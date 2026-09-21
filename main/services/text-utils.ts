/**
 * Shared "is this a text file" heuristics used by the file preview (Quick
 * Look), the in-app quick editor, and the sync plan's diff view: a NUL-byte
 * binary-content sniff (authoritative — always checked against the actual
 * bytes), plus an extension allowlist callers can use to decide whether to
 * even offer a text-only feature before the content comes back over IPC.
 */
import type { ReadFileResult } from "@shared/ipc-contract";

/** Preview/inline-edit/diff size cutoff, shared so every feature agrees on the same cap. */
export const PREVIEW_MAX_BYTES = 256 * 1024;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "jsonc", "yml", "yaml", "toml", "ini", "cfg", "conf", "env",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "c", "cc", "cpp", "h", "hpp",
  "cs", "php", "sh", "bash", "zsh", "fish", "sql", "html", "htm", "css", "scss", "less", "xml", "svg",
  "csv", "tsv", "log", "properties", "gradle", "service", "vue", "swift", "kt", "lua", "r", "pl", "tex",
]);

/** Extensionless filenames that are still plainly text (matched on the whole lowercased name). */
const TEXT_FILENAMES = new Set(["dockerfile", "makefile", "gitignore", "gitattributes", "editorconfig"]);

export function isBinaryContent(buffer: Buffer): boolean {
  return buffer.includes(0);
}

/** Converts a raw buffer (already capped at PREVIEW_MAX_BYTES) into a text-preview result, detecting binary content. */
export function toTextPreview(buffer: Buffer): ReadFileResult {
  const isBinary = isBinaryContent(buffer);
  return {
    text: isBinary ? "" : buffer.toString("utf-8"),
    size: buffer.length,
    truncated: buffer.length >= PREVIEW_MAX_BYTES,
    isBinary,
  };
}

export function looksLikeTextByName(name: string): boolean {
  const lower = name.toLowerCase();
  if (TEXT_FILENAMES.has(lower)) return true;
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return false;
  // Covers both regular extensions (main.ts -> "ts") and dotfiles (.gitignore -> "gitignore").
  const tail = lower.slice(dot + 1);
  return TEXT_EXTENSIONS.has(tail) || TEXT_FILENAMES.has(tail);
}
