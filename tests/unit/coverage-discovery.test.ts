import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

function findSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...findSourceFiles(fullPath));
    } else if (entry.isFile() && fullPath.endsWith(".ts") && !fullPath.endsWith(".d.ts") && !fullPath.endsWith(".test.ts") && !fullPath.endsWith(".spec.ts")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

describe("coverage discovery", () => {
  const srcDir = resolve(import.meta.dir, "../../orchestrating-long-tasks/scripts/src");
  const sourceFiles = findSourceFiles(srcDir);

  test("discovers production source files", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  test("dynamically imports every source module for full coverage profiling", async () => {
    for (const file of sourceFiles) {
      const module = await import(file);
      expect(module).toBeDefined();
    }
  });
});
