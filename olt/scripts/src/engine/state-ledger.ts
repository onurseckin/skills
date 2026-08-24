import { writeFileSync, renameSync, readFileSync, existsSync } from "node:fs";

export class StateLedger {
  private cache: string[] = [];

  constructor(private path: string) {}

  appendState(state: string): void {
    this.cache.push(state);
    const tmpPath = `${this.path}.tmp`;
    const current = this.readAll();
    current.push(state);
    writeFileSync(tmpPath, JSON.stringify(current), { encoding: "utf8" });
    renameSync(tmpPath, this.path);
  }

  readAll(): string[] {
    if (this.cache.length > 0) return [...this.cache];
    if (!existsSync(this.path)) return [];
    try {
      const content = readFileSync(this.path, { encoding: "utf8" });
      const parsed = JSON.parse(content) as unknown;
      if (Array.isArray(parsed)) {
        const result = parsed.filter((v): v is string => typeof v === "string");
        this.cache = [...result];
        return result;
      }
      return [];
    } catch {
      return [];
    }
  }
}
