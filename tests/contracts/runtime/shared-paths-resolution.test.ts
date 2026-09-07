import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as os from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  findRepoRoot,
  loadSkillGlobalConfig,
  OLT_DIR_NAME,
  OLT_FILES,
  resolveBacklogPath,
  resolveCapsulesDir,
  resolveCompletedDefectsPath,
  resolveCompletedTasksPath,
  resolveDefectsPath,
  resolveEvidenceDir,
  resolveMemoryPath,
  resolveOltDir,
  resolvePolicyPath,
  resolveScratchDir,
  resolveSkillGlobalConfigPath,
  resolveSkillHomeRepo,
  resolveTelemetryPath,
  resolveWatchdogsPath,
} from "../../../olt/scripts/src/core/shared/paths.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const sharedPathsResolutionSuiteName =
  "core shared/paths: canonical directory resolution, file paths, global config";

describe(sharedPathsResolutionSuiteName, () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let homeSpy: { mockRestore: () => void };
  let dirCounter = 0;

  function makeVirtualDir(prefix: string): string {
    const dir = `/tmp/virtual/shared-paths-res-${prefix}-${++dirCounter}`;
    vfs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    homeSpy = spyOn(os, "homedir").mockReturnValue("/virtual/mock-home");
    const repo = "/sandbox/default-repo";
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    vfs.chdir(repo);
  });

  afterEach(() => {
    homeSpy.mockRestore();
    session.cleanup();
  });

  test("resolveCapsulesDir and resolveOltDir are idempotent and never double-nest (Matrix rows 9-10)", () => {
    const base = makeVirtualDir("idempotent-repo");
    vfs.mkdirSync(join(base, ".olt", "capsules"), { recursive: true });
    vfs.writeFileSync(join(base, "package.json"), "{}", "utf-8");

    expect(resolveCapsulesDir(base)).toBe(join(base, ".olt", "capsules"));
    expect(resolveCapsulesDir(join(base, ".olt"))).toBe(join(base, ".olt", "capsules"));
    expect(resolveCapsulesDir(join(base, ".olt", "capsules"))).toBe(join(base, ".olt", "capsules"));

    expect(resolveOltDir(base)).toBe(join(base, ".olt"));
    expect(resolveOltDir(join(base, ".olt"))).toBe(join(base, ".olt"));
  });

  test("resolveScratchDir creates predictable process-isolated scratch paths", () => {
    const scratch = resolveScratchDir();
    expect(scratch).toContain("olt-scratch");
    expect(scratch).toContain(String(process.pid));
  });

  test("resolves all canonical OLT file and directory paths with and without custom overrides", () => {
    const customRepo = makeVirtualDir("custom-repo");

    expect(resolveOltDir(customRepo)).toBe(join(customRepo, OLT_DIR_NAME));
    expect(resolveOltDir()).toBe(join(findRepoRoot(), OLT_DIR_NAME));

    expect(resolveCapsulesDir(customRepo)).toBe(join(customRepo, OLT_DIR_NAME, "capsules"));
    expect(resolveCapsulesDir()).toBe(resolveCapsulesDir(findRepoRoot()));

    expect(resolvePolicyPath(customRepo)).toBe(join(customRepo, OLT_DIR_NAME, OLT_FILES.POLICY));
    expect(resolvePolicyPath(customRepo, "/custom/path/policy.json")).toBe(
      resolve("/custom/path/policy.json"),
    );

    expect(resolveBacklogPath(customRepo, "/custom/backlog.jsonl")).toBe(
      resolve("/custom/backlog.jsonl"),
    );
    expect(resolveBacklogPath(customRepo)).toContain(OLT_FILES.BACKLOG);
    expect(resolveBacklogPath()).toContain(OLT_FILES.BACKLOG);

    expect(resolveCompletedTasksPath(customRepo, "/custom/tasks.jsonl")).toBe(
      resolve("/custom/tasks.jsonl"),
    );
    expect(resolveCompletedTasksPath(customRepo)).toContain(OLT_FILES.COMPLETED_TASKS);
    expect(resolveCompletedTasksPath()).toContain(OLT_FILES.COMPLETED_TASKS);

    expect(resolveDefectsPath(customRepo, "/custom/defects.jsonl")).toBe(
      resolve("/custom/defects.jsonl"),
    );
    expect(resolveDefectsPath(customRepo)).toContain(OLT_FILES.DEFECTS);
    expect(resolveDefectsPath()).toContain(OLT_FILES.DEFECTS);

    expect(resolveCompletedDefectsPath(customRepo, "/custom/completed-defects.jsonl")).toBe(
      resolve("/custom/completed-defects.jsonl"),
    );
    expect(resolveCompletedDefectsPath(customRepo)).toContain(OLT_FILES.COMPLETED_DEFECTS);
    expect(resolveCompletedDefectsPath()).toContain(OLT_FILES.COMPLETED_DEFECTS);

    expect(resolveTelemetryPath(customRepo, "/custom/telemetry.jsonl")).toBe(
      resolve("/custom/telemetry.jsonl"),
    );
    expect(resolveTelemetryPath(customRepo)).toContain(OLT_FILES.TELEMETRY);
    expect(resolveTelemetryPath()).toContain(OLT_FILES.TELEMETRY);

    expect(resolveMemoryPath(customRepo, "/custom/memory.json")).toBe(
      resolve("/custom/memory.json"),
    );
    expect(resolveMemoryPath(customRepo)).toContain(OLT_FILES.MEMORY);
    expect(resolveMemoryPath()).toContain(OLT_FILES.MEMORY);

    expect(resolveWatchdogsPath(customRepo, "/custom/watchdogs.json")).toBe(
      resolve("/custom/watchdogs.json"),
    );
    expect(resolveWatchdogsPath(customRepo)).toContain(OLT_FILES.WATCHDOGS);
    expect(resolveWatchdogsPath()).toContain(OLT_FILES.WATCHDOGS);

    const runRoot = makeVirtualDir("active-run");
    expect(resolveEvidenceDir(customRepo, runRoot)).toBe(join(runRoot, "evidence"));
    expect(resolveEvidenceDir(customRepo, "/tmp/virtual/nonexistent-run")).toContain("evidence");
    expect(resolveEvidenceDir()).toContain("evidence");
  });

  test("resolveSkillGlobalConfigPath returns canonical skill-config.json path under ~/.agents/skills/olt", () => {
    expect(OLT_FILES.SKILL_CONFIG).toBe("skill-config.json");
    const expected = join(os.homedir(), ".agents", "skills", "olt", "skill-config.json");
    expect(resolveSkillGlobalConfigPath()).toBe(expected);
  });

  test("loadSkillGlobalConfig correctly reads valid config, or returns null for corrupted / missing file", () => {
    const configPath = resolveSkillGlobalConfigPath();
    const configDir = dirname(configPath);
    vfs.mkdirSync(configDir, { recursive: true });

    const validConfig = {
      home_repo_root: "/path/to/home/repo",
      synced_at: "2026-08-24T12:00:00.000Z",
      version: "1.0.0",
    };
    vfs.writeFileSync(configPath, JSON.stringify(validConfig, null, 2), "utf-8");
    const loaded = loadSkillGlobalConfig();
    expect(loaded).not.toBeNull();
    expect(loaded?.home_repo_root).toBe("/path/to/home/repo");
    expect(loaded?.version).toBe("1.0.0");
    expect(loaded?.synced_at).toBe("2026-08-24T12:00:00.000Z");

    vfs.writeFileSync(configPath, "{ malformed json: true", "utf-8");
    expect(loadSkillGlobalConfig()).toBeNull();

    vfs.writeFileSync(configPath, JSON.stringify({ version: "1.0.0" }), "utf-8");
    expect(loadSkillGlobalConfig()).toBeNull();

    vfs.writeFileSync(configPath, JSON.stringify({ home_repo_root: 123 }), "utf-8");
    expect(loadSkillGlobalConfig()).toBeNull();

    vfs.rmSync(configPath, { force: true });
    expect(loadSkillGlobalConfig()).toBeNull();
  });

  test("resolveSkillHomeRepo resolves skill home with precedence: env > policy > global config > default repo", () => {
    const testDir = makeVirtualDir("skill-home-test");
    const customHome = makeVirtualDir("custom-home-repo");
    const globalHome = makeVirtualDir("global-home-repo");

    const configPath = resolveSkillGlobalConfigPath();
    const configDir = dirname(configPath);
    const oldEnv = process.env["OLT_SKILL_HOME_REPO"];

    try {
      vfs.mkdirSync(configDir, { recursive: true });
      vfs.writeFileSync(
        configPath,
        JSON.stringify({
          home_repo_root: globalHome,
          synced_at: new Date().toISOString(),
          version: "1.0.0",
        }),
        "utf-8",
      );

      process.env["OLT_SKILL_HOME_REPO"] = customHome;
      expect(resolveSkillHomeRepo(testDir)).toBe(resolve(customHome));
      expect(resolveSkillHomeRepo()).toBe(resolve(customHome));

      process.env["OLT_SKILL_HOME_REPO"] = "/virtual/scratch/nonexistent-dir";
      expect(resolveSkillHomeRepo()).toBe(resolve(globalHome));

      vfs.writeFileSync(
        configPath,
        JSON.stringify({
          home_repo_root: "/virtual/scratch/nonexistent-global-root",
          synced_at: new Date().toISOString(),
          version: "1.0.0",
        }),
        "utf-8",
      );
      delete process.env["OLT_SKILL_HOME_REPO"];
      const defaultRepo = session.existsSync("/Users/onurseckinsenoglu/repos/skills")
        ? resolve("/Users/onurseckinsenoglu/repos/skills")
        : findRepoRoot();
      expect(resolveSkillHomeRepo()).toBe(defaultRepo);

      vfs.rmSync(configPath, { force: true });
      expect(resolveSkillHomeRepo()).toBe(defaultRepo);
    } finally {
      if (oldEnv !== undefined) {
        process.env["OLT_SKILL_HOME_REPO"] = oldEnv;
      } else {
        delete process.env["OLT_SKILL_HOME_REPO"];
      }
    }
  });
});
