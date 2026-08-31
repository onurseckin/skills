import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  lintDirectory,
  lintFile,
} from "../../../olt/scripts/src/linter/ast/index.ts";

export const directoryLinterSuiteName = "AST File and Directory Recursive Linting Engine";

describe(directoryLinterSuiteName, () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
    }
    tempDirs.length = 0;
  });

  function createTempDir(): string {
    const dir = join(
      tmpdir(),
      `ast-linter-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);
    return dir;
  }

  it("lints a single file on disk", () => {
    const testDir = createTempDir();
    const testFile = join(testDir, "sample.ts");
    writeFileSync(testFile, "export const x = a ?? b;", "utf-8");

    const result = lintFile(testFile);
    expect(result.valid).toBe(false);
    expect(result.totalViolations).toBe(1);
    expect(result.filePath).toBe(testFile);
  });

  it("throws HarnessError PATH_SAFETY if file does not exist", () => {
    const nonExistent = join(tmpdir(), "non_existent_file.ts");
    expect(() => lintFile(nonExistent)).toThrow();

    try {
      lintFile(nonExistent);
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBe(true);
      if (err instanceof HarnessError) {
        expect(err.code).toBe("PATH_SAFETY");
      }
    }
  });

  it("lints an entire directory tree recursively", () => {
    const testDir = createTempDir();
    mkdirSync(join(testDir, "sub"), { recursive: true });
    writeFileSync(join(testDir, "clean.ts"), "export const a: number = 1;", "utf-8");
    writeFileSync(join(testDir, "sub", "bad.ts"), "export const b: any = 2;", "utf-8");

    const dirResult = lintDirectory(testDir);
    expect(dirResult.valid).toBe(false);
    expect(dirResult.totalFiles).toBe(2);
    expect(dirResult.cleanFiles).toBe(1);
    expect(dirResult.failedFiles).toBe(1);
    expect(dirResult.totalViolations).toBe(1);
    expect(dirResult.summaryByRule.any_type).toBe(1);
  });

  it("throws HarnessError PATH_SAFETY if directory does not exist or is not a directory", () => {
    const nonExistent = join(tmpdir(), "no_such_directory_123");
    expect(() => lintDirectory(nonExistent)).toThrow();

    try {
      lintDirectory(nonExistent);
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBe(true);
      if (err instanceof HarnessError) {
        expect(err.code).toBe("PATH_SAFETY");
      }
    }
  });
});
