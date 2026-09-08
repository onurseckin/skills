import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
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
  getDirtySkillPaths,
  guardedRemoveSync,
  isManagedFallbackCopy,
  isPathDeclaredInContent,
  logDestructiveOp,
  materializeSkillFromHead,
  migrateOwnedLegacyDeployment,
  orDefault,
  parsePorcelainStatus,
  readJsonStringField,
  refuseSyncSourceMessage,
  resolveSkillSyncSource,
  rollbackAssistantLinks,
  runSync,
  smartEnsureSymlink,
} from "../../../scripts/sync/index.ts";
import {
  cleanupVirtualSyncFS,
  getVirtualSyncFS,
  scratchRoot,
  setupVirtualSyncFS,
} from "../sync-fixture.ts";

let vfs: ReturnType<typeof setupVirtualSyncFS>;

beforeAll(async () => {
  const initVfs = setupVirtualSyncFS();
  const root = scratchRoot("warmup", "warmup");
  const sourceRepo = join(root, "repo");
  initVfs.mkdirSync(join(sourceRepo, "olt", "scripts", "src"), { recursive: true });
  initVfs.writeFileSync(join(sourceRepo, "olt", "SKILL.md"), "---\nname: olt\n---\n");
  initVfs.writeFileSync(
    join(sourceRepo, "olt", "scripts", "package.json"),
    JSON.stringify({ name: "@local/olt-runtime", version: "1.0.0" }),
  );
  initVfs.writeFileSync(
    join(sourceRepo, "olt", "scripts", "src", "constants.ts"),
    'export const RUNTIME_VERSION = "1.0.0";\n',
  );
  initVfs.mkdirSync(join(sourceRepo, "agy-switch-helper"), { recursive: true });
  initVfs.writeFileSync(
    join(sourceRepo, "agy-switch-helper", "SKILL.md"),
    "---\nname: agy-switch-helper\ndescription: test\n---\n",
  );
  initVfs.mkdirSync(join(sourceRepo, ".git"), { recursive: true });
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
  vfs = setupVirtualSyncFS();
});

afterEach(() => {
  cleanupVirtualSyncFS();
});

function initFakeSkillsRepo(repoRoot: string): void {
  const curVfs = getVirtualSyncFS();
  curVfs.mkdirSync(join(repoRoot, "olt", "scripts", "src"), { recursive: true });
  curVfs.writeFileSync(
    join(repoRoot, "olt", "SKILL.md"),
    "---\nname: olt\ndescription: test\n---\n",
  );
  curVfs.writeFileSync(
    join(repoRoot, "olt", "scripts", "package.json"),
    JSON.stringify({ name: "@local/olt-runtime", version: "1.0.0" }, null, 2),
  );
  curVfs.writeFileSync(
    join(repoRoot, "olt", "scripts", "src", "constants.ts"),
    'export const RUNTIME_VERSION = "1.0.0";\n',
  );
  curVfs.writeFileSync(join(repoRoot, "olt", "scripts", "harness.ts"), "console.log('harness');\n");

  curVfs.mkdirSync(join(repoRoot, "agy-switch-helper"), { recursive: true });
  curVfs.writeFileSync(
    join(repoRoot, "agy-switch-helper", "SKILL.md"),
    "---\nname: agy-switch-helper\ndescription: test\n---\n",
  );

  curVfs.mkdirSync(join(repoRoot, ".git"), { recursive: true });
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
    expect(typeof getDirtySkillPaths).toBe("function");
    expect(typeof materializeSkillFromHead).toBe("function");
    expect(typeof parsePorcelainStatus).toBe("function");
    expect(typeof refuseSyncSourceMessage).toBe("function");
    expect(typeof resolveSkillSyncSource).toBe("function");
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
    vfs.mkdirSync(fakeHome, { recursive: true });
    vfs.writeFileSync(rcFile, 'export PATH="$HOME/.local/bin:$PATH"\n');

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
});
