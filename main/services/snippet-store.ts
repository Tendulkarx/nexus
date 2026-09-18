/**
 * Persists the user's reusable command-snippet library (name + command text,
 * optionally tagged). Same DataStore-backed pattern as ConnectionStore, minus
 * secrets — a snippet's command text is never sensitive enough to warrant
 * credential-vault encryption.
 */
import { randomUUID } from "crypto";

import { DataStore } from "./data-store.js";

import type { CommandSnippet, SnippetInput } from "@shared/ipc-contract";

interface SnippetFile {
  version: number;
  snippets: CommandSnippet[];
}

const DEFAULT_FILE: SnippetFile = { version: 1, snippets: [] };

export class SnippetStore {
  private store = new DataStore<SnippetFile>("snippets.json", DEFAULT_FILE);

  async list(): Promise<CommandSnippet[]> {
    const data = await this.store.load();
    return data.snippets;
  }

  async create(input: SnippetInput): Promise<CommandSnippet> {
    const data = await this.store.load();
    const snippet: CommandSnippet = {
      id: randomUUID(),
      name: input.name,
      command: input.command,
      tags: input.tags ?? [],
      createdAt: Date.now(),
    };
    data.snippets.push(snippet);
    await this.store.save(data);
    return snippet;
  }

  async update(id: string, patch: Partial<SnippetInput>): Promise<CommandSnippet> {
    const data = await this.store.load();
    const snippet = data.snippets.find((s) => s.id === id);
    if (!snippet) throw new Error(`Snippet not found: ${id}`);
    if (patch.name !== undefined) snippet.name = patch.name;
    if (patch.command !== undefined) snippet.command = patch.command;
    if (patch.tags !== undefined) snippet.tags = patch.tags;
    await this.store.save(data);
    return snippet;
  }

  async delete(id: string): Promise<void> {
    const data = await this.store.load();
    data.snippets = data.snippets.filter((s) => s.id !== id);
    await this.store.save(data);
  }
}

export const snippetStore = new SnippetStore();
