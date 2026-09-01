import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as childProcess from "node:child_process";
import {
  checkGitIndexIntegrity,
  autoHealGitState,
} from "../../../olt/scripts/src/reporting/doctor/git-index-engine.ts";

export const gitIndexEngineSuiteName = "Wave 1 - Task 1.4: Git Index Integrity Engine";

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const s of spies.splice(0)) {
    s.mockRestore();
  }
});

describe(gitIndexEngineSuiteName, () => {
  test("returns healthy when .git directory does not exist", () => {
    const existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    spies.push(existsSpy);

    const report = checkGitIndexIntegrity({ repoRoot: "/virtual/repo" });
    expect(report.healthy).toBe(true);
    expect(report.staleIndexLockPresent).toBe(false);
    expect(report.uncommittedArtifacts).toEqual([]);
    expect(report.stashCorrupted).toBe(false);
    expect(report.findings).toEqual([]);
  });

  test("detects and heals dead .git/index.lock with dead process PID", () => {
    const unlinked: string[] = [];
    const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
      const pathStr = String(p);
      if (pathStr === "/virtual/repo/.git") return true;
      if (pathStr === "/virtual/repo/.git/index.lock") {
        return !unlinked.includes(pathStr);
      }
      return false;
    });
    const statSpy = spyOn(fs, "statSync").mockImplementation(
      () =>
        ({
          mtimeMs: Date.now() - 10000,
          isFile: () => true,
        }) as fs.Stats,
    );
    const readSpy = spyOn(fs, "readFileSync").mockImplementation(() => "9999999\n");
    const unlinkSpy = spyOn(fs, "unlinkSync").mockImplementation((p) => {
      unlinked.push(String(p));
    });
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      () =>
        ({
          status: 0,
          stdout: "",
          stderr: "",
        }) as unknown as childProcess.SpawnSyncReturns<string>,
    );
    spies.push(existsSpy, statSpy, readSpy, unlinkSpy, spawnSpy);

    const report = checkGitIndexIntegrity({ repoRoot: "/virtual/repo" });
    expect(report.healthy).toBe(false);
    expect(report.staleIndexLockPresent).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings[0]?.code).toBe("GIT_STALE_INDEX_LOCK_DETECTED");

    // Auto heal
    const healResult = autoHealGitState({
      repoRoot: "/virtual/repo",
      cleanIndexLock: true,
      stageModified: false,
    });
    expect(healResult.indexLockCleaned).toBe(true);
    expect(unlinked).toContain("/virtual/repo/.git/index.lock");

    const reportAfter = checkGitIndexIntegrity({ repoRoot: "/virtual/repo" });
    expect(reportAfter.healthy).toBe(true);
  });

  test("detects stale index.lock by timestamp age when no valid PID is written", () => {
    const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
      const pathStr = String(p);
      return pathStr === "/virtual/repo/.git" || pathStr === "/virtual/repo/.git/index.lock";
    });
    const statSpy = spyOn(fs, "statSync").mockImplementation(
      () =>
        ({
          mtimeMs: Date.now() - 200_000,
          isFile: () => true,
        }) as fs.Stats,
    );
    const readSpy = spyOn(fs, "readFileSync").mockImplementation(() => "invalid-pid");
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      () =>
        ({
          status: 0,
          stdout: "",
          stderr: "",
        }) as unknown as childProcess.SpawnSyncReturns<string>,
    );
    spies.push(existsSpy, statSpy, readSpy, spawnSpy);

    const report = checkGitIndexIntegrity({ repoRoot: "/virtual/repo" });
    expect(report.healthy).toBe(false);
    expect(report.staleIndexLockPresent).toBe(true);
    expect(report.findings[0]?.code).toBe("GIT_STALE_INDEX_LOCK_DETECTED");
  });

  test("detects uncommitted artifacts and corrupted git stash", () => {
    const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
      const pathStr = String(p);
      return pathStr === "/virtual/repo/.git";
    });
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((cmd, args) => {
      const argList = Array.isArray(args) ? args : [];
      if (argList.includes("status")) {
        return {
          status: 0,
          stdout: " M src/index.ts\n?? uncommitted.txt\n",
          stderr: "",
        } as unknown as childProcess.SpawnSyncReturns<string>;
      }
      if (argList.includes("stash")) {
        return {
          status: 1,
          stdout: "",
          stderr: "fatal: bad object refs/stash",
        } as unknown as childProcess.SpawnSyncReturns<string>;
      }
      return {
        status: 0,
        stdout: "",
        stderr: "",
      } as unknown as childProcess.SpawnSyncReturns<string>;
    });
    spies.push(existsSpy, spawnSpy);

    const report = checkGitIndexIntegrity({ repoRoot: "/virtual/repo" });
    expect(report.healthy).toBe(false);
    expect(report.uncommittedArtifacts).toEqual(["src/index.ts", "uncommitted.txt"]);
    expect(report.stashCorrupted).toBe(true);
    expect(report.findings.some((f) => f.code === "GIT_STASH_CORRUPTION_DETECTED")).toBe(true);
  });

  test("autoHealGitState stages modified files when stageModified is true", () => {
    const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
      return String(p) === "/virtual/repo/.git";
    });
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((cmd, args) => {
      const argList = Array.isArray(args) ? args : [];
      if (argList.includes("add")) {
        return {
          status: 0,
          stdout: "",
          stderr: "",
        } as unknown as childProcess.SpawnSyncReturns<string>;
      }
      if (argList.includes("diff")) {
        return {
          status: 0,
          stdout: "src/file1.ts\nsrc/file2.ts\n",
          stderr: "",
        } as unknown as childProcess.SpawnSyncReturns<string>;
      }
      return {
        status: 0,
        stdout: "",
        stderr: "",
      } as unknown as childProcess.SpawnSyncReturns<string>;
    });
    spies.push(existsSpy, spawnSpy);

    const healResult = autoHealGitState({
      repoRoot: "/virtual/repo",
      cleanIndexLock: false,
      stageModified: true,
    });
    expect(healResult.stagedFiles).toEqual(["src/file1.ts", "src/file2.ts"]);
  });

  test("autoHealGitState returns empty when .git does not exist", () => {
    const existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    spies.push(existsSpy);

    const healResult = autoHealGitState({ repoRoot: "/virtual/repo" });
    expect(healResult.indexLockCleaned).toBe(false);
    expect(healResult.stagedFiles).toEqual([]);
  });
});
