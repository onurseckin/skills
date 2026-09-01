import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
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
  cleanupVirtualBrowserFS,
  setupVirtualBrowserFS,
  tempDir,
} from "../../reporting/browser/browser-virtual-fs.ts";

export const sharedPathsResolutionSuiteName =
  "core shared/paths: canonical directory resolution, file paths, global config";

describe(sharedPathsResolutionSuiteName, () => {
  beforeEach(() => {
    setupVirtualBrowserFS();
  });

  afterEach(() => {
    cleanupVirtualBrowserFS();
  });

  test("resolveCapsulesDir and resolveOltDir are idempotent and never double-nest (Matrix rows 9-10)", () => {
    const base = tempDir("idempotent-repo");
    fs.mkdirSync(join(base, ".olt", "capsules"), { recursive: true });
    fs.writeFileSync(join(base, "package.json"), "{}", "utf-8");

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
    const customRepo = tempDir("custom-repo");

    expect(resolveOltDir(customRepo)).toBe(join(customRepo, OLT_DIR_NAME));
    expect(resolveOltDir()).toBe(join(findRepoRoot(), OLT_DIR_NAME));

    expect(resolveCapsulesDir(customRepo)).toBe(join(customRepo, OLT_DIR_NAME, "capsules"));
    expect(resolveCapsulesDir()).toBe(join(findRepoRoot(), OLT_DIR_NAME, "capsules"));

    // Policy path
    expect(resolvePolicyPath(customRepo)).toBe(join(customRepo, OLT_DIR_NAME, OLT_FILES.POLICY));
    expect(resolvePolicyPath(customRepo, "/custom/path/policy.json")).toBe(
      resolve("/custom/path/policy.json"),
    );

    // Backlog path
    expect(resolveBacklogPath(customRepo, "/custom/backlog.jsonl")).toBe(
      resolve("/custom/backlog.jsonl"),
    );
    expect(resolveBacklogPath(customRepo)).toContain(OLT_FILES.BACKLOG);
    expect(resolveBacklogPath()).toContain(OLT_FILES.BACKLOG);

    // Completed tasks path
    expect(resolveCompletedTasksPath(customRepo, "/custom/tasks.jsonl")).toBe(
      resolve("/custom/tasks.jsonl"),
    );
    expect(resolveCompletedTasksPath(customRepo)).toContain(OLT_FILES.COMPLETED_TASKS);
    expect(resolveCompletedTasksPath()).toContain(OLT_FILES.COMPLETED_TASKS);

    // Defects path
    expect(resolveDefectsPath(customRepo, "/custom/defects.jsonl")).toBe(
      resolve("/custom/defects.jsonl"),
    );
    expect(resolveDefectsPath(customRepo)).toContain(OLT_FILES.DEFECTS);
    expect(resolveDefectsPath()).toContain(OLT_FILES.DEFECTS);

    // Completed defects path
    expect(resolveCompletedDefectsPath(customRepo, "/custom/completed-defects.jsonl")).toBe(
      resolve("/custom/completed-defects.jsonl"),
    );
    expect(resolveCompletedDefectsPath(customRepo)).toContain(OLT_FILES.COMPLETED_DEFECTS);
    expect(resolveCompletedDefectsPath()).toContain(OLT_FILES.COMPLETED_DEFECTS);

    // Telemetry path
    expect(resolveTelemetryPath(customRepo, "/custom/telemetry.jsonl")).toBe(
      resolve("/custom/telemetry.jsonl"),
    );
    expect(resolveTelemetryPath(customRepo)).toContain(OLT_FILES.TELEMETRY);
    expect(resolveTelemetryPath()).toContain(OLT_FILES.TELEMETRY);

    // Memory path
    expect(resolveMemoryPath(customRepo, "/custom/memory.json")).toBe(
      resolve("/custom/memory.json"),
    );
    expect(resolveMemoryPath(customRepo)).toContain(OLT_FILES.MEMORY);
    expect(resolveMemoryPath()).toContain(OLT_FILES.MEMORY);

    // Watchdogs path
    expect(resolveWatchdogsPath(customRepo, "/custom/watchdogs.json")).toBe(
      resolve("/custom/watchdogs.json"),
    );
    expect(resolveWatchdogsPath(customRepo)).toContain(OLT_FILES.WATCHDOGS);
    expect(resolveWatchdogsPath()).toContain(OLT_FILES.WATCHDOGS);

    // Evidence directory resolution
    const runRoot = tempDir("active-run");
    expect(resolveEvidenceDir(customRepo, runRoot)).toBe(join(runRoot, "evidence"));
    expect(resolveEvidenceDir(customRepo, tempDir("nonexistent-run"))).toContain("evidence");
    expect(resolveEvidenceDir()).toContain("evidence");
  });

  test("resolveSkillGlobalConfigPath returns canonical skill-config.json path under ~/.agents/skills/olt", () => {
    expect(OLT_FILES.SKILL_CONFIG).toBe("skill-config.json");
    const expected = join(homedir(), ".agents", "skills", "olt", "skill-config.json");
    expect(resolveSkillGlobalConfigPath()).toBe(expected);
  });

  test("loadSkillGlobalConfig correctly reads valid config, or returns null for corrupted / missing file", () => {
    const configPath = resolveSkillGlobalConfigPath();
    const configDir = dirname(configPath);
    fs.mkdirSync(configDir, { recursive: true });

    // 1. Valid config
    const validConfig = {
      home_repo_root: "/path/to/home/repo",
      synced_at: "2026-08-24T12:00:00.000Z",
      version: "1.0.0",
    };
    fs.writeFileSync(configPath, JSON.stringify(validConfig, null, 2), "utf-8");
    const loaded = loadSkillGlobalConfig();
    expect(loaded).not.toBeNull();
    expect(loaded?.home_repo_root).toBe("/path/to/home/repo");
    expect(loaded?.version).toBe("1.0.0");
    expect(loaded?.synced_at).toBe("2026-08-24T12:00:00.000Z");

    // 2. Corrupted JSON
    fs.writeFileSync(configPath, "{ malformed json: true", "utf-8");
    expect(loadSkillGlobalConfig()).toBeNull();

    // 3. Object without home_repo_root or non-string home_repo_root
    fs.writeFileSync(configPath, JSON.stringify({ version: "1.0.0" }), "utf-8");
    expect(loadSkillGlobalConfig()).toBeNull();

    fs.writeFileSync(configPath, JSON.stringify({ home_repo_root: 123 }), "utf-8");
    expect(loadSkillGlobalConfig()).toBeNull();

    // 4. Non-existent file
    fs.rmSync(configPath, { force: true });
    expect(loadSkillGlobalConfig()).toBeNull();
  });

  test("resolveSkillHomeRepo: an explicit currentRepoRoot always wins; only an omitted argument falls through env, then global config, then findRepoRoot", () => {
    const testDir = tempDir("skill-home-test");
    const customHome = tempDir("custom-home-repo");
    const globalHome = tempDir("global-home-repo");

    const configPath = resolveSkillGlobalConfigPath();
    const configDir = dirname(configPath);
    const oldEnv = process.env["OLT_SKILL_HOME_REPO"];

    try {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          home_repo_root: globalHome,
          synced_at: new Date().toISOString(),
          version: "1.0.0",
        }),
        "utf-8",
      );

      process.env["OLT_SKILL_HOME_REPO"] = customHome;
      expect(resolveSkillHomeRepo(testDir)).toBe(resolve(testDir));

      expect(resolveSkillHomeRepo()).toBe(resolve(customHome));

      process.env["OLT_SKILL_HOME_REPO"] = "/virtual/scratch/nonexistent-dir";
      expect(resolveSkillHomeRepo()).toBe(resolve(globalHome));

      fs.writeFileSync(
        configPath,
        JSON.stringify({
          home_repo_root: "/virtual/scratch/nonexistent-global-root",
          synced_at: new Date().toISOString(),
          version: "1.0.0",
        }),
        "utf-8",
      );
      delete process.env["OLT_SKILL_HOME_REPO"];
      expect(resolveSkillHomeRepo()).toBe(findRepoRoot());

      fs.rmSync(configPath, { force: true });
      expect(resolveSkillHomeRepo()).toBe(findRepoRoot());
    } finally {
      if (oldEnv !== undefined) {
        process.env["OLT_SKILL_HOME_REPO"] = oldEnv;
      } else {
        delete process.env["OLT_SKILL_HOME_REPO"];
      }
    }
  });
});
