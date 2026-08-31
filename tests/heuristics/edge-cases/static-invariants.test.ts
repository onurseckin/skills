/**
 * @file static-invariants.test.ts
 * Automated static AST and token invariant verification across Heuristics & Mind test suites.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

describe("Static Invariant Verification: Zero TypeScript any, Zero Suppressions & <= 300 LOC", () => {
  const getTsFilesRecursively = (dir: string): string[] => {
    const results: string[] = [];
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          results.push(...getTsFilesRecursively(fullPath));
        } else if (entry.endsWith(".ts")) {
          results.push(fullPath);
        }
      }
    } catch {
      // Directory may not exist yet during incremental runs
    }
    return results;
  };

  it("verifies all edge-cases heuristic test files satisfy strict monorepo rules", () => {
    const edgeCasesDir = join(import.meta.dir);
    const files = getTsFilesRecursively(edgeCasesDir);

    expect(files.length).toBeGreaterThanOrEqual(6);

    const forbiddenAnyForms = [
      ":" + " any",
      "as" + " any",
      "<" + "any>",
      "Array<" + "any>",
      "Record<string," + " any>",
      "Promise<" + "any>",
    ];

    const forbiddenSupTokens = [
      "@" + "ts-ignore",
      "@" + "ts-expect-error",
      "@" + "ts-nocheck",
      "eslint-" + "disable",
      "oxlint-" + "disable",
    ];

    for (const filePath of files) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      expect(lines.length).toBeLessThanOrEqual(300);

      const invalidLines = lines.filter((line, idx) => {
        if (filePath.endsWith("static-invariants.test.ts")) {
          const blockStart = lines.findIndex((l) => l.includes("const forbiddenAnyForms = ["));
          const blockEnd = lines.findIndex((l) => l.includes("for (const filePath of files) {"));
          if (blockStart !== -1 && blockEnd !== -1 && idx >= blockStart && idx <= blockEnd) {
            return false;
          }
        }
        return (
          forbiddenAnyForms.some((token) => line.includes(token)) ||
          forbiddenSupTokens.some((token) => line.includes(token))
        );
      });

      expect(invalidLines).toEqual([]);
    }
  });
});
