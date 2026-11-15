import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { BotTask } from "./contracts";

export class TaskStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(readonly filename: string) {}
  async load(): Promise<BotTask[]> {
    try {
      const value = JSON.parse(await readFile(this.filename, "utf8"));
      if (value.version !== 1 || !Array.isArray(value.tasks))
        throw new Error("Unsupported task store format.");
      return value.tasks;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error(
        `Could not read saved tasks: ${(error as Error).message}`,
      );
    }
  }
  save(tasks: BotTask[]): Promise<void> {
    const content = JSON.stringify({ version: 1, tasks }, null, 2);
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.filename), { recursive: true });
        const temp = `${this.filename}.tmp`;
        await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
        await rename(temp, this.filename);
      });
    return this.pending;
  }
  flush() {
    return this.pending;
  }
}
