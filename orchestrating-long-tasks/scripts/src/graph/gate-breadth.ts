import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { commandIsWeak } from "./gate-command-policy.ts";

export function namesATarget(token: string): boolean {
  if (token.startsWith("-")) return false;
  return token.includes("/") || token.includes(".") || token.includes("*");
}

const BARE_TEST_RUNNER_VERBS = new Set([
  "test",
  "check",
  "spec",
  "vitest",
  "jest",
  "pytest",
  "cargo",
]);

function isBareTestRunnerInvocation(tokens: readonly string[]): boolean {
  return tokens.some(
    (t) => BARE_TEST_RUNNER_VERBS.has(t) || t.endsWith(":test") || t.endsWith(":unit"),
  );
}

export function looksWholeSuite(gate: string): boolean {
  const tokens = gate.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  if (tokens.some(namesATarget)) return false;
  return isBareTestRunnerInvocation(tokens) || !commandIsWeak(tokens);
}

export function scopeIsNarrow(writeScope: readonly string[]): boolean {
  if (writeScope.length === 0) return false;
  return writeScope.every((s) => {
    const trimmed = s.trim();
    return trimmed !== "" && trimmed !== "." && trimmed !== "/" && trimmed !== "**";
  });
}

export function gateBreadthWarning(
  gate: string,
  writeScope: readonly string[],
): string | undefined {
  if (!looksWholeSuite(gate) || !scopeIsNarrow(writeScope)) return undefined;
  return (
    `gate "${gate}" looks like a whole-suite run while the write scope is ${writeScope.join(", ")}. ` +
    `A task gate should prove its own scope; the run-wide suite belongs to --completion-gate.`
  );
}

const TEST_FILE_PATTERN = /(\.(test|spec)\.[cm]?[jt]sx?|_test\.py|_spec\.rb)$/u;

const COLOCATED_TEST_DIRS: readonly string[] = ["__tests__", "tests", "test"];

const MIRROR_TEST_ROOTS: readonly string[] = ["tests/unit", "tests", "test", "spec"];

function isTestFileName(name: string): boolean {
  return TEST_FILE_PATTERN.test(name);
}

function testFileNamesIn(absDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return [];
  }
  return entries.filter(isTestFileName).map((name) => join(absDir, name));
}

function isExistingDirectory(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function mirrorStem(segments: readonly string[]): string[] {
  const srcAt = segments.lastIndexOf("src");
  return srcAt === -1 ? [...segments] : segments.slice(srcAt + 1);
}

export function discoverGatePaths(repoRoot: string, writeScope: readonly string[]): string[] {
  const found = new Set<string>();
  const record = (absPath: string): void => {
    found.add(relative(repoRoot, absPath));
  };
  for (const raw of writeScope) {
    const trimmed = raw.trim();
    if (!scopeIsNarrow([trimmed])) continue;
    const absScope = resolve(repoRoot, trimmed);
    if (!existsSync(absScope)) continue;
    for (const path of testFileNamesIn(absScope)) record(path);
    for (const dirName of COLOCATED_TEST_DIRS) {
      const colocated = join(absScope, dirName);
      if (isExistingDirectory(colocated)) record(colocated);
    }
    const stem = mirrorStem(trimmed.split("/").filter(Boolean));
    const leaf = stem.at(-1);
    const parentStem = stem.slice(0, -1);
    for (const root of MIRROR_TEST_ROOTS) {
      const mirroredDir = resolve(repoRoot, ...root.split("/"), ...stem);
      if (mirroredDir !== absScope && isExistingDirectory(mirroredDir)) record(mirroredDir);
      if (leaf === undefined) continue;
      const mirroredParent = resolve(repoRoot, ...root.split("/"), ...parentStem);
      for (const path of testFileNamesIn(mirroredParent)) {
        if (path.split(/[/\\]/u).at(-1)?.startsWith(`${leaf}.`) === true) record(path);
      }
    }
  }
  return [...found].sort();
}
