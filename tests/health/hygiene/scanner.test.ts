import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanRootHygiene } from "../../../olt/scripts/src/health/hygiene/index.ts";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const p of cleanupPaths.splice(0)) {
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
    }
  }
});

function createTempWorkspace(): string {
  const dir = join(tmpdir(), `test-hygiene-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  cleanupPaths.push(dir);
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(join(dir, "README.md"), "# Test");
  writeFileSync(join(dir, "tsconfig.json"), "{}");
  return dir;
}

describe("Health Hygiene - Root Hygiene Scanner", () => {
  test("scanRootHygiene handles clean workspace with zero findings", () => {
    const ws = createTempWorkspace();
    const scriptsDir = join(ws, "scripts");
    const modDir = join(scriptsDir, "modularity");
    const syncDir = join(scriptsDir, "sync");
    const oltDir = join(ws, "olt");
    const refDir = join(oltDir, "references");
    mkdirSync(modDir, { recursive: true });
    mkdirSync(syncDir, { recursive: true });
    mkdirSync(refDir, { recursive: true });
    writeFileSync(join(scriptsDir, "README.md"), "# Scripts");
    writeFileSync(join(modDir, "index.ts"), "export const mod = 1;");
    writeFileSync(join(syncDir, "index.ts"), "export const sync = 1;");
    writeFileSync(join(refDir, "notes.md"), "# Notes");

    const result = scanRootHygiene({ repoRoot: ws });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.totalEntriesScanned).toBeGreaterThan(0);
    expect(result.scanDurationMs).toBeGreaterThanOrEqual(0);
  });

  test("detects loose executables and unapproved files in repository root", () => {
    const ws = createTempWorkspace();
    writeFileSync(join(ws, "fix-pulse.ts"), "console.log(1);");
    writeFileSync(join(ws, "run-tool.sh"), "#!/bin/bash\necho 1");
    writeFileSync(join(ws, "unapproved.txt"), "data");
    mkdirSync(join(ws, "rogue_dir"), { recursive: true });

    const result = scanRootHygiene({ repoRoot: ws });
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBe(4);

    const scratchFinding = result.violations.find((v) => v.relativePath === "fix-pulse.ts");
    expect(scratchFinding).toBeDefined();
    expect(scratchFinding?.violationType).toBe("UNCONFINED_SCRATCH_SCRIPT");
    expect(scratchFinding?.scope).toBe("repo_root");

    const execFinding = result.violations.find((v) => v.relativePath === "run-tool.sh");
    expect(execFinding).toBeDefined();
    expect(execFinding?.violationType).toBe("LOOSE_EXECUTABLE");
    expect(execFinding?.isExecutable).toBe(true);

    const unapprovedFinding = result.violations.find((v) => v.relativePath === "unapproved.txt");
    expect(unapprovedFinding).toBeDefined();
    expect(unapprovedFinding?.violationType).toBe("UNAPPROVED_ROOT_FILE");

    const rogueDirFinding = result.violations.find((v) => v.relativePath === "rogue_dir");
    expect(rogueDirFinding).toBeDefined();
    expect(rogueDirFinding?.violationType).toBe("UNAPPROVED_ROOT_DIR");
  });

  test("detects loose executables, test artifacts, and unapproved dirs in scripts/ root", () => {
    const ws = createTempWorkspace();
    const scriptsDir = join(ws, "scripts");
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, "loose-runner.sh"), "#!/bin/bash\necho 1");
    writeFileSync(join(scriptsDir, "scratch-fix.ts"), "console.log(1);");
    writeFileSync(join(scriptsDir, "test-artifact.test.ts"), "describe('test', () => {});");
    writeFileSync(join(scriptsDir, "orphan.log"), "log output");
    writeFileSync(join(scriptsDir, "scratch.tmp"), "temp data");
    mkdirSync(join(scriptsDir, "unapproved_sub"), { recursive: true });

    const result = scanRootHygiene({ repoRoot: ws });
    expect(result.passed).toBe(false);

    const scriptViolations = result.violations.filter((v) => v.scope === "scripts_root");
    expect(scriptViolations.length).toBe(6);

    const execViolations = scriptViolations.filter((v) => v.violationType === "LOOSE_EXECUTABLE");
    expect(execViolations.length).toBeGreaterThanOrEqual(1);

    const testArtifacts = scriptViolations.filter(
      (v) => v.violationType === "TEST_ARTIFACT_IN_SCRIPTS",
    );
    expect(testArtifacts.length).toBeGreaterThanOrEqual(3);

    const dirViolations = scriptViolations.filter((v) => v.violationType === "UNAPPROVED_ROOT_DIR");
    expect(dirViolations.length).toBe(1);
  });

  test("detects static package runtime pollution inside olt/", () => {
    const ws = createTempWorkspace();
    const oltDir = join(ws, "olt");
    const covDir = join(oltDir, "coverage");
    mkdirSync(covDir, { recursive: true });
    writeFileSync(join(covDir, "lcov.info"), "TN:");
    writeFileSync(join(oltDir, "defects.jsonl"), "{}");
    writeFileSync(join(oltDir, "runtime.log"), "log data");

    const result = scanRootHygiene({ repoRoot: ws });
    expect(result.passed).toBe(false);

    const oltViolations = result.violations.filter((v) => v.scope === "static_package");
    expect(oltViolations.length).toBe(3);
    for (const v of oltViolations) {
      expect(v.violationType).toBe("STATIC_PACKAGE_RUNTIME_POLLUTION");
    }
  });

  test("health/hygiene files satisfy all strict repository invariants", () => {
    const files = [
      "olt/scripts/src/health/hygiene/types.ts",
      "olt/scripts/src/health/hygiene/scanner.ts",
      "olt/scripts/src/health/hygiene/quarantine.ts",
      "olt/scripts/src/health/hygiene/index.ts",
    ];

    for (const rel of files) {
      const filePath = join(process.cwd(), rel);
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf8");
      const lines = content.split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();
        const lineNum = i + 1;

        expect(trimmed.startsWith("//")).toBe(false);
        expect(trimmed.startsWith("/*")).toBe(false);
        expect(trimmed.startsWith("*")).toBe(false);

        expect(trimmed.includes("@" + "ts-ignore")).toBe(false);
        expect(trimmed.includes("@" + "ts-expect-error")).toBe(false);
        expect(trimmed.includes("@" + "ts-nocheck")).toBe(false);
        expect(trimmed.includes("eslint" + "-disable")).toBe(false);

        const hasAny =
          /\b:\s*any\b/.test(trimmed) ||
          /\bas\s+any\b/.test(trimmed) ||
          /<any>/.test(trimmed) ||
          /Record<[^,]+,\s*any>/.test(trimmed) ||
          /Promise<any>/.test(trimmed);

        if (hasAny) {
          throw new Error(`any found at line ${lineNum}: ${trimmed}`);
        }
        expect(hasAny).toBe(false);
      }
    }

    const testFilePath = join(process.cwd(), "tests/health/hygiene/scanner.test.ts");
    expect(existsSync(testFilePath)).toBe(true);
    const testContent = readFileSync(testFilePath, "utf8");
    const testLines = testContent.split("\n");
    expect(testLines.length).toBeLessThanOrEqual(300);
  });
});
