import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GLOBAL_SYNC_GEN5,
  computeIsMain,
  main,
  orDefault,
  runSync,
} from "../../../scripts/sync/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

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
  test("exports GLOBAL_SYNC_GEN5 as true", () => {
    expect(GLOBAL_SYNC_GEN5).toBe(true);
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

  test("runs as CLI entrypoint with spawnSync", () => {
    const root = scratchRoot(import.meta.path, "sync-cli-exec");
    const repo = join(root, "repo");
    initFakeSkillsRepo(repo);

    const scriptPath = join(process.cwd(), "scripts/sync/index.ts");
    const result = spawnSync("bun", [scriptPath, "--allow-dirty"], {
      cwd: repo,
      encoding: "utf-8",
      env: { ...process.env, HOME: join(root, "home") },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Global skill sync complete");
  });
});
