/**
 * IPC handlers for command-snippet CRUD. Thin — logic lives in SnippetStore.
 */
import { ipcMain } from "electron";

import { asRecord, reqString } from "./validate.js";
import { snippetStore } from "../services/snippet-store.js";
import { normalizeMacro } from "../../renderer/shared/macros.js";

import { IPC } from "../../renderer/shared/ipc-contract.js";
import type { SnippetInput } from "@shared/ipc-contract";

function coerceTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === "string") : [];
}

function coerceInput(value: unknown, context: string): SnippetInput {
  const obj = asRecord(value, context);
  return {
    name: reqString(obj, "name", context),
    command: reqString(obj, "command", context),
    tags: coerceTags(obj.tags),
    macro: normalizeMacro(obj.macro),
  };
}

function coercePatch(value: unknown, context: string): Partial<SnippetInput> {
  const obj = asRecord(value, context);
  const patch: Partial<SnippetInput> = {};
  if (typeof obj.name === "string") patch.name = obj.name;
  if (typeof obj.command === "string") patch.command = obj.command;
  if (Array.isArray(obj.tags)) patch.tags = coerceTags(obj.tags);
  if ("macro" in obj) patch.macro = normalizeMacro(obj.macro);
  return patch;
}

export function registerSnippetHandlers(): void {
  ipcMain.handle(IPC.snippet.list, async () => ({ snippets: await snippetStore.list() }));

  ipcMain.handle(IPC.snippet.create, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "snippet:create");
    return snippetStore.create(coerceInput(obj.input, "snippet:create.input"));
  });

  ipcMain.handle(IPC.snippet.update, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "snippet:update");
    const id = reqString(obj, "id", "snippet:update");
    return snippetStore.update(id, coercePatch(obj.patch, "snippet:update.patch"));
  });

  ipcMain.handle(IPC.snippet.delete, async (_e, payload: unknown) => {
    const obj = asRecord(payload, "snippet:delete");
    await snippetStore.delete(reqString(obj, "id", "snippet:delete"));
    return { ok: true as const };
  });
}
