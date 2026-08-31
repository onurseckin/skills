import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const invariantsSuiteName = "Defect Pipeline - Static Code Invariants";

function collectTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.endsWith(".ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

describe(invariantsSuiteName, () => {
  it("strictly enforces 0 TypeScript any and 0 compiler/linter suppressions across all defect files", () => {
    const srcDir = join(process.cwd(), "olt/scripts/src/mind/defects");
    const testDir = join(process.cwd(), "tests/defects");

    const allFiles = [...collectTsFiles(srcDir), ...collectTsFiles(testDir)];
    expect(allFiles.length).toBeGreaterThan(0);

    const forbiddenPatterns = [
      new RegExp(":\\s*" + "any\\b"),
      new RegExp("\\bas\\s+" + "any\\b"),
      new RegExp("<" + "any>"),
      new RegExp("Record<string,\\s*" + "any>"),
      new RegExp("Promise<" + "any>"),
      new RegExp("@ts-" + "ignore"),
      new RegExp("@ts-" + "expect-error"),
      new RegExp("@ts-" + "nocheck"),
      new RegExp(["es", "lint", "-disable"].join("")),
    ];

    for (const filePath of allFiles) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        const trimmed = line.trim();

        // Skip comment lines or test regex definition lines
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("/*") ||
          trimmed.includes("forbiddenPatterns") ||
          trimmed.includes("new RegExp")
        ) {
          continue;
        }

        for (const pattern of forbiddenPatterns) {
          const matched = pattern.test(line);
          if (matched) {
            throw new Error(
              `File ${filePath}:${i + 1} violated invariant with pattern ${pattern.source}: "${line}"`,
            );
          }
          expect(matched).toBe(false);
        }
      }
    }
  });
});
