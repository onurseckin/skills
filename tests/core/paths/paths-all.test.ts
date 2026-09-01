import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
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

describe("core/shared/paths.ts comprehensive", () => {
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockDirs.clear();
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return mockDirs.has(s);
      }),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

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
    const vRoot = "/virtual-paths-olt-test";
    mockDirs.add(vRoot);
    mockDirs.add(join(vRoot, ".olt"));

    const oltDir = resolveOltDir(vRoot);
    expect(oltDir).toBe(join(vRoot, ".olt"));

    expect(resolveOltDir(join(vRoot, ".olt"))).toBe(join(vRoot, ".olt"));

    const capDir = resolveCapsulesDir(vRoot);
    expect(capDir).toBe(join(vRoot, ".olt", "capsules"));

    expect(resolveCapsulesDir(join(vRoot, ".olt", "capsules"))).toBe(
      join(vRoot, ".olt", "capsules"),
    );
    expect(resolveCapsulesDir(join(vRoot, ".olt"))).toBe(join(vRoot, ".olt", "capsules"));
  });

  it("resolves all standard OLT file paths with default and custom paths", () => {
    const vRoot = "/virtual-paths-files-test";
    mockDirs.add(vRoot);
    mockDirs.add(join(vRoot, ".olt"));

    const custom = join(vRoot, "custom-policy.json");
    expect(resolvePolicyPath(vRoot, custom)).toBe(custom);
    expect(resolvePolicyPath(vRoot)).toBe(join(vRoot, ".olt", OLT_FILES.POLICY));

    expect(resolveBacklogPath(vRoot, custom)).toBe(custom);
    expect(resolveBacklogPath(vRoot)).toContain(OLT_FILES.BACKLOG);

    expect(resolveCompletedTasksPath(vRoot, custom)).toBe(custom);
    expect(resolveCompletedTasksPath(vRoot)).toContain(OLT_FILES.COMPLETED_TASKS);

    expect(resolveDefectsPath(vRoot, custom)).toBe(custom);
    expect(resolveDefectsPath(vRoot)).toContain(OLT_FILES.DEFECTS);

    expect(resolveCompletedDefectsPath(vRoot, custom)).toBe(custom);
    expect(resolveCompletedDefectsPath(vRoot)).toContain(OLT_FILES.COMPLETED_DEFECTS);

    expect(resolveTelemetryPath(vRoot, custom)).toBe(custom);
    expect(resolveTelemetryPath(vRoot)).toContain(OLT_FILES.TELEMETRY);

    expect(resolveMemoryPath(vRoot, custom)).toBe(custom);
    expect(resolveMemoryPath(vRoot)).toContain(OLT_FILES.MEMORY);

    expect(resolveWatchdogsPath(vRoot, custom)).toBe(custom);
    expect(resolveWatchdogsPath(vRoot)).toContain(OLT_FILES.WATCHDOGS);

    expect(resolveQuotaDagSnapshotPath(vRoot, custom)).toBe(custom);
    expect(resolveQuotaDagSnapshotPath(vRoot)).toContain(OLT_FILES.QUOTA_DAG_SNAPSHOT);
  });

  it("resolveEvidenceDir resolves run evidence or scratch evidence", () => {
    const vRoot = "/virtual-paths-evidence-test";
    mockDirs.add(vRoot);

    const runEvidence = resolveEvidenceDir(undefined, vRoot);
    expect(runEvidence).toBe(join(vRoot, "evidence"));

    const scratchEvidence = resolveEvidenceDir(undefined, "/nonexistent/path");
    expect(scratchEvidence).toContain("evidence");
  });

  it("loadSkillGlobalConfig and resolveSkillHomeRepo resolve global configuration", () => {
    mockDirs.add(process.cwd());
    mockDirs.add(join(process.cwd(), ".git"));
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
