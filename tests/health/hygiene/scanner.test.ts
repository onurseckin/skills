import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { scanRootHygiene } from "../../../olt/scripts/src/health/hygiene/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const repoRoot = process.cwd();

const HEALTH_FILES = [
  "olt/scripts/src/health/hygiene/types.ts",
  "olt/scripts/src/health/hygiene/scanner.ts",
  "olt/scripts/src/health/hygiene/quarantine.ts",
  "olt/scripts/src/health/hygiene/index.ts",
  "tests/health/hygiene/scanner.test.ts",
] as const;

const HEALTH_SNAPSHOT: Record<string, string> = {};

let vfs: VirtualMemoryFS;
let session: VirtualFSSession;

beforeAll(async () => {
  for (const rel of HEALTH_FILES) {
    const p = join(repoRoot, rel);
    HEALTH_SNAPSHOT[p] = await Bun.file(p).text();
  }
});

beforeEach(() => {
  vfs = new VirtualMemoryFS();
  session = createVirtualFSSession(vfs);
  vfs.loadSnapshot(HEALTH_SNAPSHOT);
});

afterEach(() => {
  session.cleanup();
});

function createTempWorkspace(): string {
  const dir = `/virtual/test-hygiene-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  vfs.mkdirSync(dir, { recursive: true });
  vfs.writeFileSync(join(dir, "package.json"), "{}");
  vfs.writeFileSync(join(dir, "README.md"), "# Test");
  vfs.writeFileSync(join(dir, "tsconfig.json"), "{}");
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
    vfs.mkdirSync(modDir, { recursive: true });
    vfs.mkdirSync(syncDir, { recursive: true });
    vfs.mkdirSync(refDir, { recursive: true });
    vfs.writeFileSync(join(scriptsDir, "README.md"), "# Scripts");
    vfs.writeFileSync(join(modDir, "index.ts"), "export const mod = 1;");
    vfs.writeFileSync(join(syncDir, "index.ts"), "export const sync = 1;");
    vfs.writeFileSync(join(refDir, "notes.md"), "# Notes");

    const result = scanRootHygiene({ repoRoot: ws });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.totalEntriesScanned).toBeGreaterThan(0);
    expect(result.scanDurationMs).toBeGreaterThanOrEqual(0);
  });

  test("detects loose executables and unapproved files in repository root", () => {
    const ws = createTempWorkspace();
    vfs.writeFileSync(join(ws, "fix-pulse.ts"), "console.log(1);");
    vfs.writeFileSync(join(ws, "run-tool.sh"), "#!/bin/bash\necho 1");
    vfs.writeFileSync(join(ws, "unapproved.txt"), "data");
    vfs.mkdirSync(join(ws, "rogue_dir"), { recursive: true });

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
    vfs.mkdirSync(scriptsDir, { recursive: true });
    vfs.writeFileSync(join(scriptsDir, "loose-runner.sh"), "#!/bin/bash\necho 1");
    vfs.writeFileSync(join(scriptsDir, "scratch-fix.ts"), "console.log(1);");
    vfs.writeFileSync(join(scriptsDir, "test-artifact.test.ts"), "describe('test', () => {});");
    vfs.writeFileSync(join(scriptsDir, "orphan.log"), "log output");
    vfs.writeFileSync(join(scriptsDir, "scratch.tmp"), "temp data");
    vfs.mkdirSync(join(scriptsDir, "unapproved_sub"), { recursive: true });

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
    vfs.mkdirSync(covDir, { recursive: true });
    vfs.writeFileSync(join(covDir, "lcov.info"), "TN:");
    vfs.writeFileSync(join(oltDir, "defects.jsonl"), "{}");
    vfs.writeFileSync(join(oltDir, "runtime.log"), "log data");

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
      const filePath = join(repoRoot, rel);
      expect(vfs.existsSync(filePath)).toBe(true);
      const content = vfs.readFileSync(filePath, "utf8");
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
          new RegExp(":\\s*" + "any\\b").test(trimmed) ||
          new RegExp("as\\s+" + "any\\b").test(trimmed) ||
          new RegExp("<" + "any>").test(trimmed) ||
          new RegExp("Record<[^,]+,\\s*" + "any>").test(trimmed) ||
          new RegExp("Promise<" + "any>").test(trimmed);

        if (hasAny) {
          throw new Error(`any found at line ${lineNum}: ${trimmed}`);
        }
        expect(hasAny).toBe(false);
      }
    }

    const testFilePath = join(repoRoot, "tests/health/hygiene/scanner.test.ts");
    expect(vfs.existsSync(testFilePath)).toBe(true);
    const testContent = vfs.readFileSync(testFilePath, "utf8");
    const testLines = testContent.split("\n");
    expect(testLines.length).toBeLessThanOrEqual(300);
  });
});
