import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupPreviousPhaseWatchdogs,
  cleanupStaleWatchdogs,
  createDefaultWatchdogStore,
  DEFAULT_HEARTBEAT_CADENCE_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  heartbeatWatchdog,
  listWatchdogs,
  loadWatchdogStore,
  parseTimestamp,
  registerWatchdog,
  renderAsciiWatchdogTable,
  resolveWatchdogStorePath,
  saveWatchdogStore,
  terminatePhaseWatchdogs,
  terminateWatchdog,
  verifyWatchdogLifecycle,
  type WatchdogRecord,
  type WatchdogStore,
} from "../../../olt/scripts/src/authority/watchdog-manager.ts";
import {
  watchdogCleanupCommand,
  watchdogPhaseCleanupCommand,
  watchdogStatusCommand,
  watchdogVerifyCommand,
} from "../../../olt/scripts/src/cli/commands/watchdog-ops.ts";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("WatchdogManager - Store Lifecycle & Resolution", () => {
  test("resolves store path for directory or explicit json file", () => {
    const dir = scratchRoot(import.meta.path, "resolve-path");
    expect(resolveWatchdogStorePath(dir)).toBe(join(dir, "watchdogs.json"));
    expect(resolveWatchdogStorePath(join(dir, "custom.json"))).toBe(join(dir, "custom.json"));
  });

  test("loads default store when file does not exist", () => {
    const dir = scratchRoot(import.meta.path, "load-default");
    const store = loadWatchdogStore(dir);
    expect(store.schema).toBe("harness.watchdog_store");
    expect(store.version).toBe(1);
    expect(store.watchdogs).toEqual([]);
    expect(typeof store.updated_at).toBe("string");
  });

  test("saves and reloads store durably", () => {
    const dir = scratchRoot(import.meta.path, "save-reload");
    const store: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T20:00:00.000Z",
      watchdogs: [
        {
          id: "wd-test-1",
          generation: 1,
          pulse_id: "p-100",
          phase: "autonomous-loop",
          run_id: "run-1",
          run_root: dir,
          pid: 1111,
          ppid: 2222,
          agent_id: "agent-1",
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
          metadata: { note: "test-save" },
        },
      ],
    };

    saveWatchdogStore(store, dir);
    const loaded = loadWatchdogStore(dir);
    expect(loaded.watchdogs.length).toBe(1);
    expect(loaded.watchdogs[0]?.id).toBe("wd-test-1");
    expect(loaded.watchdogs[0]?.status).toBe("active");
    expect(loaded.watchdogs[0]?.metadata).toEqual({ note: "test-save" });
  });

  test("throws HarnessError when loading a corrupted store", () => {
    const dir = scratchRoot(import.meta.path, "corrupt-store");
    const storePath = join(dir, "watchdogs.json");
    writeFileSync(storePath, "INVALID_JSON_CONTENT", "utf8");

    expect(() => loadWatchdogStore(dir)).toThrow(HarnessError);
  });
});

