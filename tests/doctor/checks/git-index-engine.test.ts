import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import * as childProcess from "node:child_process";
import { setupVirtualDoctorFS, scratchRoot } from "../fixture.ts";
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
    setupVirtualDoctorFS();
    const root = scratchRoot("git-index-engine", "no-git");

    const report = checkGitIndexIntegrity({ repoRoot: root });
    expect(report.healthy).toBe(true);
    expect(report.staleIndexLockPresent).toBe(false);
    expect(report.uncommittedArtifacts).toEqual([]);
    expect(report.stashCorrupted).toBe(false);
    expect(report.findings).toEqual([]);
  });

  test("detects and heals dead .git/index.lock with dead process PID", () => {
    const vfs = setupVirtualDoctorFS();
    const root = scratchRoot("git-index-engine", "dead-lock");
    const gitDir = join(root, ".git");
    const lockFile = join(gitDir, "index.lock");
    vfs.mkdirSync(gitDir, { recursive: true });
    vfs.writeFileSync(lockFile, "9999999\n");

    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      () =>
        ({
          status: 0,
          stdout: "",
          stderr: "",
        }) as unknown as childProcess.SpawnSyncReturns<string>,
    );
    spies.push(spawnSpy);

    const report = checkGitIndexIntegrity({ repoRoot: root });
    expect(report.healthy).toBe(false);
    expect(report.staleIndexLockPresent).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings[0]?.code).toBe("GIT_STALE_INDEX_LOCK_DETECTED");

    // Auto heal
    const healResult = autoHealGitState({
      repoRoot: root,
      cleanIndexLock: true,
      stageModified: false,
    });
    expect(healResult.indexLockCleaned).toBe(true);
    expect(vfs.existsSync(lockFile)).toBe(false);

    const reportAfter = checkGitIndexIntegrity({ repoRoot: root });
    expect(reportAfter.healthy).toBe(true);
  });

  test("detects stale index.lock by timestamp age when no valid PID is written", () => {
    const vfs = setupVirtualDoctorFS();
    const root = scratchRoot("git-index-engine", "stale-age");
    const gitDir = join(root, ".git");
    const lockFile = join(gitDir, "index.lock");
    vfs.mkdirSync(gitDir, { recursive: true });
    vfs.writeFileSync(lockFile, "invalid-pid");

    const now = Date.now();
    const nowSpy = spyOn(Date, "now").mockReturnValue(now + 200_000);
    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
      () =>
        ({
          status: 0,
          stdout: "",
          stderr: "",
        }) as unknown as childProcess.SpawnSyncReturns<string>,
    );
    spies.push(nowSpy, spawnSpy);

    const report = checkGitIndexIntegrity({ repoRoot: root });
    expect(report.healthy).toBe(false);
    expect(report.staleIndexLockPresent).toBe(true);
    expect(report.findings[0]?.code).toBe("GIT_STALE_INDEX_LOCK_DETECTED");
  });

  test("detects uncommitted artifacts and corrupted git stash", () => {
    const vfs = setupVirtualDoctorFS();
    const root = scratchRoot("git-index-engine", "uncommitted-stash");
    const gitDir = join(root, ".git");
    vfs.mkdirSync(gitDir, { recursive: true });

    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((_cmd, args) => {
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
    spies.push(spawnSpy);

    const report = checkGitIndexIntegrity({ repoRoot: root });
    expect(report.healthy).toBe(false);
    expect(report.uncommittedArtifacts).toEqual(["src/index.ts", "uncommitted.txt"]);
    expect(report.stashCorrupted).toBe(true);
    expect(report.findings.some((f) => f.code === "GIT_STASH_CORRUPTION_DETECTED")).toBe(true);
  });

  test("autoHealGitState stages modified files when stageModified is true", () => {
    const vfs = setupVirtualDoctorFS();
    const root = scratchRoot("git-index-engine", "stage-modified");
    const gitDir = join(root, ".git");
    vfs.mkdirSync(gitDir, { recursive: true });

    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((_cmd, args) => {
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
    spies.push(spawnSpy);

    const healResult = autoHealGitState({
      repoRoot: root,
      cleanIndexLock: false,
      stageModified: true,
    });
    expect(healResult.stagedFiles).toEqual(["src/file1.ts", "src/file2.ts"]);
  });

  test("autoHealGitState returns empty when .git does not exist", () => {
    setupVirtualDoctorFS();
    const root = scratchRoot("git-index-engine", "auto-heal-no-git");

    const healResult = autoHealGitState({ repoRoot: root });
    expect(healResult.indexLockCleaned).toBe(false);
    expect(healResult.stagedFiles).toEqual([]);
  });
});
