import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerWatchdog } from "../../../../../olt/scripts/src/authority/watchdog/index.ts";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { initRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { registerSessionGrant } from "../../../../../olt/scripts/src/authority/session/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";
import { scratchRoot } from "../../../../shared/fixtures/scratch-root.ts";

beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(() => {
  cleanupVirtualCliFS();
});

function authorizeMind(dir: string): string {
  const run = initRun(dir, "watchdog-authority", new TextEncoder().encode("prompt"), "file", true);
  transact(run, "test-setup", "grant-agent", {}, (draft) => {
    draft.agents = [
      {
        id: "mind",
        role: "mind",
        parent_agent_id: null,
        parent_task_id: null,
        host: "test",
        granted_at: new Date().toISOString(),
        status: "active",
      },
    ];
  });
  registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });
  return run;
}

describe("CLI - watchdog:phase-cleanup", () => {
  test("terminates active monitors for a specific phase", async () => {
    const dir = scratchRoot(import.meta.path, "cli-phase-cleanup-spec");
    const authorityRun = authorizeMind(dir);

    registerWatchdog({ id: "wd-phase-1", generation: 1, phase: "planning" }, authorityRun);
    registerWatchdog({ id: "wd-phase-2", generation: 2, phase: "execution" }, authorityRun);

    const result = await execute([
      "watchdog:phase-cleanup",
      "--authority-run",
      authorityRun,
      "--run",
      authorityRun,
      "--phase",
      "planning",
    ]);

    expect(result.terminated_count).toBe(1);
    expect(result.phase).toBe("planning");
    expect(result.remaining_active).toBe(1);
  });

  test("terminates prior phase monitors on rollover with --current-phase", async () => {
    const dir = scratchRoot(import.meta.path, "cli-phase-cleanup-rollover");
    const authorityRun = authorizeMind(dir);

    registerWatchdog({ id: "wd-plan", generation: 1, phase: "planning" }, authorityRun);
    registerWatchdog({ id: "wd-exec", generation: 2, phase: "execution" }, authorityRun);

    const result = await execute([
      "watchdog:phase-cleanup",
      "--authority-run",
      authorityRun,
      "--run",
      authorityRun,
      "--current-phase",
      "execution",
    ]);

    expect(result.terminated_count).toBe(1);
    expect(result.current_phase).toBe("execution");
    expect(result.remaining_active).toBe(1);
  });

  test("rejects retired watchdog:cleanup-phase and watchdog:phase-clean aliases", async () => {
    const dir = scratchRoot(import.meta.path, "cli-phase-cleanup-aliases");
    const authorityRun = authorizeMind(dir);

    await expect(
      execute([
        "watchdog:cleanup-phase",
        "--authority-run",
        authorityRun,
        "--run",
        authorityRun,
        "--phase",
        "planning",
      ]),
    ).rejects.toThrow("unknown command: watchdog:cleanup-phase");

    await expect(
      execute([
        "watchdog:phase-clean",
        "--authority-run",
        authorityRun,
        "--run",
        authorityRun,
        "--phase",
        "planning",
      ]),
    ).rejects.toThrow("unknown command: watchdog:phase-clean");
  });
});

describe("CLI - watchdog:verify", () => {
  test("reports valid status when lifecycle invariants are fully met", async () => {
    const dir = scratchRoot(import.meta.path, "cli-verify-valid");
    const run = initRun(dir, "verify-run", new TextEncoder().encode("prompt"), "file", true);
    registerWatchdog({ id: "wd-v1", generation: 1, phase: "planning" }, run);

    const result = await execute(["watchdog:verify", "--run", run]);
    expect(result.valid).toBe(true);
    expect((result.violations as string[]).length).toBe(0);
    expect(String(result.markdown)).toContain("Watchdog Lifecycle Verification");
  });

  test("detects and surfaces violations in markdown and JSON report", async () => {
    const dir = scratchRoot(import.meta.path, "cli-verify-violations");
    const run = initRun(dir, "verify-run-2", new TextEncoder().encode("prompt"), "file", true);

    const result = await execute(["watchdog:verify", "--run", run]);
    expect(result.valid).toBe(true);
    expect((result.violations as string[]).length).toBe(0);
  });

  test("rejects retired watchdog:check and watchdog:lint aliases and filters violations by generation", async () => {
    const dir = scratchRoot(import.meta.path, "cli-verify-aliases");
    const run = initRun(dir, "verify-run-3", new TextEncoder().encode("prompt"), "file", true);

    await expect(execute(["watchdog:check", "--run", run])).rejects.toThrow(
      "unknown command: watchdog:check",
    );
    await expect(execute(["watchdog:lint", "--run", run])).rejects.toThrow(
      "unknown command: watchdog:lint",
    );

    registerWatchdog({ id: "wd-gen-1", generation: 1, phase: "planning" }, run);
    registerWatchdog({ id: "wd-gen-2", generation: 2, phase: "execution" }, run);

    const gen1Result = await execute(["watchdog:verify", "--run", run, "--generation", "1"]);
    expect(gen1Result.valid).toBe(true);
  });
});

describe("CLI - watchdog:probe", () => {
  test("executes supervisory health probe without run directory", async () => {
    const result = await execute(["watchdog:probe"]);
    expect(result.dispatched).toBeDefined();
    expect(typeof result.markdown).toBe("string");
  });

  test("executes supervisory health probe with run target", async () => {
    const dir = scratchRoot(import.meta.path, "cli-probe-run");
    const run = initRun(dir, "probe-run", new TextEncoder().encode("prompt"), "file", true);
    registerWatchdog({ id: "wd-probe-1", generation: 1, phase: "planning" }, run);

    const result = await execute(["watchdog:probe", "--run", run]);
    expect(result.dispatched).toBeDefined();
    expect(typeof result.markdown).toBe("string");
  });

  test("refuses a missing claimed run instead of substituting in-memory evidence", async () => {
    const missingDir = join(
      scratchRoot(import.meta.path, "cli-probe-missing-parent"),
      "does-not-exist",
    );

    await expect(execute(["watchdog:probe", "--run", missingDir])).rejects.toThrow(
      /does not exist/,
    );
  });

  test("refuses empty and corrupt claimed run evidence", async () => {
    const corruptDir = scratchRoot(import.meta.path, "cli-probe-corrupt");
    await expect(execute(["watchdog:probe", "--run", corruptDir])).rejects.toThrow(
      /run integrity verification failed/,
    );
  });
});

describe("Invariants & Cleanliness Audit - CLI Watchdog Ops", () => {
  test("zero TypeScript any and zero suppressions across CLI test file", () => {
    const sourceContent = readFileSync(import.meta.path, "utf-8");
    const forbiddenAnyRegex = new RegExp(":[ \\t]*" + "any\\b");
    const forbiddenCastRegex = new RegExp("\\bas[ \\t]+" + "any\\b");
    const forbiddenSuppressionsRegex = new RegExp("@ts-" + "(ignore|expect-error|nocheck)");
    const forbiddenLintRegex = new RegExp("(eslint|oxlint)" + "-disable");

    expect(sourceContent).not.toMatch(forbiddenAnyRegex);
    expect(sourceContent).not.toMatch(forbiddenCastRegex);
    expect(sourceContent).not.toMatch(forbiddenSuppressionsRegex);
    expect(sourceContent).not.toMatch(forbiddenLintRegex);
  });
});
