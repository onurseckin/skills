import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { dirname, join, normalize } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { lintDirectory, lintFile } from "../../../olt/scripts/src/linter/ast/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const directoryLinterSuiteName =
  "AST File and Directory Recursive Linting Engine (in-memory virtualization)";

describe(directoryLinterSuiteName, () => {
  let session: VirtualFSSession;
  let vfs: VirtualMemoryFS;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  function addVirtualFile(path: string, content: string): void {
    const s = normalize(path);
    vfs.mkdirSync(dirname(s), { recursive: true });
    vfs.writeFileSync(s, content);
  }

  it("lints a single file on disk", () => {
    const testFile = "/virtual/linter/sample.ts";
    addVirtualFile(testFile, "export const x = a ?? b;");

    const result = lintFile(testFile);
    expect(result.valid).toBe(false);
    expect(result.totalViolations).toBe(1);
    expect(result.filePath).toBe(testFile);
  });

  it("throws HarnessError PATH_SAFETY if file does not exist", () => {
    const nonExistent = "/virtual/linter/non_existent_file.ts";
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
    const testDir = "/virtual/linter/project";
    addVirtualFile(join(testDir, "clean.ts"), "export const a: number = 1;");
    addVirtualFile(join(testDir, "sub", "bad.ts"), "export const b: any = 2;");

    const dirResult = lintDirectory(testDir);
    expect(dirResult.valid).toBe(false);
    expect(dirResult.totalFiles).toBe(2);
    expect(dirResult.cleanFiles).toBe(1);
    expect(dirResult.failedFiles).toBe(1);
    expect(dirResult.totalViolations).toBe(1);
    expect(dirResult.summaryByRule.any_type).toBe(1);
  });

  it("throws HarnessError PATH_SAFETY if directory does not exist or is not a directory", () => {
    const nonExistent = "/virtual/linter/no_such_directory_123";
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
