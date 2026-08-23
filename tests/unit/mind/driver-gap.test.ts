import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWakeBrief, renderGapLine } from "../../../olt/scripts/src/mind/brief.ts";
import {
  readLastPulse,
  reconcileLastPulse,
  writeLastPulse,
  type LastPulseRecord,
} from "../../../olt/scripts/src/mind/last-pulse.ts";
import { initRun } from "../../../olt/scripts/src/store/capsule.ts";
import { loadRun } from "../../../olt/scripts/src/store/load.ts";
import { transact } from "../../../olt/scripts/src/store/transaction.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  roots.length = 0;
});

interface MindFixture {
  readonly repo: string;
  readonly run: string;
}

function setupMindCapsule(
  name: string,
  pulseLast: Record<string, unknown> | null = null,
): MindFixture {
  const repo = mkdtempSync(join(tmpdir(), `driver-gap-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "docs", "mind");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const charterContent =
    "# CHARTER\n\n## identity\nTest\n\n## goals\n- G1: Stability\n\n## non-goals\n- None\n\n## repo_roots\n- `src/`\n";
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `mind-gen-${name}`, charterBytes, "file", true);

  transact(
    run,
    "mind-init",
    "mind-initialized",
    {
      generation: 1,
      charter_source_path: "docs/mind/CHARTER.md",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "docs/mind/CHARTER.md",
          pinned_sha256: charterSha,
          goals: ["G1"],
          repo_roots: ["docs/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
      };
      working.budget = {
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
      };
      working.pulse = {
        counter: 2,
        open: null,
        last: pulseLast,
      } as unknown as import("../../../olt/scripts/src/contracts/json.ts").JsonValue;
      working.observations = [];
      working.candidates = [];
      working.escalations = [];
      working.audit = {
        last_started_at: new Date().toISOString(),
        last_verdict: "approved",
        open_findings: [],
      };
    },
  );

  return { repo, run };
}

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
    // 3 * 15m = 45m. 46m is > 3x armed.
    const gap46m = 46 * 60_000;
    const armed15m = 15 * 60_000;
    const late31m = 31 * 60_000;
    expect(renderGapLine(gap46m, armed15m, late31m)).toBe(
      "46m (armed 15m; driver late by 31m [WARNING: > 3x armed interval])",
    );

    // 2 hours gap on 15m armed
    const gap2h = 2 * 3600_000;
    const late1h45m = gap2h - armed15m;
    expect(renderGapLine(gap2h, armed15m, late1h45m)).toBe(
      "2h (armed 15m; driver late by 1h45m [WARNING: > 3x armed interval])",
    );
  });
});

describe("buildWakeBrief GAP line and 3x Thresholds", () => {
  test("renders unknown when no previous pulse exists", async () => {
    const { run } = setupMindCapsule("no-last-pulse", null);
    const brief = await buildWakeBrief(run, { now: "2026-08-21T04:00:00.000Z" });

    expect(brief.markdown).toContain("GAP       unknown");
    expect(brief.facts.gapMs).toBeNull();
    expect(brief.facts.armedIntervalMs).toBeNull();
    expect(brief.facts.driverLatenessMs).toBeNull();
    expect(brief.facts.driverLateWarning).toBe(false);
  });

  test("calculates normal GAP and driver lateness", async () => {
    const closedAt = "2026-08-21T04:00:00.000Z";
    const now = "2026-08-21T04:17:00.000Z"; // 17m later

    const { run } = setupMindCapsule("normal-gap", {
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
    const now = "2026-08-21T04:50:00.000Z"; // 50m later (> 3 * 15m)

    const { run } = setupMindCapsule("late-warning", {
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
    const { run } = setupMindCapsule("rw-test", null);
    const record: LastPulseRecord = {
      at: "2026-08-21T04:00:00.000Z",
      pulse_id: "pulse-1",
      outcome: "quiescent",
      next_wake_at: "2026-08-21T04:15:00.000Z",
    };

    writeLastPulse(run, record);
    const loaded = readLastPulse(run);
    expect(loaded).toEqual(record);
  });

  test("readLastPulse returns null for missing or invalid files", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "empty-capsule-"));
    roots.push(tempDir);

    expect(readLastPulse(tempDir)).toBeNull();

    writeFileSync(join(tempDir, "last_pulse.json"), "invalid json content", "utf-8");
    expect(readLastPulse(tempDir)).toBeNull();
  });

  test("reconcileLastPulse returns reconciled false when disk matches state", () => {
    const closedAt = "2026-08-21T04:00:00.000Z";
    const nextWakeAt = "2026-08-21T04:15:00.000Z";
    const { run } = setupMindCapsule("match-test", {
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

    const loaded = loadRun(run, false);
    const result = reconcileLastPulse(run, loaded.state);
    expect(result.reconciled).toBe(false);
    expect(result.record.pulse_id).toBe("pulse-5");
  });

  test("reconcileLastPulse rewrites disk file when chain and disk disagree", () => {
    const closedAt = "2026-08-21T04:00:00.000Z";
    const nextWakeAt = "2026-08-21T04:15:00.000Z";
    const { run } = setupMindCapsule("reconcile-rewrite", {
      pulse_id: "pulse-truth",
      closed_at: closedAt,
      outcome: "rescued",
      next_wake_at: nextWakeAt,
    });

    // Write conflicting file on disk
    writeLastPulse(run, {
      at: "2026-08-21T03:00:00.000Z",
      pulse_id: "pulse-stale",
      outcome: "quiescent",
      next_wake_at: null,
    });

    const loaded = loadRun(run, false);
    const result = reconcileLastPulse(run, loaded.state);
    expect(result.reconciled).toBe(true);
    expect(result.record.pulse_id).toBe("pulse-truth");
    expect(result.record.outcome).toBe("rescued");
    expect(result.record.at).toBe(closedAt);

    // Verify disk was rewritten
    const onDisk = readLastPulse(run);
    expect(onDisk?.pulse_id).toBe("pulse-truth");
    expect(onDisk?.outcome).toBe("rescued");
    expect(onDisk?.at).toBe(closedAt);
  });
});