describe("WatchdogManager - Registration & Single Active Invariant", () => {
  test("registers a watchdog with default cadence and timeout", () => {
    const dir = scratchRoot(import.meta.path, "reg-defaults");
    const result = registerWatchdog(
      {
        generation: 1,
        now: "2026-08-21T21:00:00.000Z",
      },
      dir,
    );

    expect(result.watchdog.id).toMatch(/^wd-gen1-/);
    expect(result.watchdog.generation).toBe(1);
    expect(result.watchdog.heartbeat_cadence_ms).toBe(DEFAULT_HEARTBEAT_CADENCE_MS);
    expect(result.watchdog.timeout_ms).toBe(DEFAULT_WATCHDOG_TIMEOUT_MS);
    expect(result.watchdog.status).toBe("active");
    expect(result.watchdog.started_at).toBe("2026-08-21T21:00:00.000Z");
    expect(result.watchdog.last_heartbeat_at).toBe("2026-08-21T21:00:00.000Z");
    expect(result.supersededWatchdogs).toEqual([]);
    expect(result.store.watchdogs.length).toBe(1);
  });

  test("enforces max 1 active watchdog per generation (supersedes prior active monitor)", () => {
    const dir = scratchRoot(import.meta.path, "single-active-gen");

    const first = registerWatchdog(
      {
        id: "wd-gen1-first",
        generation: 1,
        now: "2026-08-21T21:00:00.000Z",
      },
      dir,
    );
    expect(first.watchdog.status).toBe("active");
    expect(first.supersededWatchdogs.length).toBe(0);

    const second = registerWatchdog(
      {
        id: "wd-gen1-second",
        generation: 1,
        now: "2026-08-21T21:01:00.000Z",
      },
      dir,
    );

    expect(second.watchdog.status).toBe("active");
    expect(second.supersededWatchdogs.length).toBe(1);
    expect(second.supersededWatchdogs[0]?.id).toBe("wd-gen1-first");
    expect(second.supersededWatchdogs[0]?.status).toBe("terminated");
    expect(second.supersededWatchdogs[0]?.termination_reason).toBe("superseded_by_new_watchdog");

    const store = loadWatchdogStore(dir);
    const activeMonitors = store.watchdogs.filter(
      (w) => w.status === "active" && w.generation === 1,
    );
    expect(activeMonitors.length).toBe(1);
    expect(activeMonitors[0]?.id).toBe("wd-gen1-second");
  });

  test("supports multi-generation active watchdogs simultaneously", () => {
    const dir = scratchRoot(import.meta.path, "multi-gen");

    const gen1 = registerWatchdog({ id: "wd-gen1", generation: 1 }, dir);
    const gen2 = registerWatchdog({ id: "wd-gen2", generation: 2 }, dir);
    const gen3 = registerWatchdog({ id: "wd-gen3", generation: 3 }, dir);

    expect(gen1.watchdog.status).toBe("active");
    expect(gen2.watchdog.status).toBe("active");
    expect(gen3.watchdog.status).toBe("active");

    const store = loadWatchdogStore(dir);
    const activeMonitors = store.watchdogs.filter((w) => w.status === "active");
    expect(activeMonitors.length).toBe(3);
  });

  test("supersedes prior watchdog when pulse_id matches", () => {
    const dir = scratchRoot(import.meta.path, "pulse-match");

    registerWatchdog({ id: "wd-pulse-a", generation: 1, pulse_id: "pulse-99" }, dir);
    const result = registerWatchdog({ id: "wd-pulse-b", generation: 2, pulse_id: "pulse-99" }, dir);

    expect(result.supersededWatchdogs.length).toBe(1);
    expect(result.supersededWatchdogs[0]?.id).toBe("wd-pulse-a");
    expect(result.supersededWatchdogs[0]?.status).toBe("terminated");
  });

  test("auto-cleans stale watchdog during registration if heartbeat is overdue", () => {
    const dir = scratchRoot(import.meta.path, "auto-clean-reg");

    // Seed an old watchdog
    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T18:00:00.000Z",
      watchdogs: [
        {
          id: "wd-gen1-ancient",
          generation: 1,
          pulse_id: null,
          phase: "autonomous-loop",
          run_id: null,
          run_root: null,
          pid: 100,
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

    // Register at 20:00:00 (2 hours later)
    registerWatchdog(
      {
        id: "wd-gen1-fresh",
        generation: 1,
        now: "2026-08-21T20:00:00.000Z",
      },
      dir,
    );

    const store = loadWatchdogStore(dir);
    const ancient = store.watchdogs.find((w) => w.id === "wd-gen1-ancient");
    expect(ancient?.status).toBe("stale");
    expect(ancient?.termination_reason).toBe("heartbeat_timeout");
  });
});

describe("WatchdogManager - Heartbeat & Termination", () => {
  test("heartbeat updates last_heartbeat_at and recovers stale status", () => {
    const dir = scratchRoot(import.meta.path, "heartbeat-ok");

    registerWatchdog(
      {
        id: "wd-hb-1",
        generation: 1,
        now: "2026-08-21T20:00:00.000Z",
      },
      dir,
    );

    const updated = heartbeatWatchdog(
      "wd-hb-1",
      {
        now: "2026-08-21T20:03:00.000Z",
        phase: "validation-phase",
        metadata: { pulse: 2 },
      },
      dir,
    );

    expect(updated.last_heartbeat_at).toBe("2026-08-21T20:03:00.000Z");
    expect(updated.phase).toBe("validation-phase");
    expect(updated.metadata).toEqual({ pulse: 2 });
    expect(updated.status).toBe("active");
  });

  test("heartbeat throws NOT_FOUND for unknown watchdog id", () => {
    const dir = scratchRoot(import.meta.path, "heartbeat-not-found");
    expect(() => heartbeatWatchdog("wd-unknown", {}, dir)).toThrow(HarnessError);
  });

  test("heartbeat throws INVALID_STATE on terminated watchdog", () => {
    const dir = scratchRoot(import.meta.path, "heartbeat-terminated");
    registerWatchdog({ id: "wd-term-1" }, dir);
    terminateWatchdog("wd-term-1", { reason: "closed" }, dir);

    expect(() => heartbeatWatchdog("wd-term-1", {}, dir)).toThrow(HarnessError);
  });

  test("terminateWatchdog transitions status to terminated and is idempotent", () => {
    const dir = scratchRoot(import.meta.path, "terminate-ok");
    registerWatchdog({ id: "wd-term-2" }, dir);

    const term1 = terminateWatchdog(
      "wd-term-2",
      { reason: "job_done", now: "2026-08-21T21:00:00.000Z" },
      dir,
    );
    expect(term1.status).toBe("terminated");
    expect(term1.termination_reason).toBe("job_done");
    expect(term1.terminated_at).toBe("2026-08-21T21:00:00.000Z");

    const term2 = terminateWatchdog("wd-term-2", { reason: "repeat" }, dir);
    expect(term2.status).toBe("terminated");
  });

  test("terminateWatchdog throws NOT_FOUND for unknown id", () => {
    const dir = scratchRoot(import.meta.path, "term-not-found");
    expect(() => terminateWatchdog("wd-nonexistent", {}, dir)).toThrow(HarnessError);
  });
});

describe("WatchdogManager - Stale Cleanup & Filtering", () => {
  test("cleanupStaleWatchdogs marks expired monitors as stale", () => {
    const dir = scratchRoot(import.meta.path, "cleanup-stale");

    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T18:00:00.000Z",
      watchdogs: [
        {
          id: "wd-stale-1",
          generation: 1,
          pulse_id: "p-1",
          phase: "autonomous-loop",
          run_id: null,
          run_root: null,
          pid: 1234,
          ppid: 1,
          agent_id: "agent-a",
          started_at: "2026-08-21T18:00:00.000Z",
          last_heartbeat_at: "2026-08-21T18:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
        {
          id: "wd-fresh-1",
          generation: 1,
          pulse_id: "p-2",
          phase: "autonomous-loop",
          run_id: null,
          run_root: null,
          pid: 5678,
          ppid: 1,
          agent_id: "agent-b",
          started_at: "2026-08-21T19:59:00.000Z",
          last_heartbeat_at: "2026-08-21T19:59:00.000Z",
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
    const dryRun = cleanupStaleWatchdogs(
      {
        now: "2026-08-21T20:00:00.000Z",
        dryRun: true,
      },
      dir,
    );
    expect(dryRun.cleanedCount).toBe(1);
    expect(dryRun.cleanedWatchdogs[0]?.id).toBe("wd-stale-1");
    expect(dryRun.dryRun).toBe(true);

    // Verify store was not mutated by dry run
    const storeAfterDry = loadWatchdogStore(dir);
    expect(storeAfterDry.watchdogs.find((w) => w.id === "wd-stale-1")?.status).toBe("active");

    // Live cleanup
    const live = cleanupStaleWatchdogs(
      {
        now: "2026-08-21T20:00:00.000Z",
        dryRun: false,
      },
      dir,
    );
    expect(live.cleanedCount).toBe(1);
    expect(live.activeCount).toBe(1);

    const storeAfterLive = loadWatchdogStore(dir);
    const staleWd = storeAfterLive.watchdogs.find((w) => w.id === "wd-stale-1");
    expect(staleWd?.status).toBe("stale");
    expect(staleWd?.termination_reason).toBe("stale_cadence_exceeded");
  });

  test("listWatchdogs filters accurately across various dimensions", () => {
    const dir = scratchRoot(import.meta.path, "list-filter");

    registerWatchdog({ id: "wd-g1-a", generation: 1, phase: "phase-a" }, dir);
    registerWatchdog({ id: "wd-g1-b", generation: 1, phase: "phase-b" }, dir);
    registerWatchdog({ id: "wd-g2-a", generation: 2, phase: "phase-a" }, dir);

    // Filter by generation
    const gen2List = listWatchdogs({ generation: 2 }, dir);
    expect(gen2List.length).toBe(1);
    expect(gen2List[0]?.id).toBe("wd-g2-a");

    // Filter by phase
    const phaseAList = listWatchdogs({ phase: "phase-a" }, dir);
    expect(phaseAList.length).toBe(2);

    // Filter by status array
    const activeList = listWatchdogs({ status: ["active"] }, dir);
    expect(activeList.length).toBe(2); // wd-g1-a was superseded by wd-g1-b, so wd-g1-b & wd-g2-a are active
  });
});

describe("WatchdogManager - ASCII Rendering", () => {
  test("renders empty state table when no watchdogs exist", () => {
    const rendered = renderAsciiWatchdogTable([]);
    expect(rendered).toContain("┌─");
    expect(rendered).toContain("No registered watchdog monitors found matching criteria");
    expect(rendered).toContain("└─");
  });

  test("renders populated ASCII table with status glyphs and timestamps", () => {
    const watchdogs: WatchdogRecord[] = [
      {
        id: "wd-gen1-test12345",
        generation: 1,
        pulse_id: "P-01",
        phase: "autonomous-loop",
        run_id: "run-1",
        run_root: null,
        pid: 12345,
        ppid: 1,
        agent_id: "orch-lead",
        started_at: "2026-08-21T20:00:00.000Z",
        last_heartbeat_at: "2026-08-21T20:00:00.000Z",
        heartbeat_cadence_ms: 180_000,
        timeout_ms: 360_000,
        status: "active",
        terminated_at: null,
        termination_reason: null,
      },
      {
        id: "wd-gen1-stale9999",
        generation: 1,
        pulse_id: null,
        phase: "review",
        run_id: "run-1",
        run_root: null,
        pid: 9999,
        ppid: 1,
        agent_id: "coord-1",
        started_at: "2026-08-21T18:00:00.000Z",
        last_heartbeat_at: "2026-08-21T18:00:00.000Z",
        heartbeat_cadence_ms: 180_000,
        timeout_ms: 360_000,
        status: "stale",
        terminated_at: null,
        termination_reason: "heartbeat_timeout",
      },
    ];

    const rendered = renderAsciiWatchdogTable(watchdogs, { now: "2026-08-21T20:01:00.000Z" });
    expect(rendered).toContain("Watchdog ID");
    expect(rendered).toContain("Gen / Pulse");
    expect(rendered).toContain("Phase");
    expect(rendered).toContain("Status");
    expect(rendered).toContain("PID");
    expect(rendered).toContain("[ACTIVE 🟢]");
    expect(rendered).toContain("[STALE ⚠️]");
    expect(rendered).toContain("180s");
    expect(rendered).toContain("12345");
  });
});

describe("CLI Commands - watchdog:status and watchdog:cleanup", () => {
  test("watchdogStatusCommand returns structured summary and markdown", () => {
    const dir = scratchRoot(import.meta.path, "cli-status");

    registerWatchdog({ id: "wd-cli-1", generation: 1, phase: "init" }, dir);
    registerWatchdog({ id: "wd-cli-2", generation: 2, phase: "execute" }, dir);

    const result = watchdogStatusCommand({
      run: dir,
    });

    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Watchdog Lifecycle & Cadence Status");
    expect(String(result.markdown)).toContain("Total Registered Monitors");

    const summary = result.summary as {
      total: number;
      active_count: number;
      by_generation: Record<string, number>;
    };
    expect(summary.total).toBe(2);
    expect(summary.active_count).toBe(2);
    expect(summary.by_generation["gen-1"]).toBe(1);
    expect(summary.by_generation["gen-2"]).toBe(1);
  });

  test("watchdogStatusCommand filters by status and generation", () => {
    const dir = scratchRoot(import.meta.path, "cli-status-filter");

    registerWatchdog({ id: "wd-filt-1", generation: 1 }, dir);
    registerWatchdog({ id: "wd-filt-2", generation: 2 }, dir);

    const result = watchdogStatusCommand({
      run: dir,
      generation: "2",
      "filter-status": "active",
    });

    const watchdogs = result.watchdogs as unknown as WatchdogRecord[];
    expect(watchdogs.length).toBe(1);
    expect(watchdogs[0]?.id).toBe("wd-filt-2");
  });

  test("watchdogStatusCommand throws on invalid filter-status or unknown flag", () => {
    const dir = scratchRoot(import.meta.path, "cli-status-errors");

    expect(() =>
      watchdogStatusCommand({
        run: dir,
        "filter-status": "invalid_status",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      watchdogStatusCommand({
        run: dir,
        unknown_option: "bad",
      }),
    ).toThrow(HarnessError);
  });

  test("watchdogCleanupCommand executes cleanup and returns report", () => {
    const dir = scratchRoot(import.meta.path, "cli-cleanup");

    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T18:00:00.000Z",
      watchdogs: [
        {
          id: "wd-stale-cli",
          generation: 1,
          pulse_id: null,
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 101,
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

    const result = watchdogCleanupCommand({
      run: dir,
      now: "2026-08-21T21:00:00.000Z",
    });

    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Watchdog Stale Cleanup Engine");
    expect(result.cleaned_count).toBe(1);
    expect(result.remaining_active).toBe(0);
  });

  test("watchdogCleanupCommand handles phase cleanup via --phase flag", () => {
    const dir = scratchRoot(import.meta.path, "cli-cleanup-phase");

    registerWatchdog({ id: "wd-p1", generation: 1, phase: "planning" }, dir);
    registerWatchdog({ id: "wd-p2", generation: 2, phase: "execution" }, dir);

    const result = watchdogCleanupCommand({
      run: dir,
      phase: "planning",
      generation: "1",
    });

    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Watchdog Phase Cleanup Engine");
    expect(result.cleaned_count).toBe(1);
    expect(result.remaining_active).toBe(1); // wd-p2 in gen 2 is still active
  });

  test("watchdogPhaseCleanupCommand executes phase termination", () => {
    const dir = scratchRoot(import.meta.path, "cli-phase-cleanup");

    registerWatchdog({ id: "wd-pc-1", generation: 1, phase: "analysis" }, dir);
    registerWatchdog({ id: "wd-pc-2", generation: 2, phase: "analysis" }, dir);

    const result = watchdogPhaseCleanupCommand({
      run: dir,
      phase: "analysis",
      generation: "1",
    });

    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Watchdog Automatic Phase Cleanup Engine");
    expect(result.terminated_count).toBe(1);
    expect(result.remaining_active).toBe(1);
  });

  test("watchdogPhaseCleanupCommand executes rollover cleanup with --current-phase", () => {
    const dir = scratchRoot(import.meta.path, "cli-rollover-cleanup");

    registerWatchdog({ id: "wd-prev-1", generation: 1, phase: "planning" }, dir);
    registerWatchdog({ id: "wd-curr-1", generation: 2, phase: "execution" }, dir);

    const result = watchdogPhaseCleanupCommand({
      run: dir,
      "current-phase": "execution",
    });

    expect(result.terminated_count).toBe(1);
    expect(result.remaining_active).toBe(1);
    const terminated = result.terminated_watchdogs as unknown as WatchdogRecord[];
    expect(terminated[0]?.id).toBe("wd-prev-1");
  });

  test("watchdogVerifyCommand audits lifecycle invariants and detects violations", () => {
    const dir = scratchRoot(import.meta.path, "cli-verify");

    // Seed multiple active in same gen to create a violation
    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T20:00:00.000Z",
      watchdogs: [
        {
          id: "wd-v1",
          generation: 1,
          pulse_id: "p1",
          phase: "exec",
          run_id: null,
          run_root: null,
          pid: 10,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
        {
          id: "wd-v2",
          generation: 1,
          pulse_id: "p2",
          phase: "exec",
          run_id: null,
          run_root: null,
          pid: 11,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(seedStore, dir);

    const result = watchdogVerifyCommand({
      run: dir,
      generation: "1",
      now: "2026-08-21T20:01:00.000Z",
    });

    expect(result.valid).toBe(false);
    expect((result.violations as unknown as string[]).length).toBeGreaterThan(0);
    expect(String(result.markdown)).toContain("FAILED ❌");
  });
});

describe("WatchdogManager - Phase Cleanup & Automatic Rollover", () => {
  test("terminatePhaseWatchdogs terminates monitors matching target phase", () => {
    const dir = scratchRoot(import.meta.path, "phase-clean-target");

    registerWatchdog({ id: "wd-plan-1", generation: 1, phase: "planning" }, dir);
    registerWatchdog({ id: "wd-exec-1", generation: 2, phase: "execution" }, dir);

    const result = terminatePhaseWatchdogs({ phase: "planning" }, dir);
    expect(result.terminatedCount).toBe(1);
    expect(result.terminatedWatchdogs[0]?.id).toBe("wd-plan-1");
    expect(result.terminatedWatchdogs[0]?.status).toBe("terminated");
    expect(result.terminatedWatchdogs[0]?.termination_reason).toBe("phase_completed_planning");
    expect(result.activeCount).toBe(1);

    const store = loadWatchdogStore(dir);
    const planWd = store.watchdogs.find((w) => w.id === "wd-plan-1");
    expect(planWd?.status).toBe("terminated");
  });

  test("terminatePhaseWatchdogs supports dry run without mutating store", () => {
    const dir = scratchRoot(import.meta.path, "phase-clean-dry");

    registerWatchdog({ id: "wd-dry-1", generation: 1, phase: "review" }, dir);

    const dryResult = terminatePhaseWatchdogs({ phase: "review", dryRun: true }, dir);
    expect(dryResult.terminatedCount).toBe(1);
    expect(dryResult.dryRun).toBe(true);

    const store = loadWatchdogStore(dir);
    expect(store.watchdogs.find((w) => w.id === "wd-dry-1")?.status).toBe("active");
  });

  test("terminatePhaseWatchdogs respects generation, pulse_id, and excludeId", () => {
    const dir = scratchRoot(import.meta.path, "phase-clean-filters");

    registerWatchdog({ id: "wd-g1-p1", generation: 1, pulse_id: "p1", phase: "task" }, dir);
    registerWatchdog({ id: "wd-g2-p2", generation: 2, pulse_id: "p2", phase: "task" }, dir);
    registerWatchdog({ id: "wd-g3-p3", generation: 3, pulse_id: "p3", phase: "task" }, dir);

    const result = terminatePhaseWatchdogs(
      {
        phase: "task",
        generation: 2,
        pulse_id: "p2",
        excludeId: "wd-nonexistent",
      },
      dir,
    );

    expect(result.terminatedCount).toBe(1);
    expect(result.terminatedWatchdogs[0]?.id).toBe("wd-g2-p2");
    expect(result.activeCount).toBe(2);
  });

  test("cleanupPreviousPhaseWatchdogs terminates legacy phase monitors on rollover", () => {
    const dir = scratchRoot(import.meta.path, "rollover-clean");

    registerWatchdog({ id: "wd-old-plan", generation: 1, phase: "planning" }, dir);
    registerWatchdog({ id: "wd-old-exec", generation: 1, phase: "execution" }, dir);
    registerWatchdog({ id: "wd-new-val", generation: 2, phase: "validation" }, dir);

    const result = cleanupPreviousPhaseWatchdogs(
      {
        currentPhase: "validation",
        generation: 1,
      },
      dir,
    );

    expect(result.terminatedCount).toBe(1); // in gen 1, wd-old-plan was superseded by wd-old-exec, so only wd-old-exec was active
    expect(result.terminatedWatchdogs[0]?.id).toBe("wd-old-exec");
    expect(result.terminatedWatchdogs[0]?.status).toBe("terminated");
    expect(result.activeCount).toBe(1); // wd-new-val in gen 2 is active
  });
});

describe("WatchdogManager - Lifecycle Invariant Verification", () => {
  test("verifyWatchdogLifecycle passes when invariants are satisfied", () => {
    const dir = scratchRoot(import.meta.path, "verify-pass");

    registerWatchdog({ id: "wd-ok-1", generation: 1, pulse_id: "p-1" }, dir);
    registerWatchdog({ id: "wd-ok-2", generation: 2, pulse_id: "p-2" }, dir);

    const result = verifyWatchdogLifecycle({}, dir);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.activeCount).toBe(2);
  });

  test("verifyWatchdogLifecycle detects multiple active monitors in same generation", () => {
    const dir = scratchRoot(import.meta.path, "verify-multi-active-gen");

    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T20:00:00.000Z",
      watchdogs: [
        {
          id: "wd-conflict-1",
          generation: 1,
          pulse_id: "p1",
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 1,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
        {
          id: "wd-conflict-2",
          generation: 1,
          pulse_id: "p2",
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 2,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(seedStore, dir);

    const result = verifyWatchdogLifecycle({}, dir);
    expect(result.valid).toBe(false);
    expect(
      result.violations.some((v) => v.includes("Multiple active watchdogs found in generation 1")),
    ).toBe(true);
    expect(result.violationDetails.some((d) => d.rule === "single_active_per_generation")).toBe(
      true,
    );
  });

  test("verifyWatchdogLifecycle detects multiple active monitors with same pulse_id", () => {
    const dir = scratchRoot(import.meta.path, "verify-multi-active-pulse");

    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T20:00:00.000Z",
      watchdogs: [
        {
          id: "wd-pulse-dup1",
          generation: 1,
          pulse_id: "shared-pulse-123",
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 1,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
        {
          id: "wd-pulse-dup2",
          generation: 2,
          pulse_id: "shared-pulse-123",
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 2,
          ppid: 1,
          agent_id: null,
          started_at: "2026-08-21T20:00:00.000Z",
          last_heartbeat_at: "2026-08-21T20:00:00.000Z",
          heartbeat_cadence_ms: 180_000,
          timeout_ms: 360_000,
          status: "active",
          terminated_at: null,
          termination_reason: null,
        },
      ],
    };
    saveWatchdogStore(seedStore, dir);

    const result = verifyWatchdogLifecycle({}, dir);
    expect(result.valid).toBe(false);
    expect(
      result.violations.some((v) =>
        v.includes("Multiple active watchdogs found for pulse 'shared-pulse-123'"),
      ),
    ).toBe(true);
    expect(result.violationDetails.some((d) => d.rule === "single_active_per_pulse")).toBe(true);
  });

  test("verifyWatchdogLifecycle detects overdue heartbeat timeout", () => {
    const dir = scratchRoot(import.meta.path, "verify-overdue-hb");

    const seedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at: "2026-08-21T18:00:00.000Z",
      watchdogs: [
        {
          id: "wd-overdue-1",
          generation: 1,
          pulse_id: null,
          phase: "loop",
          run_id: null,
          run_root: null,
          pid: 1,
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

    const result = verifyWatchdogLifecycle({ now: "2026-08-21T21:00:00.000Z" }, dir);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes("heartbeat is overdue"))).toBe(true);
    expect(result.violationDetails.some((d) => d.rule === "heartbeat_timeout_exceeded")).toBe(true);
  });
});

describe("Invariants & Cleanliness Audit", () => {
  test("zero TypeScript any and zero suppressions across watchdog files", () => {
    const sourceFiles = [
      join(__dirname, "../../../olt/scripts/src/authority/watchdog-manager.ts"),
      join(__dirname, "../../../olt/scripts/src/runner/watchdog.ts"),
      join(__dirname, "../../../olt/scripts/src/orchestrator/watchdog.ts"),
      join(__dirname, "../../../olt/scripts/src/cli/commands/watchdog-ops.ts"),
      __filename,
    ];

    const anyAnnotation = new RegExp(":\\s*any\\b");
    const anyCast = new RegExp("as\\s+any\\b");
    const anyGeneric = new RegExp("<\\s*any\\s*>");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");

      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });
});
