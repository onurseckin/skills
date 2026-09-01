import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { dirname, join, normalize } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { lintDirectory, lintFile } from "../../../olt/scripts/src/linter/ast/index.ts";

export const directoryLinterSuiteName =
  "AST File and Directory Recursive Linting Engine (in-memory virtualization)";

describe(directoryLinterSuiteName, () => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  let existsSpy: ReturnType<typeof spyOn>;
  let statSpy: ReturnType<typeof spyOn>;
  let lstatSpy: ReturnType<typeof spyOn>;
  let readdirSpy: ReturnType<typeof spyOn>;
  let readFileSyncSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    files.clear();
    dirs.clear();

    existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = normalize(String(p));
      return files.has(s) || dirs.has(s);
    });

    statSpy = spyOn(fs, "statSync").mockImplementation((p) => {
      const s = normalize(String(p));
      const isD = dirs.has(s);
      const isF = files.has(s);
      if (!isD && !isF) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${s}'`), {
          code: "ENOENT",
        });
      }
      const content = files.get(s) ?? "";
      return {
        isFile: () => isF,
        isDirectory: () => isD,
        isSymbolicLink: () => false,
        size: Buffer.byteLength(content),
        mtimeMs: Date.now(),
      } as unknown as fs.Stats;
    });

    lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => {
      const s = normalize(String(p));
      const isD = dirs.has(s);
      const isF = files.has(s);
      if (!isD && !isF) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${s}'`), {
          code: "ENOENT",
        });
      }
      const content = files.get(s) ?? "";
      return {
        isFile: () => isF,
        isDirectory: () => isD,
        isSymbolicLink: () => false,
        size: Buffer.byteLength(content),
        mtimeMs: Date.now(),
      } as unknown as fs.Stats;
    });

    readdirSpy = spyOn(fs, "readdirSync").mockImplementation((p, options) => {
      const s = normalize(String(p));
      const names = new Set<string>();
      for (const f of files.keys()) {
        if (f.startsWith(s) && f !== s) {
          const sub = f.slice(s.length).replace(/^[/\\]+/, "");
          const first = sub.split(/[/\\]/)[0];
          if (first) names.add(first);
        }
      }
      for (const d of dirs) {
        if (d.startsWith(s) && d !== s) {
          const sub = d.slice(s.length).replace(/^[/\\]+/, "");
          const first = sub.split(/[/\\]/)[0];
          if (first) names.add(first);
        }
      }
      const arr = [...names];
      if (
        typeof options === "object" &&
        options !== null &&
        (options as { withFileTypes?: boolean }).withFileTypes
      ) {
        return arr.map((name) => ({
          name,
          isDirectory: () => dirs.has(join(s, name)),
          isFile: () => files.has(join(s, name)),
          isSymbolicLink: () => false,
        })) as unknown as fs.Dirent[];
      }
      return arr as unknown as string[];
    });

    readFileSyncSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const s = normalize(String(p));
      const val = files.get(s);
      if (val === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${s}'`), {
          code: "ENOENT",
        });
      }
      return val;
    });
  });

  afterEach(() => {
    existsSpy.mockRestore();
    statSpy.mockRestore();
    lstatSpy.mockRestore();
    readdirSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });

  function addVirtualFile(path: string, content: string): void {
    const s = normalize(path);
    files.set(s, content);
    let curr = dirname(s);
    while (curr && curr !== "/" && curr !== ".") {
      dirs.add(curr);
      curr = dirname(curr);
    }
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
