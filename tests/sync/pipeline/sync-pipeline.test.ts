import { describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  FALLBACK_MARKER,
  GLOBAL_SYNC_GEN5,
  buildOltBinaryContent,
  computeIsMain,
  decideSyncSource,
  deployCanonicalSkill,
  detectShellRcPath,
  ensureGlobalOltBinary,
  ensurePathInShellRc,
  firstNonEmpty,
  generateExportLine,
  getAssistantSkillDirs,
  getDirtyOltPaths,
  guardedRemoveSync,
  isManagedFallbackCopy,
  isPathDeclaredInContent,
  logDestructiveOp,
  main,
  materializeOltFromHead,
  migrateOwnedLegacyDeployment,
  orDefault,
  parsePorcelainStatus,
  readJsonStringField,
  refuseSyncSourceMessage,
  resolveOltSyncSource,
  rollbackAssistantLinks,
  runSync,
  smartEnsureSymlink,
} from "../../../scripts/sync/index.ts";
import { scratchRoot } from "../sync-fixture.ts";

function git(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
}

function initFakeSkillsRepo(repoRoot: string): void {
  mkdirSync(join(repoRoot, "olt", "scripts", "src"), { recursive: true });
  writeFileSync(
    join(repoRoot, "olt", "SKILL.md"),
    "---\nname: olt\ndescription: test\n---\n",
    "utf-8",
  );
  writeFileSync(
    join(repoRoot, "olt", "scripts", "package.json"),
    JSON.stringify({ name: "@local/olt-runtime", version: "1.0.0" }, null, 2),
    "utf-8",
  );
  writeFileSync(
    join(repoRoot, "olt", "scripts", "src", "constants.ts"),
    'export const RUNTIME_VERSION = "1.0.0";\n',
    "utf-8",
  );
  writeFileSync(
    join(repoRoot, "olt", "scripts", "harness.ts"),
    "console.log('harness');\n",
    "utf-8",
  );

  git(["init", "--quiet", "--initial-branch", "main"], repoRoot);
  git(["config", "user.email", "test@example.com"], repoRoot);
  git(["config", "user.name", "Test"], repoRoot);
  git(["add", "-A"], repoRoot);
  git(["commit", "--quiet", "-m", "init"], repoRoot);
}

describe("scripts/sync/index.ts", () => {
  test("exports all canonical facade functions, constants, and types", () => {
    expect(GLOBAL_SYNC_GEN5).toBe(true);
    expect(typeof deployCanonicalSkill).toBe("function");
    expect(typeof getAssistantSkillDirs).toBe("function");
    expect(typeof migrateOwnedLegacyDeployment).toBe("function");
    expect(typeof readJsonStringField).toBe("function");
    expect(typeof rollbackAssistantLinks).toBe("function");
    expect(typeof buildOltBinaryContent).toBe("function");
    expect(typeof ensureGlobalOltBinary).toBe("function");
    expect(typeof detectShellRcPath).toBe("function");
    expect(typeof ensurePathInShellRc).toBe("function");
    expect(typeof generateExportLine).toBe("function");
    expect(typeof isPathDeclaredInContent).toBe("function");
    expect(typeof decideSyncSource).toBe("function");
    expect(typeof firstNonEmpty).toBe("function");
    expect(typeof getDirtyOltPaths).toBe("function");
    expect(typeof materializeOltFromHead).toBe("function");
    expect(typeof parsePorcelainStatus).toBe("function");
    expect(typeof refuseSyncSourceMessage).toBe("function");
    expect(typeof resolveOltSyncSource).toBe("function");
    expect(typeof guardedRemoveSync).toBe("function");
    expect(typeof isManagedFallbackCopy).toBe("function");
    expect(typeof logDestructiveOp).toBe("function");
    expect(typeof smartEnsureSymlink).toBe("function");
    expect(FALLBACK_MARKER).toBe(".olt-sync-managed.json");
  });

  test("orDefault returns value when defined and fallback when undefined", () => {
    expect(orDefault("val", "fallback")).toBe("val");
    expect(orDefault(undefined, "fallback")).toBe("fallback");
  });

  test("computeIsMain evaluates main flags and argv path patterns", () => {
    expect(computeIsMain(true)).toBe(true);
    expect(computeIsMain(false, undefined)).toBe(false);
    expect(computeIsMain(false, "/repo/scripts/sync/index.ts")).toBe(true);
    expect(computeIsMain(false, "/repo/scripts/sync")).toBe(true);
    expect(computeIsMain(false, "/repo/scripts/testing/test-runner.ts")).toBe(false);
  });

  test("runSync executes full end-to-end sync in silent mode", async () => {
    const root = scratchRoot(import.meta.path, "sync-index-silent");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    const fakeHome = join(root, "home");
    const targetOlt = join(fakeHome, ".agents", "skills", "olt");

    const summary = await runSync({
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetOltDir: targetOlt,
      allowDirty: true,
      silent: true,
    });

    expect(summary.skill).toBeDefined();
    expect(summary.binary).toBeDefined();
    expect(summary.shell).toBeDefined();
    expect(summary.skill.targetDir).toBe(targetOlt);
    expect(summary.binary.status).toBe("created");
    expect(summary.shell.modified).toBe(true);
  });

  test("runSync executes with console logging when silent is false", async () => {
    const root = scratchRoot(import.meta.path, "sync-index-logging");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    const fakeHome = join(root, "home");
    const targetOlt = join(fakeHome, ".agents", "skills", "olt");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      // First run: shell modified is true
      const summary1 = await runSync({
        sourceRepoRoot: sourceRepo,
        homeDir: fakeHome,
        targetOltDir: targetOlt,
        allowDirty: true,
        silent: false,
      });

      expect(summary1.shell.modified).toBe(true);
      expect(logs.some((l) => l.includes("Global skill sync complete"))).toBe(true);
      expect(logs.some((l) => l.includes("Shell PATH: Configured in"))).toBe(true);

      logs.length = 0;

      // Second run: shell modified is false (already configured)
      const summary2 = await runSync({
        sourceRepoRoot: sourceRepo,
        homeDir: fakeHome,
        targetOltDir: targetOlt,
        allowDirty: true,
        silent: false,
      });

      expect(summary2.shell.modified).toBe(false);
      expect(logs.some((l) => l.includes("Shell PATH: already_configured"))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  test("main() executes end-to-end sync with argv options", async () => {
    const root = scratchRoot(import.meta.path, "sync-main-fn");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    const origCwd = process.cwd();
    const origHome = process.env.HOME;
    try {
      process.env.HOME = join(root, "home");
      process.chdir(sourceRepo);
      await main(["--allow-dirty"]);
    } finally {
      process.chdir(origCwd);
      if (origHome !== undefined) {
        process.env.HOME = origHome;
      }
    }
  });

  test("runs as CLI entrypoint with main", async () => {
    const root = scratchRoot(import.meta.path, "sync-cli-exec");
    const repo = join(root, "repo");
    initFakeSkillsRepo(repo);

    const origCwd = process.cwd();
    const origHome = process.env.HOME;
    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    try {
      process.env.HOME = join(root, "home");
      process.chdir(repo);
      await main(["--allow-dirty"]);
      expect(logs.some((l) => l.includes("Global skill sync complete"))).toBeTrue();
    } finally {
      logSpy.mockRestore();
      process.chdir(origCwd);
      if (origHome !== undefined) {
        process.env.HOME = origHome;
      }
    }
  });
});
