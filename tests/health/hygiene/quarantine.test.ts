import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertCleanRootHygiene,
  DEFAULT_ALLOWED_SCRIPTS_DIRS,
  DEFAULT_ALLOWED_SCRIPTS_FILES,
  RootHygieneEngine,
  scanRootHygiene,
} from "../../../olt/scripts/src/health/hygiene/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualHealthFS, setupVirtualHealthFS } from "../fixture.ts";

beforeEach(() => {
  setupVirtualHealthFS();
});

afterEach(() => {
  cleanupVirtualHealthFS();
});

function createTempWorkspace(): string {
  const dir = `/virtual/test-hygiene-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(join(dir, "README.md"), "# Test");
  writeFileSync(join(dir, "tsconfig.json"), "{}");
  return dir;
}

describe("Health Hygiene - Quarantine Engine & Clean Assertions", () => {
  test("quarantines misplaced files and succeeds on second scan with fix=true", () => {
    const ws = createTempWorkspace();
    const scriptsDir = join(ws, "scripts");
    mkdirSync(scriptsDir, { recursive: true });
    const rogueFile = join(scriptsDir, "rogue-script.sh");
    const testArtFile = join(scriptsDir, "loose-test.test.ts");
    const rootFixFile = join(ws, "fix-something.ts");
    writeFileSync(rogueFile, "#!/bin/bash\necho rogue");
    writeFileSync(testArtFile, "export const t = 1;");
    writeFileSync(rootFixFile, "export const f = 2;");

    const qCustomDir = join(ws, "scratch", "quarantine");
    const firstResult = scanRootHygiene({ repoRoot: ws, fix: true, quarantineDir: qCustomDir });
    expect(firstResult.passed).toBe(false);
    expect(firstResult.quarantinedFiles.length).toBe(3);

    for (const record of firstResult.quarantinedFiles) {
      expect(record.success).toBe(true);
      expect(existsSync(record.quarantinePath)).toBe(true);
      expect(existsSync(record.originalPath)).toBe(false);
    }

    const secondResult = scanRootHygiene({ repoRoot: ws });
    expect(secondResult.passed).toBe(true);
    expect(secondResult.violations).toHaveLength(0);
  });

  test("assertCleanRootHygiene throws HarnessError on dirty repo and passes on clean repo", () => {
    const ws = createTempWorkspace();
    expect(() => assertCleanRootHygiene({ repoRoot: ws })).not.toThrow();

    writeFileSync(join(ws, "dirty-script.ts"), "console.log(1);");
    expect(() => assertCleanRootHygiene({ repoRoot: ws })).toThrow(HarnessError);

    try {
      assertCleanRootHygiene({ repoRoot: ws });
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBe(true);
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("PATH_SAFETY");
      expect(harnessErr.message).toContain("[ROOT_HYGIENE_VIOLATION]");
    }
  });

  test("RootHygieneEngine encapsulates scanner and quarantine workflows", () => {
    const ws = createTempWorkspace();
    const engine = new RootHygieneEngine({ repoRoot: ws });
    expect(engine.scan().passed).toBe(true);
    expect(() => engine.assertClean()).not.toThrow();

    writeFileSync(join(ws, "fix-test.ts"), "const x = 1;");
    const scanRes = engine.scan();
    expect(scanRes.passed).toBe(false);

    const records = engine.quarantine(scanRes.violations);
    expect(records.length).toBe(1);
    expect(records[0]?.success).toBe(true);
    expect(engine.scan().passed).toBe(true);

    expect(DEFAULT_ALLOWED_SCRIPTS_DIRS.has("modularity")).toBe(true);
    expect(DEFAULT_ALLOWED_SCRIPTS_FILES.has("README.md")).toBe(true);
  });
});
