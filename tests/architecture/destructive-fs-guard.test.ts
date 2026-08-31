import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const oltScriptsRoot = join(repoRoot, "olt/scripts/src");
const syncScriptsRoot = join(repoRoot, "scripts");

const GUARD_MODULES = [
  join(oltScriptsRoot, "core/shared/safe-fs/index.ts"),
  join(oltScriptsRoot, "core/shared/safe-fs/atomic.ts"),
];

const installerPathSafetyRoot = join(oltScriptsRoot, "installer");

async function filesBelow(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return filesBelow(path);
      return path.endsWith(".ts") ? [path] : [];
    }),
  );
  return nested.flat();
}

const RECURSIVE_CAPABLE_CALL = /\b(rmSync|rmdirSync|cpSync|\brm|\bcp)\s*\(/g;

function callArguments(source: string, afterOpenParenIndex: number): string {
  let depth = 1;
  let i = afterOpenParenIndex;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    i++;
  }
  return source.slice(afterOpenParenIndex, depth === 0 ? i - 1 : i);
}

function hasRecursiveTrueNear(source: string, afterOpenParenIndex: number): boolean {
  return /recursive\s*:\s*true/.test(callArguments(source, afterOpenParenIndex));
}

describe("destructive filesystem guard", () => {
  test("every recursive rm/rmdir/cp call in production code is routed through safe-fs.ts or an identity-guarded installer module", async () => {
    const prodFiles = [
      ...(await filesBelow(oltScriptsRoot)),
      ...(await filesBelow(syncScriptsRoot)),
    ];
    const violations: string[] = [];
    for (const path of prodFiles) {
      if (GUARD_MODULES.includes(path)) continue;
      if (path.endsWith(".test.ts")) continue;
      if (path.startsWith(installerPathSafetyRoot + "/")) continue;
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(RECURSIVE_CAPABLE_CALL)) {
        const matchEnd = (match.index ?? 0) + match[0].length;
        if (hasRecursiveTrueNear(source, matchEnd)) {
          const lineNumber = source.slice(0, matchEnd).split("\n").length;
          violations.push(`${relative(repoRoot, path)}:${lineNumber} unguarded ${match[1]}(...)`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("every installer file with a recursive rm/cp call imports the path-safety identity guard", async () => {
    const installerFiles = (await filesBelow(installerPathSafetyRoot)).filter(
      (path) => path !== join(installerPathSafetyRoot, "path-safety.ts"),
    );
    const violations: string[] = [];
    for (const path of installerFiles) {
      const source = await readFile(path, "utf8");
      const hasRecursiveCall = [...source.matchAll(RECURSIVE_CAPABLE_CALL)].some((match) =>
        hasRecursiveTrueNear(source, (match.index ?? 0) + match[0].length),
      );
      if (hasRecursiveCall && !source.includes("./path-safety.ts")) {
        violations.push(relative(repoRoot, path));
      }
    }
    expect(violations).toEqual([]);
  });
});
