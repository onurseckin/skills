import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { main, runSync } from "../../../scripts/sync/index.ts";
import {
  cleanupVirtualSyncFS,
  getVirtualSyncFS,
  scratchRoot,
  setupVirtualSyncFS,
} from "../sync-fixture.ts";

let vfs: ReturnType<typeof setupVirtualSyncFS>;

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

describe("scripts/sync/index.ts CLI and boundary scenarios", () => {
  test("main() executes end-to-end sync with argv options", async () => {
    const root = scratchRoot(import.meta.path, "sync-main-fn");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    const origHome = process.env.HOME;
    const fakeHome = join(root, "home");
    const cwdSpy = spyOn(process, "cwd").mockReturnValue(sourceRepo);
    try {
      process.env.HOME = fakeHome;
      await main(["--allow-dirty"], {
        sourceRepoRoot: sourceRepo,
        homeDir: fakeHome,
        silent: true,
      });
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
    expect(vfs.existsSync(targetOlt)).toBe(true);
    expect(vfs.existsSync(join(freshHome, ".local", "bin", "olt"))).toBe(true);
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

    expect(vfs.existsSync(join(fakeHome, ".agents", "skills", "olt"))).toBe(false);
  });
});
