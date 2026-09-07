import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
import { cleanupVirtualSyncFS, scratchRoot, setupVirtualSyncFS } from "../sync-fixture.ts";

beforeAll(async () => {
  setupVirtualSyncFS();
  const root = scratchRoot("warmup", "warmup");
  const sourceRepo = join(root, "repo");
  mkdirSync(join(sourceRepo, "olt", "scripts", "src"), { recursive: true });
  writeFileSync(join(sourceRepo, "olt", "SKILL.md"), "---\nname: olt\n---\n", "utf-8");
  writeFileSync(
    join(sourceRepo, "olt", "scripts", "package.json"),
    JSON.stringify({ name: "@local/olt-runtime", version: "1.0.0" }),
    "utf-8",
  );
  writeFileSync(
    join(sourceRepo, "olt", "scripts", "src", "constants.ts"),
    'export const RUNTIME_VERSION = "1.0.0";\n',
    "utf-8",
  );
  mkdirSync(join(sourceRepo, ".git"), { recursive: true });
  await runSync({
    sourceRepoRoot: sourceRepo,
    homeDir: join(root, "home"),
    targetOltDir: join(root, "home", ".agents", "skills", "olt"),
    allowDirty: true,
    silent: true,
  });
  cleanupVirtualSyncFS();
});

beforeEach(() => {
  setupVirtualSyncFS();
});

afterEach(() => {
  cleanupVirtualSyncFS();
});

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

  mkdirSync(join(repoRoot, ".git"), { recursive: true });
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

  test("runSync logs when shell rc is modified on first run", async () => {
    const root = scratchRoot(import.meta.path, "sync-index-logging-1");
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
    } finally {
      console.log = origLog;
    }
  });

  test("runSync logs when shell rc is already configured on subsequent run", async () => {
    const root = scratchRoot(import.meta.path, "sync-index-logging-2");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    const fakeHome = join(root, "home");
    const targetOlt = join(fakeHome, ".agents", "skills", "olt");
    const rcFile = join(fakeHome, ".zshrc");
    mkdirSync(fakeHome, { recursive: true });
    writeFileSync(rcFile, 'export PATH="$HOME/.local/bin:$PATH"\n', "utf-8");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
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

    const origHome = process.env.HOME;
    const fakeHome = join(root, "home");
    const cwdSpy = spyOn(process, "cwd").mockReturnValue(sourceRepo);
    try {
      process.env.HOME = fakeHome;
      await main(["--allow-dirty"], { sourceRepoRoot: sourceRepo, homeDir: fakeHome, silent: true });
    } finally {
      cwdSpy.mockRestore();
      if (origHome !== undefined) {
        process.env.HOME = origHome;
      }
    }
  });

  test("runs as CLI entrypoint with main", async () => {
    const root = scratchRoot(import.meta.path, "sync-cli-exec");
    const repo = join(root, "repo");
    initFakeSkillsRepo(repo);

    const fakeHome = join(root, "home");
    const origHome = process.env.HOME;
    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });
    const cwdSpy = spyOn(process, "cwd").mockReturnValue(repo);

    try {
      process.env.HOME = fakeHome;
      await main(["--allow-dirty"], { sourceRepoRoot: repo, homeDir: fakeHome });
      expect(logs.some((l) => l.includes("Global skill sync complete"))).toBeTrue();
    } finally {
      cwdSpy.mockRestore();
      logSpy.mockRestore();
      if (origHome !== undefined) {
        process.env.HOME = origHome;
      }
    }
  });

  test("runSync recursively creates missing target home directory", async () => {
    const root = scratchRoot(import.meta.path, "sync-missing-home");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    // Fresh nested non-existent home directory
    const freshHome = join(root, "nested", "user", "home");
    const targetOlt = join(freshHome, ".agents", "skills", "olt");

    const summary = await runSync({
      sourceRepoRoot: sourceRepo,
      homeDir: freshHome,
      targetOltDir: targetOlt,
      allowDirty: true,
      silent: true,
    });

    expect(summary.skill).toBeDefined();
    expect(summary.binary.status).toBe("created");
    expect(summary.shell.modified).toBe(true);
    expect(existsSync(targetOlt)).toBe(true);
    expect(existsSync(join(freshHome, ".local", "bin", "olt"))).toBe(true);
  });

  test("runSync rejects cleanly when source repo root does not exist", async () => {
    const root = scratchRoot(import.meta.path, "sync-nonexistent-repo");
    const fakeHome = join(root, "home");
    const nonExistentRepo = join(root, "does-not-exist");

    await expect(
      runSync({
        sourceRepoRoot: nonExistentRepo,
        homeDir: fakeHome,
        targetOltDir: join(fakeHome, ".agents", "skills", "olt"),
        allowDirty: true,
        silent: true,
      }),
    ).rejects.toThrow(/it does not look like the skills repository/);

    // Verify target artifacts were not created
    expect(existsSync(join(fakeHome, ".agents", "skills", "olt"))).toBe(false);
  });
});
