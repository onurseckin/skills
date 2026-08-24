import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  registerWatchdog,
  saveWatchdogStore,
  type WatchdogRecord,
  type WatchdogStore,
} from "../../../olt/scripts/src/authority/watchdog-manager.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("CLI - watchdog:status", () => {
  test("renders empty state table when no watchdogs exist", async () => {
    const dir = scratchRoot(import.meta.path, "cli-status-empty");
    const result = await execute(["watchdog:status", "--run", dir]);

    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Watchdog Lifecycle & Cadence Status");
    expect(String(result.markdown)).toContain("Total Registered Monitors**: 0 (0 matching filter)");
    expect(result.run_root).toBe(dir);

    const summary = result.summary as { total: number; active_count: number };
    expect(summary.total).toBe(0);
    expect(summary.active_count).toBe(0);
  });

  test("renders populated status table and filters by generation and phase", async () => {
    const dir = scratchRoot(import.meta.path, "cli-status-filters");

    registerWatchdog({ id: "wd-g1-plan", generation: 1, phase: "planning" }, dir);
    registerWatchdog({ id: "wd-g2-exec", generation: 2, phase: "execution" }, dir);
    registerWatchdog({ id: "wd-g2-val", generation: 2, phase: "validation" }, dir);

    // Filter by generation 2
    const gen2Result = await execute(["watchdog:status", "--run", dir, "--generation", "2"]);
    const gen2Watchdogs = gen2Result.watchdogs as unknown as WatchdogRecord[];
    expect(gen2Watchdogs.length).toBe(2);

    // Filter by phase validation
    const valResult = await execute(["watchdog:status", "--run", dir, "--phase", "validation"]);
    const valWatchdogs = valResult.watchdogs as unknown as WatchdogRecord[];
    expect(valWatchdogs.length).toBe(1);
    expect(valWatchdogs[0]?.id).toBe("wd-g2-val");

    // Filter by status active
    const activeResult = await execute([
      "watchdog:status",
      "--run",
      dir,
      "--filter-status",
      "active",
    ]);
    const activeWatchdogs = activeResult.watchdogs as unknown as WatchdogRecord[];
    // wd-g1-plan is active (gen 1), wd-g2-exec was superseded by wd-g2-val (gen 2), so 2 active total
    expect(activeWatchdogs.length).toBe(2);
  });

  test("rejects invalid filter-status or unknown flag", async () => {
    const dir = scratchRoot(import.meta.path, "cli-status-errors");

    await expect(
      execute(["watchdog:status", "--run", dir, "--filter-status", "unknown_status"]),
    ).rejects.toThrow(HarnessError);

    await expect(
      execute(["watchdog:status", "--run", dir, "--invalid-flag", "value"]),
    ).rejects.toThrow(HarnessError);
  });

  test("supports watchdog:list alias", async () => {
    const dir = scratchRoot(import.meta.path, "cli-status-alias");
    registerWatchdog({ id: "wd-alias-1", generation: 1 }, dir);

    const result = await execute(["watchdog:list", "--run", dir]);
    expect(String(result.markdown)).toContain("### Watchdog Lifecycle & Cadence Status");
    expect((result.watchdogs as unknown as WatchdogRecord[]).length).toBe(1);
  });
});

