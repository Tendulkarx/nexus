/**
 * Generic cached JSON store persisted under app.getPath("userData").
 * Never stores data in the repository. Handles a missing file gracefully.
 */
import * as fs from "fs/promises";
import * as path from "path";

import { app } from "@glaze/core/backend";

export class DataStore<T> {
  private cache: T | null = null;
  private filePath: string | null = null;

  constructor(
    private readonly filename: string,
    private readonly defaultValue: T,
  ) {}

  private async getFilePath(): Promise<string> {
    if (!this.filePath) {
      const userDataPath = app.getPath("userData");
      await fs.mkdir(userDataPath, { recursive: true });
      this.filePath = path.join(userDataPath, this.filename);
    }
    return this.filePath;
  }

  async load(): Promise<T> {
    if (this.cache !== null) return this.cache;
    try {
      const filePath = await this.getFilePath();
      const data = await fs.readFile(filePath, "utf-8");
      this.cache = JSON.parse(data) as T;
    } catch {
      // File doesn't exist yet or is unreadable — start from defaults.
      this.cache = this.defaultValue;
    }
    return this.cache;
  }

  async save(data: T): Promise<void> {
    this.cache = data;
    const filePath = await this.getFilePath();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}
