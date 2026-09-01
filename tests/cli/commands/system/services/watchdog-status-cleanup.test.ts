import { describe, expect, test } from "bun:test";
import {
  registerWatchdog,
  saveWatchdogStore,
  type WatchdogRecord,
  type WatchdogStore,
} from "../../../../../olt/scripts/src/authority/watchdog/index.ts";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { initRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { registerSessionGrant } from "../../../../../olt/scripts/src/authority/session/index.ts";
import { scratchRoot } from "../../../../shared/fixtures/scratch-root.ts";

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

    const gen2Result = await execute(["watchdog:status", "--run", dir, "--generation", "2"]);
    const gen2Watchdogs = gen2Result.watchdogs as unknown as WatchdogRecord[];
    expect(gen2Watchdogs.length).toBe(2);

    const valResult = await execute(["watchdog:status", "--run", dir, "--phase", "validation"]);
    const valWatchdogs = valResult.watchdogs as unknown as WatchdogRecord[];
    expect(valWatchdogs.length).toBe(1);
    expect(valWatchdogs[0]?.id).toBe("wd-g2-val");

    const activeResult = await execute([
      "watchdog:status",
      "--run",
      dir,
      "--filter-status",
      "active",
    ]);
    const activeWatchdogs = activeResult.watchdogs as unknown as WatchdogRecord[];
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

  test("rejects retired watchdog:list alias", async () => {
    const dir = scratchRoot(import.meta.path, "cli-status-alias");
    await expect(execute(["watchdog:list", "--run", dir])).rejects.toThrow(
      "unknown command: watchdog:list",
    );
  });
});

describe("CLI - watchdog:cleanup", () => {
  test("allows a Mind to clean active watchdog state in its own authority run", async () => {
    const dir = scratchRoot(import.meta.path, "cli-cleanup-own-authority-run");
    const authorityRun = authorizeMind(dir);

    registerWatchdog(
      { id: "wd-own-authority-run", generation: 1, phase: "self-cleanup" },
      authorityRun,
    );

    const result = await execute([
      "watchdog:cleanup",
      "--authority-run",
      authorityRun,
      "--run",
      authorityRun,
      "--phase",
      "self-cleanup",
    ]);

    expect(result.cleaned_count).toBe(1);
    expect(result.remaining_active).toBe(0);

    const status = await execute([
      "watchdog:status",
      "--run",
      authorityRun,
      "--filter-status",
      "active",
    ]);
    expect((status.watchdogs as unknown as WatchdogRecord[]).length).toBe(0);
  });

  test("cleans stale monitors with dry-run and live modes", async () => {
    const dir = scratchRoot(import.meta.path, "cli-cleanup-modes");
    const authorityRun = authorizeMind(dir);

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

    const dryResult = await execute([
      "watchdog:cleanup",
      "--authority-run",
      authorityRun,
      "--run",
      dir,
      "--now",
      "2026-08-21T21:00:00.000Z",
      "--dry-run",
    ]);
    expect(dryResult.cleaned_count).toBe(1);
    expect(dryResult.dry_run).toBe(true);
    expect(String(dryResult.markdown)).toContain("Dry Run (Simulated)");

    const liveResult = await execute([
      "watchdog:cleanup",
      "--authority-run",
      authorityRun,
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
    const authorityRun = authorizeMind(dir);

    registerWatchdog({ id: "wd-phase-clean-1", generation: 1, phase: "init-phase" }, dir);
    registerWatchdog({ id: "wd-phase-clean-2", generation: 2, phase: "exec-phase" }, dir);

    const result = await execute([
      "watchdog:cleanup",
      "--authority-run",
      authorityRun,
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

  test("rejects retired watchdog:clean alias", async () => {
    const dir = scratchRoot(import.meta.path, "cli-cleanup-alias");
    const authorityRun = authorizeMind(dir);
    await expect(
      execute(["watchdog:clean", "--authority-run", authorityRun, "--run", dir]),
    ).rejects.toThrow("unknown command: watchdog:clean");
  });
});
