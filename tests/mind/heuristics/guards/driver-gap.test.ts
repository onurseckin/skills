import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import * as storeModule from "../../../../olt/scripts/src/engine/store/index.ts";
import * as durableWriteModule from "../../../../olt/scripts/src/core/durable-write.ts";
import * as lastPulseModule from "../../../../olt/scripts/src/mind/lifecycle/pulse/last-pulse.ts";
import {
  buildWakeBrief,
  renderGapLine,
} from "../../../../olt/scripts/src/mind/proposals/brief/index.ts";
import {
  readLastPulse,
  reconcileLastPulse,
  writeLastPulse,
  type LastPulseRecord,
} from "../../../../olt/scripts/src/mind/lifecycle/index.ts";
import type { RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";

const mockRuns = new Map<string, RunState>();
const mockFiles = new Map<string, string>();
const spies: { mockRestore: () => void }[] = [];

function createMockRun(name: string, pulseLast: Record<string, unknown> | null = null): string {
  const runPath = `${process.cwd()}/.olt/capsules/mind-gen-${name}`;
  const charterSha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const state: RunState = {
    version: "2.0.0",
    run_id: `mind-gen-${name}`,
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
    status: "succeeded",
    tasks: {},
    agents: [],
    mind: {
      generation: 1,
      opened_at: "2026-08-21T00:00:00.000Z",
      actor: "mind-1",
      charter: {
        source_path: "olt/agents/mind.yaml",
        pinned_sha256: charterSha,
        goals: ["G1"],
        repo_roots: ["olt/"],
        evidence_class: "harness_observed",
      },
    },
    budget: {
      pulses_per_day: 96,
      wall_clock_ms_per_day: 21_600_000,
      max_agents_in_flight: 8,
      max_rounds_per_objective: 3,
      base_interval_ms: 900_000,
      max_interval_ms: 14_400_000,
      max_pause_interval_ms: 1_800_000,
      pulse_deadline_ms: 1_200_000,
      max_open_proposals: 5,
      quiet_hours: null,
      day_key: "2026-08-21",
      pulses_today: 1,
      wall_clock_ms_today: 60_000,
    },
    pulse: { counter: 2, open: null, last: pulseLast } as unknown as RunState["pulse"],
    observations: [],
    candidates: [],
    escalations: [],
    audit: {
      last_started_at: "2026-08-21T00:00:00.000Z",
      last_verdict: "approved",
      open_findings: [],
    },
  };
  mockRuns.set(runPath, state);
  return runPath;
}

beforeEach(() => {
  mockRuns.clear();
  mockFiles.clear();
  spies.push(
    spyOn(storeModule, "loadRun").mockImplementation((runPath: string) => {
      const state = mockRuns.get(runPath) ?? {
        version: "2.0.0",
        run_id: "test",
        created_at: "2026-08-21T00:00:00.000Z",
        updated_at: "2026-08-21T00:00:00.000Z",
        status: "succeeded",
        tasks: {},
        agents: [],
      };
      return {
        runRoot: runPath,
        manifest: {
          version: "2.0.0",
          run_id: "test",
          created_at: "2026-08-21T00:00:00.000Z",
          entry_task_id: "task-1",
        },
        state,
        events: [],
        prompt: new Uint8Array(),
        mode: "file",
        sourceVerified: true,
      };
    }),
    spyOn(durableWriteModule, "atomicWriteJson").mockImplementation((fp: string, data: unknown) => {
      mockFiles.set(fp, JSON.stringify(data));
    }),
    spyOn(lastPulseModule, "readLastPulse").mockImplementation((capsuleRoot: string) => {
      const raw = mockFiles.get(`${capsuleRoot}/last_pulse.json`);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed !== "object" || parsed === null) return null;
        return {
          at: typeof parsed.at === "string" ? parsed.at : "2026-08-21T00:00:00.000Z",
          pulse_id: typeof parsed.pulse_id === "string" ? parsed.pulse_id : null,
          outcome: typeof parsed.outcome === "string" ? parsed.outcome : null,
          next_wake_at: typeof parsed.next_wake_at === "string" ? parsed.next_wake_at : null,
        };
      } catch {
        return null;
      }
    }),
    spyOn(lastPulseModule, "writeLastPulse").mockImplementation(
      (capsuleRoot: string, record: LastPulseRecord) => {
        mockFiles.set(`${capsuleRoot}/last_pulse.json`, JSON.stringify(record));
      },
    ),
  );
});

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore();
});

describe("GAP Calculation and renderGapLine", () => {
  test("renders unknown when parameters are null or undefined", () => {
    expect(renderGapLine(null, null, null)).toBe("unknown");
    expect(renderGapLine(900_000, null, 0)).toBe("unknown");
    expect(renderGapLine(null, 900_000, 0)).toBe("unknown");
    expect(renderGapLine(900_000, 900_000, null)).toBe("unknown");
  });

  test("renders driver on time when lateness is within 60 seconds", () => {
    expect(renderGapLine(900_000, 900_000, 0)).toBe("15m (armed 15m; driver on time)");
    expect(renderGapLine(930_000, 900_000, 30_000)).toBe("15m (armed 15m; driver on time)");
    expect(renderGapLine(870_000, 900_000, -30_000)).toBe("14m (armed 15m; driver on time)");
  });

  test("renders driver early when driver wakes ahead of schedule by > 60s", () => {
    expect(renderGapLine(600_000, 900_000, -300_000)).toBe("10m (armed 15m; driver early by 5m)");
  });

  test("renders driver late when lateness is > 60s and <= 3x armed interval", () => {
    expect(renderGapLine(1_020_000, 900_000, 120_000)).toBe("17m (armed 15m; driver late by 2m)");
    expect(renderGapLine(2_700_000, 900_000, 1_800_000)).toBe(
      "45m (armed 15m; driver late by 30m)",
    );
  });

  test("surfaces warning when GAP > 3x armed interval", () => {
    const gap46m = 46 * 60_000;
    const armed15m = 15 * 60_000;
    const late31m = 31 * 60_000;
    expect(renderGapLine(gap46m, armed15m, late31m)).toBe(
      "46m (armed 15m; driver late by 31m [WARNING: > 3x armed interval])",
    );
    const gap2h = 2 * 3600_000;
    const late1h45m = gap2h - armed15m;
    expect(renderGapLine(gap2h, armed15m, late1h45m)).toBe(
      "2h (armed 15m; driver late by 1h45m [WARNING: > 3x armed interval])",
    );
  });
});

