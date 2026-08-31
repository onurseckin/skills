import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isInsideCapsule,
  stripCapsulePath,
  findRepoRoot,
  isTestEnvironment,
  resolveScratchDir,
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
  resolveQuotaDagSnapshotPath,
  resolveEvidenceDir,
  resolveSkillGlobalConfigPath,
  loadSkillGlobalConfig,
  resolveSkillHomeRepo,
  OLT_FILES,
} from "../../../olt/scripts/src/core/shared/paths.ts";

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("core/shared/paths.ts comprehensive", () => {
  it("isInsideCapsule identifies capsule paths", () => {
    expect(isInsideCapsule("/repo/.olt/capsules/run-1")).toBe(true);
    expect(isInsideCapsule("/repo/.olt/capsules")).toBe(true);
    expect(isInsideCapsule("/repo/.capsules/run-1")).toBe(true);
    expect(isInsideCapsule("/repo/.capsules")).toBe(true);
    expect(isInsideCapsule("/repo/src/index.ts")).toBe(false);
  });

  it("stripCapsulePath strips capsule suffixes", () => {
    expect(stripCapsulePath("/repo/.olt/capsules/run-1/file.ts")).toBe("/repo");
    expect(stripCapsulePath("/repo/.capsules/run-1")).toBe("/repo");
    expect(stripCapsulePath("/repo/src/file.ts")).toBeUndefined();
  });

  it("isTestEnvironment returns boolean correctly", () => {
    expect(isTestEnvironment()).toBe(true);
  });

  it("resolveScratchDir returns scratch path containing process pid", () => {
    const scratch = resolveScratchDir();
    expect(scratch).toContain("olt-scratch");
    expect(scratch).toContain(String(process.pid));
  });

  it("resolveOltDir and resolveCapsulesDir handle various root configurations", () => {
    const tmp = makeTmpDir("paths-olt-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const oltDir = resolveOltDir(tmp);
      expect(oltDir).toBe(join(tmp, ".olt"));

      // If root already ends with .olt
      expect(resolveOltDir(join(tmp, ".olt"))).toBe(join(tmp, ".olt"));

      const capDir = resolveCapsulesDir(tmp);
      expect(capDir).toBe(join(tmp, ".olt", "capsules"));

      // If root already ends with .olt/capsules
      expect(resolveCapsulesDir(join(tmp, ".olt", "capsules"))).toBe(join(tmp, ".olt", "capsules"));

      // If root ends with .olt
      expect(resolveCapsulesDir(join(tmp, ".olt"))).toBe(join(tmp, ".olt", "capsules"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolves all standard OLT file paths with default and custom paths", () => {
    const tmp = makeTmpDir("paths-files-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const custom = join(tmp, "custom-policy.json");
      expect(resolvePolicyPath(tmp, custom)).toBe(custom);
      expect(resolvePolicyPath(tmp)).toBe(join(tmp, ".olt", OLT_FILES.POLICY));

      expect(resolveBacklogPath(tmp, custom)).toBe(custom);
      expect(resolveBacklogPath(tmp)).toContain(OLT_FILES.BACKLOG);

      expect(resolveCompletedTasksPath(tmp, custom)).toBe(custom);
      expect(resolveCompletedTasksPath(tmp)).toContain(OLT_FILES.COMPLETED_TASKS);

      expect(resolveDefectsPath(tmp, custom)).toBe(custom);
      expect(resolveDefectsPath(tmp)).toContain(OLT_FILES.DEFECTS);

      expect(resolveCompletedDefectsPath(tmp, custom)).toBe(custom);
      expect(resolveCompletedDefectsPath(tmp)).toContain(OLT_FILES.COMPLETED_DEFECTS);

      expect(resolveTelemetryPath(tmp, custom)).toBe(custom);
      expect(resolveTelemetryPath(tmp)).toContain(OLT_FILES.TELEMETRY);

      expect(resolveMemoryPath(tmp, custom)).toBe(custom);
      expect(resolveMemoryPath(tmp)).toContain(OLT_FILES.MEMORY);

      expect(resolveWatchdogsPath(tmp, custom)).toBe(custom);
      expect(resolveWatchdogsPath(tmp)).toContain(OLT_FILES.WATCHDOGS);

      expect(resolveQuotaDagSnapshotPath(tmp, custom)).toBe(custom);
      expect(resolveQuotaDagSnapshotPath(tmp)).toContain(OLT_FILES.QUOTA_DAG_SNAPSHOT);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolveEvidenceDir resolves run evidence or scratch evidence", () => {
    const tmp = makeTmpDir("paths-evidence-test-");
    try {
      const runEvidence = resolveEvidenceDir(undefined, tmp);
      expect(runEvidence).toBe(join(tmp, "evidence"));

      const scratchEvidence = resolveEvidenceDir(undefined, "/nonexistent/path");
      expect(scratchEvidence).toContain("evidence");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loadSkillGlobalConfig and resolveSkillHomeRepo resolve global configuration", () => {
    const configPath = resolveSkillGlobalConfigPath();
    expect(typeof configPath).toBe("string");

    const globalConfig = loadSkillGlobalConfig();
    if (globalConfig) {
      expect(typeof globalConfig.home_repo_root).toBe("string");
    }

    const resolvedHome = resolveSkillHomeRepo();
    expect(typeof resolvedHome).toBe("string");
  });
});
