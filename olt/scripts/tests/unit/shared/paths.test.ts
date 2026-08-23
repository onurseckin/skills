import { describe, it, expect, mock, spyOn, beforeEach, afterEach, type Mock } from "bun:test";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import * as fs from "node:fs";
import {
  findRepoRoot,
  resolveOltDir,
  resolveCapsulesDir,
  resolvePolicyPath,
  resolveBacklogPath,
  resolveCompletedTasksPath,
  resolveDefectsPath,
  resolveCompletedDefectsPath,
  resolveTelemetryPath,
  resolveMemoryPath,
  resolveWatchdogsPath,
  resolveScratchDir,
  resolveEvidenceDir,
  OLT_DIR_NAME,
  OLT_FILES,
} from "../../../src/shared/paths.ts";

describe("paths", () => {
  let mockExistsSync: Mock<typeof fs.existsSync>;

  beforeEach(() => {
    mockExistsSync = spyOn(fs, "existsSync").mockImplementation(() => false);
  });

  afterEach(() => {
    mockExistsSync.mockRestore();
  });

  describe("findRepoRoot", () => {
    it("should find the root when .olt exists", () => {
      const startDir = resolve("/a/b/c");
      mockExistsSync.mockImplementation((path: fs.PathLike) => {
        return String(path) === join(resolve("/a/b"), OLT_DIR_NAME);
      });
      const root = findRepoRoot(startDir);
      expect(root).toBe(resolve("/a/b"));
    });

    it("should find the root when package.json exists", () => {
      const startDir = resolve("/a/b/c");
      mockExistsSync.mockImplementation((path: fs.PathLike) => {
        return String(path) === join(resolve("/a"), "package.json");
      });
      const root = findRepoRoot(startDir);
      expect(root).toBe(resolve("/a"));
    });

    it("should fallback to startDir if no root indicator is found", () => {
      const startDir = resolve("/a/b/c");
      const root = findRepoRoot(startDir);
      expect(root).toBe(startDir);
    });
  });

  describe("resolvers without custom path", () => {
    const fakeRoot = resolve("/fake/root");

    beforeEach(() => {
      mockExistsSync.mockImplementation((path: fs.PathLike) => {
        return String(path) === join(fakeRoot, "package.json");
      });
    });

    it("should resolve olt dir", () => {
      expect(resolveOltDir(fakeRoot)).toBe(join(fakeRoot, ".olt"));
    });

    it("should resolve capsules dir", () => {
      expect(resolveCapsulesDir(fakeRoot)).toBe(join(fakeRoot, ".olt", "capsules"));
    });

    it("should resolve scratch dir", () => {
      expect(resolveScratchDir()).toBe(join(tmpdir(), "olt-scratch"));
    });

    it("should resolve evidence dir without runRoot", () => {
      expect(resolveEvidenceDir(fakeRoot)).toBe(join(tmpdir(), "olt-scratch", "evidence"));
    });

    it("should resolve evidence dir with runRoot", () => {
      const runRoot = join(fakeRoot, ".olt", "capsules", "run-123");
      mockExistsSync.mockImplementation((path: fs.PathLike) => String(path) === runRoot);
      expect(resolveEvidenceDir(fakeRoot, runRoot)).toBe(join(runRoot, "evidence"));
    });

    const fileTestCases = [
      { name: "policy", fn: resolvePolicyPath, file: OLT_FILES.POLICY },
      { name: "backlog", fn: resolveBacklogPath, file: OLT_FILES.BACKLOG },
      { name: "completed tasks", fn: resolveCompletedTasksPath, file: OLT_FILES.COMPLETED_TASKS },
      { name: "defects", fn: resolveDefectsPath, file: OLT_FILES.DEFECTS },
      {
        name: "completed defects",
        fn: resolveCompletedDefectsPath,
        file: OLT_FILES.COMPLETED_DEFECTS,
      },
      { name: "telemetry", fn: resolveTelemetryPath, file: OLT_FILES.TELEMETRY },
      { name: "memory", fn: resolveMemoryPath, file: OLT_FILES.MEMORY },
      { name: "watchdogs", fn: resolveWatchdogsPath, file: OLT_FILES.WATCHDOGS },
    ];

    fileTestCases.forEach(({ name, fn, file }) => {
      it(`should resolve ${name} path`, () => {
        expect(fn(fakeRoot)).toBe(join(fakeRoot, ".olt", file));
      });

      it(`should respect custom path for ${name}`, () => {
        const customPath = resolve("/custom/path.json");
        expect(fn(fakeRoot, customPath)).toBe(customPath);
      });
    });
  });
});
