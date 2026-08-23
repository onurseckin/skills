import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import {
  formatMindPulseOpenBrief,
  mindPulseOpenCommand,
} from "../../../olt/scripts/src/cli/commands/mind-pulse-open.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  checkDailyBudget,
  checkQuietHours,
  parseNowMs,
  rollDayKeyIfNeeded,
} from "../../../olt/scripts/src/mind/budget.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { verifyIntegrity } from "../../../olt/scripts/src/engine/store/integrity.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";

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
  readonly charterPath: string;
  readonly charterSha: string;
}

function setupMindCapsule(
  name: string,
  overrides: {
    readonly charterContent?: string;
    readonly pulseOpen?: Record<string, unknown> | null;
    readonly pulseCounter?: number;
    readonly budget?: Record<string, unknown>;
    readonly halted?: boolean;
    readonly haltReason?: string;
    readonly eventSequence?: number;
    readonly registerMindAgent?: boolean;
  } = {},
): MindFixture {
  const repo = mkdtempSync(join(tmpdir(), `mind-pulse-open-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "docs", "mind");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const charterContent =
    overrides.charterContent ??
    `# CHARTER\n\n## identity\nTest application for pulse open\n\n## goals\n- G1: Ensure stability\n\n## non-goals\n- Out of scope\n\n## repo_roots\n- \`src/\`\n`;
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
          repo_roots: ["src/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
        ...(overrides.halted
          ? { halted: true, halt_reason: overrides.haltReason ?? "manual test halt" }
          : {}),
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
        pulses_today: 0,
        wall_clock_ms_today: 0,
        ...overrides.budget,
      };

      working.pulse = {
        counter: overrides.pulseCounter ?? 0,
        open: overrides.pulseOpen !== undefined ? overrides.pulseOpen : null,
        last: null,
      };

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

  if (overrides.registerMindAgent !== false) {
    agentRegisterCommand({
      run,
      agent: "mind-1",
      role: "mind",
      host: "antigravity",
    });
  }

  return { repo, run, charterPath, charterSha };
}

describe("mindPulseOpenCommand", () => {
  test("successfully opens a pulse for registered mind agent and transacts state mutation", () => {
    const { run } = setupMindCapsule("happy-path");
    const nowIso = "2026-08-21T05:00:00.000Z";

    const result = mindPulseOpenCommand({
      run,
      actor: "mind-1",
      host: "antigravity",
      driver: "pulse.sh",
      now: nowIso,
    });

    expect(result.pulse_id).toBe("pulse-1");
    expect(result.actor).toBe("mind-1");
    expect(result.host).toBe("antigravity");
    expect(result.driver).toBe("pulse.sh");
    expect(result.opened_at).toBe(nowIso);
    expect(result.deadline_at).toBe("2026-08-21T05:20:00.000Z"); // +1200000ms

    const loaded = loadRun(run, false);
    const pulseState = loaded.state.pulse as Record<string, unknown>;
    expect(pulseState.counter).toBe(1);

    const open = pulseState.open as Record<string, unknown>;
    expect(open).not.toBeNull();
    expect(open.pulse_id).toBe("pulse-1");
    expect(open.opened_at).toBe(nowIso);
    expect(open.deadline_at).toBe("2026-08-21T05:20:00.000Z");
    expect(open.actor).toBe("mind-1");
    expect(open.host).toBe("antigravity");
    expect(open.driver).toBe("pulse.sh");

    const budgetState = loaded.state.budget as Record<string, unknown>;
    expect(budgetState.pulses_today).toBe(1);

    const integrity = verifyIntegrity(run);
    expect(integrity.length).toBe(0);
  });

  test("computes custom deadline when budget.pulse_deadline_ms is customized", () => {
    const { run } = setupMindCapsule("custom-deadline", {
      budget: { pulse_deadline_ms: 600_000 }, // 10 minutes
    });
    const nowIso = "2026-08-21T06:00:00.000Z";

    const result = mindPulseOpenCommand({
      run,
      actor: "mind-1",
      host: "antigravity",
      driver: "bash-loop",
      now: nowIso,
    });

    expect(result.pulse_id).toBe("pulse-1");
    expect(result.opened_at).toBe(nowIso);
    expect(result.deadline_at).toBe("2026-08-21T06:10:00.000Z");
  });

  test("increments pulse counter from existing counter", () => {
    const { run } = setupMindCapsule("counter-inc", {
      pulseCounter: 5,
    });

    const result = mindPulseOpenCommand({
      run,
      actor: "mind-1",
      host: "antigravity",
      driver: "pulse.sh",
      now: "2026-08-21T07:00:00.000Z",
    });

    expect(result.pulse_id).toBe("pulse-6");
    const loaded = loadRun(run, false);
    const pulseState = loaded.state.pulse as Record<string, unknown>;
    expect(pulseState.counter).toBe(6);
  });

  test("refuses unregistered acting agent and leaves event sequence unchanged", () => {
    const { run } = setupMindCapsule("unregistered-actor", { registerMindAgent: false });
    const loadedBefore = loadRun(run, false);
    const seqBefore = loadedBefore.state.event_sequence;

    expect(() => {
      mindPulseOpenCommand({
        run,
        actor: "unregistered-mind",
        host: "antigravity",
        driver: "pulse.sh",
      });
    }).toThrow(HarnessError);

    try {
      mindPulseOpenCommand({
        run,
        actor: "unregistered-mind",
        host: "antigravity",
        driver: "pulse.sh",
      });
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("agent unregistered-mind holds no grant");
    }

    const loadedAfter = loadRun(run, false);
    expect(loadedAfter.state.event_sequence).toBe(seqBefore);
  });

  test("refuses acting agent whose role is not mind and leaves event sequence unchanged", () => {
    const { run } = setupMindCapsule("non-mind-role", { registerMindAgent: false });
    agentRegisterCommand({
      run,
      agent: "impl-1",
      role: "implementer",
      host: "antigravity",
    });

    const seqBefore = loadRun(run, false).state.event_sequence;

    try {
      mindPulseOpenCommand({
        run,
        actor: "impl-1",
        host: "antigravity",
        driver: "pulse.sh",
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("holds role 'implementer'");
      expect(harnessErr.message).toContain("role 'mind' is required");
    }

    expect(loadRun(run, false).state.event_sequence).toBe(seqBefore);
  });

  test("refuses when a pulse is already open and not past deadline", () => {
    const { run } = setupMindCapsule("double-open-active", {
      pulseOpen: {
        pulse_id: "pulse-1",
        opened_at: "2026-08-21T05:00:00.000Z",
        deadline_at: "2026-08-21T05:20:00.000Z",
        actor: "mind-1",
        host: "antigravity",
        driver: "pulse.sh",
      },
    });

    const seqBefore = loadRun(run, false).state.event_sequence;

    try {
      mindPulseOpenCommand({
        run,
        actor: "mind-1",
        host: "antigravity",
        driver: "pulse.sh",
        now: "2026-08-21T05:10:00.000Z", // inside deadline
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("pulse pulse-1 is already open");
    }

    expect(loadRun(run, false).state.event_sequence).toBe(seqBefore);
  });

  test("refuses when a pulse is already open and past its deadline, pointing to mind:wake", () => {
    const { run } = setupMindCapsule("double-open-expired", {
      pulseOpen: {
        pulse_id: "pulse-1",
        opened_at: "2026-08-21T05:00:00.000Z",
        deadline_at: "2026-08-21T05:20:00.000Z",
        actor: "mind-1",
        host: "antigravity",
        driver: "pulse.sh",
      },
    });

    const seqBefore = loadRun(run, false).state.event_sequence;

    try {
      mindPulseOpenCommand({
        run,
        actor: "mind-1",
        host: "antigravity",
        driver: "pulse.sh",
        now: "2026-08-21T05:30:00.000Z", // past deadline
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("past its deadline");
      expect(harnessErr.message).toContain("mind:wake");
    }

    expect(loadRun(run, false).state.event_sequence).toBe(seqBefore);
  });

  test("refuses when mind is halted", () => {
    const { run } = setupMindCapsule("mind-halted", {
      halted: true,
      haltReason: "safety check violation",
    });

    const seqBefore = loadRun(run, false).state.event_sequence;

    try {
      mindPulseOpenCommand({
        run,
        actor: "mind-1",
        host: "antigravity",
        driver: "pulse.sh",
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("mind is halted (safety check violation)");
      expect(harnessErr.message).toContain("Outcome: halted");
    }

    expect(loadRun(run, false).state.event_sequence).toBe(seqBefore);
  });

  test("refuses when charter file is missing", () => {
    const { run, charterPath } = setupMindCapsule("missing-charter");
    rmSync(charterPath);

    const seqBefore = loadRun(run, false).state.event_sequence;

    try {
      mindPulseOpenCommand({
        run,
        actor: "mind-1",
        host: "antigravity",
        driver: "pulse.sh",
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("missing");
      expect(harnessErr.message).toContain("Outcome: halted");
    }

    expect(loadRun(run, false).state.event_sequence).toBe(seqBefore);
  });

  test("refuses when charter file sha256 drifts from pinned digest", () => {
    const { run, charterPath } = setupMindCapsule("drifted-charter");
    writeFileSync(charterPath, "# Modified Charter\n\n## identity\nTampered\n", "utf-8");

    const seqBefore = loadRun(run, false).state.event_sequence;

    try {
      mindPulseOpenCommand({
        run,
        actor: "mind-1",
        host: "antigravity",
        driver: "pulse.sh",
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("charter sha256 mismatch");
      expect(harnessErr.message).toContain("Outcome: halted");
    }

    expect(loadRun(run, false).state.event_sequence).toBe(seqBefore);
  });

  test("refuses when event sequence reaches 100,000 headroom ceiling", () => {
    const { run } = setupMindCapsule("event-headroom");
    const statePath = join(run, "state.json");
    const stateRaw = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
    stateRaw.event_sequence = 100_000;
    writeFileSync(statePath, JSON.stringify(stateRaw), "utf-8");

    const seqBefore = loadRun(run, false).state.event_sequence;

    try {
      mindPulseOpenCommand({
        run,
        actor: "mind-1",
        host: "antigravity",
        driver: "pulse.sh",
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("event headroom threshold reached");
      expect(harnessErr.message).toContain("Outcome: halted");
    }

    expect(loadRun(run, false).state.event_sequence).toBe(seqBefore);
  });

  test("refuses when daily pulses_today reaches pulses_per_day limit", () => {
    const { run } = setupMindCapsule("pulse-cap", {
      budget: {
        pulses_today: 96,
        pulses_per_day: 96,
        day_key: "2026-08-21",
      },
    });

    const seqBefore = loadRun(run, false).state.event_sequence;

    try {
      mindPulseOpenCommand({
        run,
        actor: "mind-1",
        host: "antigravity",
        driver: "pulse.sh",
        now: "2026-08-21T12:00:00.000Z",
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("daily pulse budget exhausted (96/96 pulses)");
      expect(harnessErr.message).toContain("Outcome: deferred");
      expect(harnessErr.message).toContain("mind:wake");
    }

    expect(loadRun(run, false).state.event_sequence).toBe(seqBefore);
  });

  test("refuses when daily wall_clock_ms_today reaches wall_clock_ms_per_day limit", () => {
    const { run } = setupMindCapsule("wall-clock-cap", {
      budget: {
        wall_clock_ms_today: 21_600_000,
        wall_clock_ms_per_day: 21_600_000,
        day_key: "2026-08-21",
      },
    });

    const seqBefore = loadRun(run, false).state.event_sequence;

    try {
      mindPulseOpenCommand({
        run,
        actor: "mind-1",
        host: "antigravity",
        driver: "pulse.sh",
        now: "2026-08-21T14:00:00.000Z",
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("daily wall clock budget exhausted");
      expect(harnessErr.message).toContain("Outcome: deferred");
    }

    expect(loadRun(run, false).state.event_sequence).toBe(seqBefore);
  });

  test("refuses when current time is inside quiet hours", () => {
    const { run } = setupMindCapsule("quiet-hours-inside", {
      budget: {
        quiet_hours: "23:00-05:00",
        day_key: "2026-08-21",
      },
    });

    const seqBefore = loadRun(run, false).state.event_sequence;

    try {
      mindPulseOpenCommand({
        run,
        actor: "mind-1",
        host: "antigravity",
        driver: "pulse.sh",
        now: "2026-08-21T03:30:00.000Z", // in 23:00-05:00
      });
      expect(true).toBe(false);
    } catch (err) {
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain("inside quiet hours (23:00-05:00)");
      expect(harnessErr.message).toContain("Outcome: deferred");
    }

    expect(loadRun(run, false).state.event_sequence).toBe(seqBefore);
  });

  test("succeeds when current time is outside quiet hours", () => {
    const { run } = setupMindCapsule("quiet-hours-outside", {
      budget: {
        quiet_hours: "23:00-05:00",
        day_key: "2026-08-21",
      },
    });

    const result = mindPulseOpenCommand({
      run,
      actor: "mind-1",
      host: "antigravity",
      driver: "pulse.sh",
      now: "2026-08-21T10:00:00.000Z", // outside quiet hours
    });

    expect(result.pulse_id).toBe("pulse-1");
  });

  test("rolls day_key and resets daily counters before count check on new day", () => {
    const { run } = setupMindCapsule("day-rollover", {
      budget: {
        day_key: "2026-08-20", // yesterday
        pulses_today: 96, // was exhausted yesterday
        wall_clock_ms_today: 21_600_000,
        pulses_per_day: 96,
        wall_clock_ms_per_day: 21_600_000,
      },
    });

    // Opening on 2026-08-21 should roll day_key and reset pulses_today to 0 -> 1
    const result = mindPulseOpenCommand({
      run,
      actor: "mind-1",
      host: "antigravity",
      driver: "pulse.sh",
      now: "2026-08-21T08:00:00.000Z",
    });

    expect(result.pulse_id).toBe("pulse-1");
    const loaded = loadRun(run, false);
    const budget = loaded.state.budget as Record<string, unknown>;
    expect(budget.day_key).toBe("2026-08-21");
    expect(budget.pulses_today).toBe(1);
    expect(budget.wall_clock_ms_today).toBe(0);
  });

  test("formatMindPulseOpenBrief renders clean markdown adhering to line limits", () => {
    const md = formatMindPulseOpenBrief({
      pulseId: "pulse-1",
      runRoot: ".olt/capsules/mind-gen-1",
      actor: "mind-1",
      host: "antigravity",
      driver: "pulse.sh",
      openedAt: "2026-08-21T05:00:00.000Z",
      deadlineAt: "2026-08-21T05:20:00.000Z",
      pulsesToday: 1,
      pulsesPerDay: 96,
    });

    expect(md).toContain("### Mind Pulse Opened: pulse-1");
    expect(md).toContain("- **Capsule Root**: `.capsules/mind-gen-1`");
    expect(md).toContain("- **Actor**: `mind-1`");
    expect(md.split("\n").length).toBeLessThanOrEqual(30);
  });
});

describe("budget helpers", () => {
  test("parseNowMs parses numbers, Dates, and ISO strings", () => {
    const epoch = 1755752400000;
    expect(parseNowMs(epoch)).toBe(epoch);
    expect(parseNowMs(new Date(epoch))).toBe(epoch);
    expect(parseNowMs(new Date(epoch).toISOString())).toBe(epoch);
    expect(Number.isFinite(parseNowMs())).toBe(true);
  });

  test("rollDayKeyIfNeeded rolls day when keys differ and leaves unchanged when same", () => {
    const budget = {
      day_key: "2026-08-20",
      pulses_today: 10,
      wall_clock_ms_today: 5000,
    };

    const roll1 = rollDayKeyIfNeeded(budget, "2026-08-21T00:00:00Z");
    expect(roll1.rolled).toBe(true);
    expect(roll1.dayKey).toBe("2026-08-21");
    expect(budget.day_key).toBe("2026-08-21");
    expect(budget.pulses_today).toBe(0);
    expect(budget.wall_clock_ms_today).toBe(0);

    const roll2 = rollDayKeyIfNeeded(budget, "2026-08-21T12:00:00Z");
    expect(roll2.rolled).toBe(false);
    expect(roll2.dayKey).toBe("2026-08-21");
  });

  test("checkQuietHours handles null, empty, same-day, and cross-midnight windows", () => {
    expect(checkQuietHours(null).inQuietHours).toBe(false);
    expect(checkQuietHours("").inQuietHours).toBe(false);
    expect(checkQuietHours("none").inQuietHours).toBe(false);
    expect(checkQuietHours("invalid-format").inQuietHours).toBe(false);

    // Daytime window: 09:00 to 17:00
    expect(checkQuietHours("09:00-17:00", "2026-08-21T10:00:00Z").inQuietHours).toBe(true);
    expect(checkQuietHours("09:00-17:00", "2026-08-21T08:00:00Z").inQuietHours).toBe(false);
    expect(checkQuietHours("09:00-17:00", "2026-08-21T18:00:00Z").inQuietHours).toBe(false);

    // Cross-midnight window: 23:00 to 05:00
    expect(checkQuietHours("23:00-05:00", "2026-08-21T23:30:00Z").inQuietHours).toBe(true);
    expect(checkQuietHours("23:00-05:00", "2026-08-21T02:00:00Z").inQuietHours).toBe(true);
    expect(checkQuietHours("23:00-05:00", "2026-08-21T05:00:00Z").inQuietHours).toBe(true);
    expect(checkQuietHours("23:00-05:00", "2026-08-21T06:00:00Z").inQuietHours).toBe(false);
    expect(checkQuietHours("23:00-05:00", "2026-08-21T22:00:00Z").inQuietHours).toBe(false);
  });

  test("checkDailyBudget validates all constraints", () => {
    const validBudget = {
      day_key: "2026-08-21",
      pulses_today: 10,
      pulses_per_day: 96,
      wall_clock_ms_today: 1000,
      wall_clock_ms_per_day: 21600000,
      quiet_hours: null,
    };

    expect(checkDailyBudget(validBudget, "2026-08-21T10:00:00Z").ok).toBe(true);

    const quietBudget = { ...validBudget, quiet_hours: "22:00-06:00" };
    const quietRes = checkDailyBudget(quietBudget, "2026-08-21T23:00:00Z");
    expect(quietRes.ok).toBe(false);
    expect(quietRes.outcome).toBe("deferred");

    const pulseCapBudget = { ...validBudget, pulses_today: 96, pulses_per_day: 96 };
    const pulseRes = checkDailyBudget(pulseCapBudget, "2026-08-21T10:00:00Z");
    expect(pulseRes.ok).toBe(false);
    expect(pulseRes.outcome).toBe("deferred");

    const wallCapBudget = {
      ...validBudget,
      wall_clock_ms_today: 21600000,
      wall_clock_ms_per_day: 21600000,
    };
    const wallRes = checkDailyBudget(wallCapBudget, "2026-08-21T10:00:00Z");
    expect(wallRes.ok).toBe(false);
    expect(wallRes.outcome).toBe("deferred");
  });
});
