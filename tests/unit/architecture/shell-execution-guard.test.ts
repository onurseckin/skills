import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const oltScriptsRoot = join(repoRoot, "olt/scripts/src");
const syncScriptsRoot = join(repoRoot, "scripts");

async function filesBelow(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return filesBelow(path);
      return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
    }),
  );
  return nested.flat();
}

const SHELL_EXECUTION_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "execSync", pattern: /(?<![A-Za-z0-9_])execSync\s*\(/ },
  { label: "shell: true", pattern: /(?<![A-Za-z0-9_])shell\s*:\s*true/ },
  { label: "/bin/sh", pattern: /["']\/bin\/(sh|bash)["']/ },
  { label: "sh -c", pattern: /["'](sh|bash)["']\s*,\s*\[\s*["']-c["']/ },
  { label: "Bun.$", pattern: /Bun\.\$/ },
];

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

export function scanSourceForShellExecution(source: string): string[] {
  const hits: string[] = [];
  for (const line of source.split("\n")) {
    if (isCommentLine(line)) continue;
    for (const { label, pattern } of SHELL_EXECUTION_PATTERNS) {
      if (pattern.test(line)) hits.push(label);
    }
  }
  return hits;
}

async function findShellExecution(): Promise<string[]> {
  const files = [...(await filesBelow(oltScriptsRoot)), ...(await filesBelow(syncScriptsRoot))];
  const findings: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf-8");
    for (const label of new Set(scanSourceForShellExecution(source))) {
      findings.push(`${relative(repoRoot, file)} uses ${label}`);
    }
  }
  return findings.sort();
}

describe("shell execution is not permitted in harness source", () => {
  test("no source file spawns a shell", async () => {
    const findings = await findShellExecution();
    expect(findings).toEqual([]);
  });

  test("the scan actually detects a shell invocation", () => {
    const sample = 'const r = spawnSync("/bin/sh", ["-c", command], { shell: true });';
    const matched = scanSourceForShellExecution(sample);
    expect(matched).toContain("/bin/sh");
    expect(matched).toContain("shell: true");
    expect(scanSourceForShellExecution('execSync("git status");')).toContain("execSync");
  });

  test("the scan does not flag argv spawning, permission flags, or comments", () => {
    expect(scanSourceForShellExecution('spawnSync("git", ["status"], { shell: false });')).toEqual(
      [],
    );
    expect(scanSourceForShellExecution("return { can_execute_shell: true };")).toEqual([]);
    expect(scanSourceForShellExecution("  // zero-shell roles can never be set to true")).toEqual(
      [],
    );
  });
});
