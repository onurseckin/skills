import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join, relative } from "node:path";
import {
  cleanupVirtualArchitectureFS,
  scratchRoot,
  setupVirtualArchitectureFS,
} from "../fixtures/architecture-fixture.ts";

let vfs: ReturnType<typeof setupVirtualArchitectureFS>;

beforeEach(() => {
  vfs = setupVirtualArchitectureFS();
});

afterEach(() => {
  cleanupVirtualArchitectureFS();
});

function filesBelow(root: string): string[] {
  if (!vfs.existsSync(root)) return [];
  const entries = vfs.readdirSync(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...filesBelow(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
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

function findShellExecution(roots: string[], baseDir = ""): string[] {
  const files = roots.flatMap((root) => filesBelow(root));
  const findings: string[] = [];
  for (const file of files) {
    const source = vfs.readFileSync(file, "utf8");
    for (const label of new Set(scanSourceForShellExecution(source))) {
      findings.push(`${baseDir ? relative(baseDir, file) : file} uses ${label}`);
    }
  }
  return findings.sort();
}

describe("shell execution is not permitted in harness source", () => {
  test("no source file spawns a shell in compliant virtual tree", () => {
    const root = scratchRoot(import.meta.path, "shell-guard-compliant");
    vfs.mkdirSync(join(root, "src"), { recursive: true });
    vfs.writeFileSync(
      join(root, "src/safe.ts"),
      'export function run(cmd: string) { return "ok"; }',
    );
    vfs.writeFileSync(
      join(root, "src/worker.ts"),
      'spawnSync("git", ["status"], { shell: false });',
    );
    const findings = findShellExecution([root], root);
    expect(findings).toEqual([]);
  });

  test("the scan discovers shell invocations in virtual file tree", () => {
    const root = scratchRoot(import.meta.path, "shell-guard-violating");
    vfs.mkdirSync(join(root, "src"), { recursive: true });
    vfs.writeFileSync(join(root, "src/bad.ts"), 'execSync("rm -rf /");');
    vfs.writeFileSync(
      join(root, "src/bad2.ts"),
      'const s = spawnSync("/bin/sh", ["-c", cmd], { shell: true });',
    );
    const findings = findShellExecution([root], root);
    expect(findings).toEqual([
      "src/bad.ts uses execSync",
      "src/bad2.ts uses /bin/sh",
      "src/bad2.ts uses shell: true",
    ]);
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