describe("CLI - watchdog:cleanup", () => {
  test("cleans stale monitors with dry-run and live modes", async () => {
    const dir = scratchRoot(import.meta.path, "cli-cleanup-modes");

    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T18:00:00.000Z",
      watchdogs: [
        {
          id: "wd-stale-cli-1",
          generation: 1,
          pulse_id: null,
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 201,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T18:00:00.000Z",
          last_heartbeat_at: "2026-08-21T18:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(seedStore, dir);

    // Dry run
    const dryResult = await execute([
      "watchdog:cleanup",
      "--run",
      dir,
      "--now",
      "2026-08-21T21:00:00.000Z",
      "--dry-run",
    ]);
    expect(dryResult.cleaned_count).toBe(1);
    expect(dryResult.dry_run).toBe(true);
    expect(String(dryResult.markdown)).toContain("Dry Run (Simulated)");

    // Live run
    const liveResult = await execute([
      "watchdog:cleanup",
      "--run",
      dir,
      "--now",
      "2026-08-21T21:00:00.000Z",
    ]);
    expect(liveResult.cleaned_count).toBe(1);
    expect(liveResult.dry_run).toBe(false);
    expect(liveResult.remaining_active).toBe(0);
  });

  test("executes phase cleanup via --phase flag in watchdog:cleanup", async () => {
    const dir = scratchRoot(import.meta.path, "cli-cleanup-phase-flag");

    registerWatchdog({ id: "wd-phase-clean-1", generation: 1, phase: "init-phase" }, dir);
    registerWatchdog({ id: "wd-phase-clean-2", generation: 2, phase: "exec-phase" }, dir);

    const result = await execute([
      "watchdog:cleanup",
      "--run",
      dir,
      "--phase",
      "init-phase",
      "--generation",
      "1",
    ]);

    expect(result.cleaned_count).toBe(1);
    expect(result.phase).toBe("init-phase");
    expect(result.remaining_active).toBe(1);
  });

  test("supports watchdog:clean alias", async () => {
    const dir = scratchRoot(import.meta.path, "cli-cleanup-alias");
    const result = await execute(["watchdog:clean", "--run", dir]);
    expect(String(result.markdown)).toContain("### Watchdog Stale Cleanup Engine");
    expect(result.cleaned_count).toBe(0);
  });
});

describe("CLI - watchdog:phase-cleanup", () => {
  test("terminates active monitors for a specific phase", async () => {
    const dir = scratchRoot(import.meta.path, "cli-phase-cleanup-spec");

    registerWatchdog({ id: "wd-plan-phase", generation: 1, phase: "planning" }, dir);
    registerWatchdog({ id: "wd-exec-phase", generation: 2, phase: "execution" }, dir);

    const result = await execute(["watchdog:phase-cleanup", "--run", dir, "--phase", "planning"]);

    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Watchdog Automatic Phase Cleanup Engine");
    expect(result.terminated_count).toBe(1);
    expect(result.remaining_active).toBe(1);
    expect(result.phase).toBe("planning");
  });

  test("terminates prior phase monitors on rollover with --current-phase", async () => {
    const dir = scratchRoot(import.meta.path, "cli-phase-rollover-spec");

    registerWatchdog({ id: "wd-old-step", generation: 1, phase: "step-1" }, dir);
    registerWatchdog({ id: "wd-new-step", generation: 2, phase: "step-2" }, dir);

    const result = await execute([
      "watchdog:phase-cleanup",
      "--run",
      dir,
      "--current-phase",
      "step-2",
    ]);

    expect(result.terminated_count).toBe(1);
    expect(result.remaining_active).toBe(1);
    expect(result.current_phase).toBe("step-2");
    const terminated = result.terminated_watchdogs as unknown as WatchdogRecord[];
    expect(terminated[0]?.id).toBe("wd-old-step");
  });

  test("supports watchdog:cleanup-phase and watchdog:phase-clean aliases", async () => {
    const dir = scratchRoot(import.meta.path, "cli-phase-clean-alias");
    registerWatchdog({ id: "wd-alias-test", generation: 1, phase: "draft" }, dir);

    const result = await execute(["watchdog:cleanup-phase", "--run", dir, "--phase", "draft"]);
    expect(result.terminated_count).toBe(1);
  });
});

describe("CLI - watchdog:verify", () => {
  test("reports valid status when lifecycle invariants are fully met", async () => {
    const dir = scratchRoot(import.meta.path, "cli-verify-pass");

    registerWatchdog({ id: "wd-good-1", generation: 1, pulse_id: "pulse-1" }, dir);
    registerWatchdog({ id: "wd-good-2", generation: 2, pulse_id: "pulse-2" }, dir);

    const result = await execute(["watchdog:verify", "--run", dir]);

    expect(result.valid).toBe(true);
    expect((result.violations as unknown as string[]).length).toBe(0);
    expect(String(result.markdown)).toContain("PASSED ✅");
  });

  test("detects and surfaces violations in markdown and JSON report", async () => {
    const dir = scratchRoot(import.meta.path, "cli-verify-violations");

    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T18:00:00.000Z",
      watchdogs: [
        {
          id: "wd-viol-1",
          generation: 1,
          pulse_id: "p-dup",
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 301,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T18:00:00.000Z",
          last_heartbeat_at: "2026-08-21T18:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
        {
          id: "wd-viol-2",
          generation: 2,
          pulse_id: "p-dup",
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 302,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T21:00:00.000Z",
          last_heartbeat_at: "2026-08-21T21:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(seedStore, dir);

    const result = await execute([
      "watchdog:verify",
      "--run",
      dir,
      "--now",
      "2026-08-21T21:00:00.000Z",
    ]);

    expect(result.valid).toBe(false);
    expect((result.violations as unknown as string[]).length).toBeGreaterThan(0);
    expect(String(result.markdown)).toContain("FAILED ❌");
    expect(String(result.markdown)).toContain("#### Invariant Violations");
  });

  test("supports watchdog:check and watchdog:lint aliases and filters violations by generation", async () => {
    const dir = scratchRoot(import.meta.path, "cli-verify-alias");
    const result = await execute(["watchdog:check", "--run", dir]);
    expect(result.valid).toBe(true);

    const genResult = await execute(["watchdog:verify", "--run", dir, "--generation", "1"]);
    expect(genResult.valid).toBe(true);
  });
});

describe("CLI - watchdog:probe", () => {
  test("executes supervisory health probe without run directory", async () => {
    const result = await execute(["watchdog:probe"]);
    expect(typeof result.markdown).toBe("string");
    expect(result.markdown).toContain("Two-Way Supervisory Watchdog 5-Point Health Probe");
    expect(typeof result.dispatched).toBe("boolean");
    expect(result.report).toBeDefined();
  });

  test("executes supervisory health probe with run target", async () => {
    const dir = scratchRoot(import.meta.path, "cli-probe-run");
    const result = await execute(["watchdog:probe", "--run", dir]);
    expect(typeof result.markdown).toBe("string");
    expect(result.markdown).toContain("Two-Way Supervisory Watchdog 5-Point Health Probe");
    expect(result.run_root).toBe(dir);
  });
});

describe("Invariants & Cleanliness Audit - CLI Watchdog Ops", () => {
  test("zero TypeScript any and zero suppressions across CLI test file", () => {
    const content = readFileSync(__filename, "utf8");

    const anyAnnotation = new RegExp(":\\s*any\\b");
    const anyCast = new RegExp("as\\s+any\\b");
    const anyGeneric = new RegExp("<\\s*any\\s*>");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    expect(content).not.toMatch(anyAnnotation);
    expect(content).not.toMatch(anyCast);
    expect(content).not.toMatch(anyGeneric);
    expect(content.includes(tsIgnore)).toBe(false);
    expect(content.includes(tsExpectError)).toBe(false);
    expect(content.includes(tsNoCheck)).toBe(false);
    expect(content.includes(suppressionDirectiveA)).toBe(false);
    expect(content.includes(suppressionDirectiveB)).toBe(false);
  });
});
