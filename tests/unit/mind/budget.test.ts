import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import { mindPulseOpenCommand } from "../../../olt/scripts/src/cli/commands/mind-pulse-open.ts";
import { mindRoundOpenCommand } from "../../../olt/scripts/src/cli/commands/mind-round.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  checkDailyPulseLimit,
  checkDailyWallClockLimit,
  checkMaxAgentsInFlight,
  checkMaxOpenProposals,
  checkQuietHours,
  checkQuietHoursBudget,
  checkRoundBudget,
  computeTopologicalConcurrency,
  countActiveAgentsInFlight,
  evaluateBudgetRefusalLadder,
  parseNowMs,
  rollDayKeyIfNeeded,
  type BudgetOutcome,
} from "../../../olt/scripts/src/mind/budget.ts";
import { DEFAULT_MIND_BUDGET, parseCharter } from "../../../olt/scripts/src/mind/charter.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
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
    readonly candidates?: readonly Record<string, unknown>[];
    readonly registerMindAgent?: boolean;
  } = {},
): MindFixture {
  const repo = mkdtempSync(join(tmpdir(), `mind-budget-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent =
    overrides.charterContent ??
    `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test application for budget ladder"\n  goals:\n    - id: "G1"\n      statement: "Ensure stability"\n  non_goals:\n    - "Out of scope"\n  repo_roots:\n    - "src/"\n`;
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
      charter_source_path: "olt/agents/mind.yaml",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "olt/agents/mind.yaml",
          pinned_sha256: charterSha,
          goals: ["G1"],
          repo_roots: ["src/"],
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
        pulses_today: 0,
        wall_clock_ms_today: 0,
        ...(overrides.budget ?? {}),
      };

      working.pulse = {
        counter: overrides.pulseCounter ?? 0,
        open: overrides.pulseOpen !== undefined ? overrides.pulseOpen : null,
      };

      if (overrides.candidates) {
        working.candidates = overrides.candidates;
      }
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

describe("mind/budget - strict refusal ladder and outcomes per CONTRACTS §1.3 and PHASE-5 §3.4", () => {
  describe("daily_pulse_limit refusal and outcome typing", () => {
    test("refuses with outcome 'deferred' when pulse count reaches daily limit", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        pulses_today: 96,
        pulses_per_day: 96,
      };

      const res = checkDailyPulseLimit(budget, "2026-08-21T12:00:00Z");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("daily_pulse_limit");
        expect(res.outcome).toBe("deferred");
        expect(res.outcome).toEqual("deferred" as BudgetOutcome);
        expect(res.reason).toContain("daily pulse budget exhausted");
        expect(res.reason).toContain("96/96");
        expect(res.repairArgv).toBe("mind:wake");
        expect(res.current).toBe(96);
        expect(res.limit).toBe(96);
      }
    });

    test("refuses with outcome 'deferred' when using daily_pulse_limit property alias", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        pulses_today: 10,
        daily_pulse_limit: 10,
      };

      const res = checkDailyPulseLimit(budget, "2026-08-21T12:00:00Z");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("daily_pulse_limit");
        expect(res.outcome).toBe("deferred");
        expect(res.current).toBe(10);
        expect(res.limit).toBe(10);
      }
    });

    test("passes when pulses_today is below pulses_per_day limit", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        pulses_today: 41,
        pulses_per_day: 96,
      };

      const res = checkDailyPulseLimit(budget, "2026-08-21T12:00:00Z");
      expect(res.ok).toBe(true);
    });
  });

  describe("daily_wall_clock_limit_ms refusal and outcome typing", () => {
    test("refuses with outcome 'deferred' when aggregate duration reaches limit", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        wall_clock_ms_today: 21_600_000,
        wall_clock_ms_per_day: 21_600_000,
      };

      const res = checkDailyWallClockLimit(budget, "2026-08-21T12:00:00Z");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("daily_wall_clock_limit_ms");
        expect(res.outcome).toBe("deferred");
        expect(res.reason).toContain("daily wall clock budget exhausted");
        expect(res.repairArgv).toBe("mind:wake");
        expect(res.current).toBe(21_600_000);
        expect(res.limit).toBe(21_600_000);
      }
    });

    test("refuses with outcome 'deferred' when using daily_wall_clock_limit_ms alias", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        wall_clock_ms_today: 10_000,
        daily_wall_clock_limit_ms: 10_000,
      };

      const res = checkDailyWallClockLimit(budget, "2026-08-21T12:00:00Z");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("daily_wall_clock_limit_ms");
        expect(res.outcome).toBe("deferred");
        expect(res.current).toBe(10_000);
        expect(res.limit).toBe(10_000);
      }
    });

    test("passes when wall_clock_ms_today is below wall_clock_ms_per_day limit", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        wall_clock_ms_today: 7_860_000,
        wall_clock_ms_per_day: 21_600_000,
      };

      const res = checkDailyWallClockLimit(budget, "2026-08-21T12:00:00Z");
      expect(res.ok).toBe(true);
    });
  });

  describe("max_agents_in_flight refusal and outcome typing", () => {
    test("refuses with outcome 'deferred' when active agents count reaches ceiling", () => {
      const budget: Record<string, unknown> = {
        max_agents_in_flight: 4,
      };

      const res = checkMaxAgentsInFlight(budget, 4);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("max_agents_in_flight");
        expect(res.outcome).toBe("deferred");
        expect(res.reason).toContain("max agents in flight reached (4/4)");
        expect(res.repairArgv).toBe("agent:release");
        expect(res.current).toBe(4);
        expect(res.limit).toBe(4);
      }
    });

    test("refuses with outcome 'deferred' when evaluating active agents from state object", () => {
      const budget: Record<string, unknown> = {
        max_agents_in_flight: 2,
      };
      const state: Record<string, unknown> = {
        budget,
        agents: [
          { id: "agent-1", role: "implementer", status: "active" },
          { id: "agent-2", role: "validator", status: "active" },
          { id: "agent-3", role: "implementer", status: "released" },
        ],
      };

      expect(countActiveAgentsInFlight(state)).toBe(2);

      const res = checkMaxAgentsInFlight(budget, state);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("max_agents_in_flight");
        expect(res.outcome).toBe("deferred");
        expect(res.current).toBe(2);
        expect(res.limit).toBe(2);
      }
    });

    test("passes when active agents in flight is below max_agents_in_flight", () => {
      const budget: Record<string, unknown> = {
        max_agents_in_flight: 8,
      };

      const res = checkMaxAgentsInFlight(budget, 3);
      expect(res.ok).toBe(true);
    });
  });

  describe("round_budget refusal and outcome typing", () => {
    test("refuses with outcome 'paused' when round index exceeds max_rounds_per_objective", () => {
      const budget: Record<string, unknown> = {
        max_rounds_per_objective: 3,
      };

      const res = checkRoundBudget(budget, 4, "obj-1");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("round_budget");
        expect(res.outcome).toBe("paused");
        expect(res.reason).toContain("round budget spent for objective 'obj-1'");
        expect(res.reason).toContain("4 > max 3 rounds");
        expect(res.repairArgv).toBe("mind:wake");
        expect(res.current).toBe(4);
        expect(res.limit).toBe(3);
      }
    });

    test("refuses with outcome 'paused' when using round_budget alias", () => {
      const budget: Record<string, unknown> = {
        round_budget: 2,
      };

      const res = checkRoundBudget(budget, 3, "obj-2");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("round_budget");
        expect(res.outcome).toBe("paused");
        expect(res.current).toBe(3);
        expect(res.limit).toBe(2);
      }
    });

    test("passes when round index is within max_rounds_per_objective", () => {
      const budget: Record<string, unknown> = {
        max_rounds_per_objective: 3,
      };

      expect(checkRoundBudget(budget, 1, "obj-1").ok).toBe(true);
      expect(checkRoundBudget(budget, 2, "obj-1").ok).toBe(true);
      expect(checkRoundBudget(budget, 3, "obj-1").ok).toBe(true);
    });
  });

  describe("quiet_hours and max_open_proposals refusals", () => {
    test("checkQuietHoursBudget refuses with outcome 'deferred' during quiet hours", () => {
      const budget: Record<string, unknown> = {
        quiet_hours: "23:00-05:00",
      };

      const res = checkQuietHoursBudget(budget, "2026-08-21T23:30:00Z");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("quiet_hours");
        expect(res.outcome).toBe("deferred");
        expect(res.reason).toContain("inside quiet hours (23:00-05:00)");
        expect(res.repairArgv).toBe("mind:wake");
      }
    });

    test("checkMaxOpenProposals refuses with outcome 'paused' when ceiling reached", () => {
      const budget: Record<string, unknown> = {
        max_open_proposals: 5,
      };

      const res = checkMaxOpenProposals(budget, 5);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("max_open_proposals");
        expect(res.outcome).toBe("paused");
        expect(res.reason).toContain("open proposal ceiling reached (5/5)");
        expect(res.current).toBe(5);
        expect(res.limit).toBe(5);
      }
    });

    test("checkMaxOpenProposals passes when open count is below ceiling", () => {
      const budget: Record<string, unknown> = {
        max_open_proposals: 5,
      };

      expect(checkMaxOpenProposals(budget, 4).ok).toBe(true);
    });
  });

  describe("evaluateBudgetRefusalLadder - deterministic priority ladder", () => {
    test("ladder prioritizes quiet_hours before daily pulse limit", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        quiet_hours: "23:00-05:00",
        pulses_today: 96,
        pulses_per_day: 96,
      };

      const res = evaluateBudgetRefusalLadder(budget, {
        now: "2026-08-21T23:30:00Z",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("quiet_hours");
        expect(res.outcome).toBe("deferred");
      }
    });

    test("ladder prioritizes daily pulse limit before wall clock limit", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        quiet_hours: null,
        pulses_today: 96,
        pulses_per_day: 96,
        wall_clock_ms_today: 21_600_000,
        wall_clock_ms_per_day: 21_600_000,
      };

      const res = evaluateBudgetRefusalLadder(budget, {
        now: "2026-08-21T12:00:00Z",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("daily_pulse_limit");
        expect(res.outcome).toBe("deferred");
      }
    });

    test("ladder prioritizes daily wall clock limit before max agents in flight", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        quiet_hours: null,
        pulses_today: 10,
        pulses_per_day: 96,
        wall_clock_ms_today: 21_600_000,
        wall_clock_ms_per_day: 21_600_000,
        max_agents_in_flight: 4,
      };

      const res = evaluateBudgetRefusalLadder(budget, {
        now: "2026-08-21T12:00:00Z",
        activeAgentsCount: 4,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("daily_wall_clock_limit_ms");
        expect(res.outcome).toBe("deferred");
      }
    });

    test("ladder prioritizes max agents in flight before round budget", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        quiet_hours: null,
        pulses_today: 10,
        pulses_per_day: 96,
        wall_clock_ms_today: 1000,
        wall_clock_ms_per_day: 21_600_000,
        max_agents_in_flight: 2,
        max_rounds_per_objective: 3,
      };

      const res = evaluateBudgetRefusalLadder(budget, {
        now: "2026-08-21T12:00:00Z",
        activeAgentsCount: 2,
        roundIndex: 4,
        objectiveId: "obj-1",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("max_agents_in_flight");
        expect(res.outcome).toBe("deferred");
      }
    });

    test("ladder evaluates round budget with outcome 'paused' when agents capacity is free", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        quiet_hours: null,
        pulses_today: 10,
        pulses_per_day: 96,
        wall_clock_ms_today: 1000,
        wall_clock_ms_per_day: 21_600_000,
        max_agents_in_flight: 8,
        max_rounds_per_objective: 3,
      };

      const res = evaluateBudgetRefusalLadder(budget, {
        now: "2026-08-21T12:00:00Z",
        activeAgentsCount: 2,
        roundIndex: 4,
        objectiveId: "obj-1",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("round_budget");
        expect(res.outcome).toBe("paused");
      }
    });

    test("ladder passes when all budget constraints have headroom", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        quiet_hours: "23:00-05:00",
        pulses_today: 10,
        pulses_per_day: 96,
        wall_clock_ms_today: 5000,
        wall_clock_ms_per_day: 21_600_000,
        max_agents_in_flight: 8,
        max_rounds_per_objective: 3,
        max_open_proposals: 5,
      };

      const res = evaluateBudgetRefusalLadder(budget, {
        now: "2026-08-21T12:00:00Z",
        activeAgentsCount: 2,
        roundIndex: 2,
        objectiveId: "obj-1",
        openProposalsCount: 1,
      });
      expect(res.ok).toBe(true);
    });
  });

  describe("day rollover and time parsing", () => {
    test("rollDayKeyIfNeeded rolls day when keys differ and resets counters", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-20",
        pulses_today: 96,
        wall_clock_ms_today: 20_000_000,
      };

      const res = rollDayKeyIfNeeded(budget, "2026-08-21T01:00:00Z");
      expect(res.rolled).toBe(true);
      expect(res.dayKey).toBe("2026-08-21");
      expect(budget.day_key).toBe("2026-08-21");
      expect(budget.pulses_today).toBe(0);
      expect(budget.wall_clock_ms_today).toBe(0);
    });

    test("rollDayKeyIfNeeded leaves counters untouched when on the same day", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-08-21",
        pulses_today: 42,
        wall_clock_ms_today: 8_000_000,
      };

      const res = rollDayKeyIfNeeded(budget, "2026-08-21T18:00:00Z");
      expect(res.rolled).toBe(false);
      expect(res.dayKey).toBe("2026-08-21");
      expect(budget.pulses_today).toBe(42);
      expect(budget.wall_clock_ms_today).toBe(8_000_000);
    });

    test("parseNowMs parses numeric timestamps, Date objects, and ISO strings", () => {
      const timestamp = 1755770400000;
      expect(parseNowMs(timestamp)).toBe(timestamp);
      expect(parseNowMs(new Date(timestamp))).toBe(timestamp);
      expect(parseNowMs("2026-08-21T10:00:00.000Z")).toBe(Date.parse("2026-08-21T10:00:00.000Z"));
      expect(typeof parseNowMs()).toBe("number");
    });

    test("checkQuietHours correctly evaluates various configurations", () => {
      expect(checkQuietHours(null).inQuietHours).toBe(false);
      expect(checkQuietHours(undefined).inQuietHours).toBe(false);
      expect(checkQuietHours("none").inQuietHours).toBe(false);
      expect(checkQuietHours("").inQuietHours).toBe(false);

      // Same-day window: 01:00-06:00
      expect(checkQuietHours("01:00-06:00", "2026-08-21T03:00:00Z").inQuietHours).toBe(true);
      expect(checkQuietHours("01:00-06:00", "2026-08-21T07:00:00Z").inQuietHours).toBe(false);

      // Midnight-spanning window: 22:00-06:00
      expect(checkQuietHours("22:00-06:00", "2026-08-21T23:30:00Z").inQuietHours).toBe(true);
      expect(checkQuietHours("22:00-06:00", "2026-08-21T04:30:00Z").inQuietHours).toBe(true);
      expect(checkQuietHours("22:00-06:00", "2026-08-21T14:00:00Z").inQuietHours).toBe(false);
    });
  });

  describe("capsule event sequence immutability on budget refusals", () => {
    test("refusal on daily_pulse_limit leaves capsule event_sequence strictly unmutated", () => {
      const { run } = setupMindCapsule("pulse-limit-immutability", {
        budget: {
          day_key: "2026-08-21",
          pulses_today: 96,
          pulses_per_day: 96,
        },
      });

      const before = loadRun(run, false);
      const seqBefore = before.state.event_sequence;
      const headBefore = before.state.event_head;

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
        expect(harnessErr.message).toContain("daily pulse budget exhausted");
        expect(harnessErr.message).toContain("Outcome: deferred");
      }

      const after = loadRun(run, false);
      expect(after.state.event_sequence).toBe(seqBefore);
      expect(after.state.event_head).toBe(headBefore);
      expect(after.events.length).toBe(before.events.length);
    });

    test("refusal on daily_wall_clock_limit_ms leaves capsule event_sequence strictly unmutated", () => {
      const { run } = setupMindCapsule("wall-clock-immutability", {
        budget: {
          day_key: "2026-08-21",
          wall_clock_ms_today: 21_600_000,
          wall_clock_ms_per_day: 21_600_000,
        },
      });

      const before = loadRun(run, false);
      const seqBefore = before.state.event_sequence;
      const headBefore = before.state.event_head;

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
        expect(harnessErr.message).toContain("daily wall clock budget exhausted");
        expect(harnessErr.message).toContain("Outcome: deferred");
      }

      const after = loadRun(run, false);
      expect(after.state.event_sequence).toBe(seqBefore);
      expect(after.state.event_head).toBe(headBefore);
      expect(after.events.length).toBe(before.events.length);
    });

    test("refusal on quiet_hours leaves capsule event_sequence strictly unmutated", () => {
      const { run } = setupMindCapsule("quiet-hours-immutability", {
        budget: {
          quiet_hours: "22:00-06:00",
        },
      });

      const before = loadRun(run, false);
      const seqBefore = before.state.event_sequence;
      const headBefore = before.state.event_head;

      try {
        mindPulseOpenCommand({
          run,
          actor: "mind-1",
          host: "antigravity",
          driver: "pulse.sh",
          now: "2026-08-21T23:30:00.000Z",
        });
        expect(true).toBe(false);
      } catch (err) {
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain("inside quiet hours");
        expect(harnessErr.message).toContain("Outcome: deferred");
      }

      const after = loadRun(run, false);
      expect(after.state.event_sequence).toBe(seqBefore);
      expect(after.state.event_head).toBe(headBefore);
      expect(after.events.length).toBe(before.events.length);
    });

    test("refusal on round_budget leaves capsule event_sequence strictly unmutated", () => {
      const candidateRecord = {
        id: "cand-1",
        kind: "defect",
        statement: "Fix parser bug",
        status: "admitted",
      };

      const { run } = setupMindCapsule("round-budget-immutability", {
        budget: {
          max_rounds_per_objective: 2,
        },
        candidates: [candidateRecord],
      });

      // Register an orchestrator agent to attempt round opening
      agentRegisterCommand({
        run,
        agent: "orch-1",
        role: "orchestrator",
        host: "antigravity",
      });

      const before = loadRun(run, false);
      const seqBefore = before.state.event_sequence;
      const headBefore = before.state.event_head;

      try {
        mindRoundOpenCommand({
          run,
          actor: "orch-1",
          objective: "obj-test",
          candidate: "cand-1",
          round: "3", // exceeds max_rounds_per_objective of 2
        });
        expect(true).toBe(false);
      } catch (err) {
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain("round budget spent");
      }

      const after = loadRun(run, false);
      expect(after.state.event_sequence).toBe(seqBefore);
      expect(after.state.event_head).toBe(headBefore);
      expect(after.events.length).toBe(before.events.length);
    });
  });

  describe("p17 & p23 - Infinite Borderless Mind & Dynamic Topological Concurrency ($P = W/S$)", () => {
    test("DEFAULT_MIND_BUDGET provides infinite borderless parameters without artificial caps", () => {
      expect(DEFAULT_MIND_BUDGET.infinite_cadence).toBe(true);
      expect(DEFAULT_MIND_BUDGET.cadence).toBe("infinite_borderless");
      expect(DEFAULT_MIND_BUDGET.concurrency_model).toBe("topological_work_span");
      expect(DEFAULT_MIND_BUDGET.pulses_per_day).toBeNull();
      expect(DEFAULT_MIND_BUDGET.wall_clock_ms_per_day).toBeNull();
      expect(DEFAULT_MIND_BUDGET.max_agents_in_flight).toBeNull();
      expect(DEFAULT_MIND_BUDGET.max_rounds_per_objective).toBeNull();
      expect(DEFAULT_MIND_BUDGET.max_open_proposals).toBeNull();
      expect(DEFAULT_MIND_BUDGET.base_interval_ms).toBe(0);
      expect(DEFAULT_MIND_BUDGET.max_interval_ms).toBeNull();
      expect(DEFAULT_MIND_BUDGET.max_pause_interval_ms).toBeNull();
      expect(DEFAULT_MIND_BUDGET.pulse_deadline_ms).toBe(1_200_000);
      expect(DEFAULT_MIND_BUDGET.quiet_hours).toBeNull();
    });

    test("computeTopologicalConcurrency accurately calculates P = ceil(W / S)", () => {
      // Work = 10, Span = 2 -> P = 5
      expect(computeTopologicalConcurrency(10, 2)).toBe(5);
      // Work = 10, Span = 4 -> P = ceil(2.5) = 3
      expect(computeTopologicalConcurrency(10, 4)).toBe(3);
      // Work = 6, Span = 1 -> P = 6
      expect(computeTopologicalConcurrency(6, 1)).toBe(6);
      // Work = 6, Span = 6 (serial chain) -> P = 1
      expect(computeTopologicalConcurrency(6, 6)).toBe(1);
      // Edge cases
      expect(computeTopologicalConcurrency(0, 0)).toBe(1);
      expect(computeTopologicalConcurrency(-5, 2)).toBe(1);
      expect(computeTopologicalConcurrency(10, 0)).toBe(10);
    });

    test("checkMaxAgentsInFlight evaluates dynamic topological Work/Span concurrency", () => {
      const budget: Record<string, unknown> = {
        infinite_cadence: true,
      };

      // When 4 agents active, and W=12, S=3 -> maxAgents = 4 -> passes
      const passResult = checkMaxAgentsInFlight(budget, 3, { totalWork: 12, span: 3 });
      expect(passResult.ok).toBe(true);

      // When 5 agents active, and W=12, S=3 -> maxAgents = 4 -> refuses with capacity deferral
      const refuseResult = checkMaxAgentsInFlight(budget, 5, { totalWork: 12, span: 3 });
      expect(refuseResult.ok).toBe(false);
      if (!refuseResult.ok) {
        expect(refuseResult.key).toBe("max_agents_in_flight");
        expect(refuseResult.outcome).toBe("deferred");
        expect(refuseResult.current).toBe(5);
        expect(refuseResult.limit).toBe(4);
      }
    });

    test("budget checks pass unconditionally under default infinite budget", () => {
      const defaultBudget = {
        ...DEFAULT_MIND_BUDGET,
        day_key: "2026-08-22",
        pulses_today: 10000,
        wall_clock_ms_today: 999999999,
      };

      expect(checkDailyPulseLimit(defaultBudget).ok).toBe(true);
      expect(checkDailyWallClockLimit(defaultBudget).ok).toBe(true);
      expect(checkMaxAgentsInFlight(defaultBudget, 50).ok).toBe(true);
      expect(checkRoundBudget(defaultBudget, 100, "obj-infinite").ok).toBe(true);
      expect(checkMaxOpenProposals(defaultBudget, 50).ok).toBe(true);

      const ladderResult = evaluateBudgetRefusalLadder(defaultBudget, {
        activeAgentsCount: 50,
        roundIndex: 100,
        openProposalsCount: 50,
      });
      expect(ladderResult.ok).toBe(true);
    });

    test("parseCharter correctly parses infinite borderless cadence and topological Work/Span notation", () => {
      const infiniteCharter = `
name: "mind"
role: "mind"
charter:
  identity: "Infinite Borderless Mind with Topological Concurrency"
  goals:
    - id: "G1"
      statement: "Ensure non-stop autonomic self-evolution"
  non_goals:
    - "Manual intervention bottlenecks"
  repo_roots:
    - "olt/"
  budgets:
    cadence: "infinite_borderless"
    concurrency_model: "topological_work_span"
    pulses_per_day: "infinite"
    wall_clock_ms_per_day: "unlimited"
    max_agents_in_flight: "topological_work_span (P = W / S)"
    max_rounds_per_objective: "infinite"
    base_interval_ms: 0
    max_interval_ms: "infinite"
    max_pause_interval_ms: "infinite"
    pulse_deadline_ms: "20m"
    max_open_proposals: "infinite"
    quiet_hours: "none"
`;
      const parsed = parseCharter(infiniteCharter);
      expect(parsed.budgets).toBeDefined();
      expect(parsed.budgets!.infinite_cadence).toBe(true);
      expect(parsed.budgets!.cadence).toBe("infinite_borderless");
      expect(parsed.budgets!.concurrency_model).toBe("topological_work_span");
      expect(parsed.budgets!.pulses_per_day).toBeNull();
      expect(parsed.budgets!.wall_clock_ms_per_day).toBeNull();
      expect(parsed.budgets!.max_agents_in_flight).toBeNull();
      expect(parsed.budgets!.max_rounds_per_objective).toBeNull();
      expect(parsed.budgets!.base_interval_ms).toBe(0);
      expect(parsed.budgets!.max_interval_ms).toBeNull();
      expect(parsed.budgets!.max_pause_interval_ms).toBeNull();
      expect(parsed.budgets!.pulse_deadline_ms).toBe(20 * 60 * 1000);
      expect(parsed.budgets!.max_open_proposals).toBeNull();
      expect(parsed.budgets!.quiet_hours).toBeNull();
    });
  });
});
