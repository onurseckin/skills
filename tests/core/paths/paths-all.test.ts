import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import {
  isInsideCapsule,
  stripCapsulePath,
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
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("core/shared/paths.ts comprehensive", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
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
    vfs.mkdirSync(vRoot, { recursive: true });
    vfs.mkdirSync(join(vRoot, ".olt"), { recursive: true });

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
    vfs.mkdirSync(vRoot, { recursive: true });
    vfs.mkdirSync(join(vRoot, ".olt"), { recursive: true });

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
    vfs.mkdirSync(vRoot, { recursive: true });

    const runEvidence = resolveEvidenceDir(undefined, vRoot);
    expect(runEvidence).toBe(join(vRoot, "evidence"));

    const scratchEvidence = resolveEvidenceDir(undefined, "/virtual-nonexistent/path");
    expect(scratchEvidence).toContain("evidence");
  });

  it("loadSkillGlobalConfig and resolveSkillHomeRepo resolve global configuration", () => {
    const homeRepo = "/virtual/home-repo";
    vfs.mkdirSync(homeRepo, { recursive: true });

    const configPath = resolveSkillGlobalConfigPath();
    vfs.mkdirSync(dirname(configPath), { recursive: true });
    vfs.writeFileSync(
      configPath,
      JSON.stringify({
        home_repo_root: homeRepo,
        synced_at: "2026-01-01T00:00:00.000Z",
        version: "1.0.0",
      }),
    );

    expect(typeof configPath).toBe("string");

    const globalConfig = loadSkillGlobalConfig();
    expect(globalConfig).toBeDefined();
    if (globalConfig) {
      expect(typeof globalConfig.home_repo_root).toBe("string");
      expect(globalConfig.home_repo_root).toBe(homeRepo);
    }

    const previousEnv = process.env["OLT_SKILL_HOME_REPO"];
    process.env["OLT_SKILL_HOME_REPO"] = homeRepo;
    try {
      const resolvedHome = resolveSkillHomeRepo();
      expect(typeof resolvedHome).toBe("string");
      expect(resolvedHome).toBe(homeRepo);
    } finally {
      if (previousEnv === undefined) {
        delete process.env["OLT_SKILL_HOME_REPO"];
      } else {
        process.env["OLT_SKILL_HOME_REPO"] = previousEnv;
      }
    }
  });
});