describe("buildWakeBrief GAP line and 3x Thresholds", () => {
  test("renders unknown when no previous pulse exists", async () => {
    const run = createMockRun("no-last-pulse", null);
    const brief = await buildWakeBrief(run, { now: "2026-08-21T04:00:00.000Z" });
    expect(brief.markdown).toContain("GAP       unknown");
    expect(brief.facts.gapMs).toBeNull();
    expect(brief.facts.armedIntervalMs).toBeNull();
    expect(brief.facts.driverLatenessMs).toBeNull();
    expect(brief.facts.driverLateWarning).toBe(false);
  });

  test("calculates normal GAP and driver lateness", async () => {
    const closedAt = "2026-08-21T04:00:00.000Z";
    const now = "2026-08-21T04:17:00.000Z";
    const run = createMockRun("normal-gap", {
      pulse_id: "pulse-1",
      closed_at: closedAt,
      outcome: "quiescent",
      armed_interval_ms: 15 * 60_000,
    });
    const brief = await buildWakeBrief(run, { now });
    expect(brief.markdown).toContain("GAP       17m (armed 15m; driver late by 2m)");
    expect(brief.facts.gapMs).toBe(17 * 60_000);
    expect(brief.facts.armedIntervalMs).toBe(15 * 60_000);
    expect(brief.facts.driverLatenessMs).toBe(2 * 60_000);
    expect(brief.facts.driverLateWarning).toBe(false);
  });

  test("surfaces warning in brief facts and markdown when gap exceeds 3x armed interval", async () => {
    const closedAt = "2026-08-21T04:00:00.000Z";
    const now = "2026-08-21T04:50:00.000Z";
    const run = createMockRun("late-warning", {
      pulse_id: "pulse-1",
      closed_at: closedAt,
      outcome: "quiescent",
      armed_interval_ms: 15 * 60_000,
    });
    const brief = await buildWakeBrief(run, { now });
    expect(brief.markdown).toContain(
      "GAP       50m (armed 15m; driver late by 35m [WARNING: > 3x armed interval])",
    );
    expect(brief.facts.gapMs).toBe(50 * 60_000);
    expect(brief.facts.driverLateWarning).toBe(true);
  });
});

describe("last_pulse.json Persistence and Reconciliation", () => {
  test("writeLastPulse and readLastPulse persist and retrieve records accurately", () => {
    const run = createMockRun("rw-test", null);
    const record: LastPulseRecord = {
      at: "2026-08-21T04:00:00.000Z",
      pulse_id: "pulse-1",
      outcome: "quiescent",
      next_wake_at: "2026-08-21T04:15:00.000Z",
    };
    writeLastPulse(run, record);
    expect(readLastPulse(run)).toEqual(record);
  });

  test("readLastPulse returns null for missing or invalid files", () => {
    const tempDir = "/virtual/capsules/empty-capsule";
    expect(readLastPulse(tempDir)).toBeNull();
    mockFiles.set(`${tempDir}/last_pulse.json`, "invalid json content");
    expect(readLastPulse(tempDir)).toBeNull();
  });

  test("reconcileLastPulse returns reconciled false when disk matches state", () => {
    const closedAt = "2026-08-21T04:00:00.000Z";
    const nextWakeAt = "2026-08-21T04:15:00.000Z";
    const run = createMockRun("match-test", {
      pulse_id: "pulse-5",
      closed_at: closedAt,
      outcome: "advanced",
      next_wake_at: nextWakeAt,
    });
    writeLastPulse(run, {
      at: closedAt,
      pulse_id: "pulse-5",
      outcome: "advanced",
      next_wake_at: nextWakeAt,
    });
    const state = mockRuns.get(run)!;
    const result = reconcileLastPulse(run, state);
    expect(result.reconciled).toBe(false);
    expect(result.record.pulse_id).toBe("pulse-5");
  });

  test("reconcileLastPulse rewrites disk file when chain and disk disagree", () => {
    const closedAt = "2026-08-21T04:00:00.000Z";
    const nextWakeAt = "2026-08-21T04:15:00.000Z";
    const run = createMockRun("reconcile-rewrite", {
      pulse_id: "pulse-truth",
      closed_at: closedAt,
      outcome: "rescued",
      next_wake_at: nextWakeAt,
    });
    writeLastPulse(run, {
      at: "2026-08-21T03:00:00.000Z",
      pulse_id: "pulse-stale",
      outcome: "quiescent",
      next_wake_at: null,
    });
    const state = mockRuns.get(run)!;
    const result = reconcileLastPulse(run, state);
    expect(result.reconciled).toBe(true);
    expect(result.record.pulse_id).toBe("pulse-truth");
    expect(result.record.outcome).toBe("rescued");
    expect(result.record.at).toBe(closedAt);

    const onDisk = readLastPulse(run);
    expect(onDisk?.pulse_id).toBe("pulse-truth");
    expect(onDisk?.outcome).toBe("rescued");
    expect(onDisk?.at).toBe(closedAt);
  });
});
