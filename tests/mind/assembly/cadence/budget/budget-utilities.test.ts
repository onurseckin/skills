import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  checkDailyBudget,
  checkMaxAgentsInFlight,
  checkRoundBudget,
  computeTopologicalConcurrency,
  countActiveAgentsInFlight,
  parseNowMs,
  readMindBudget,
  rollDayKeyIfNeeded,
  updateMindBudget,
} from "../../../../../olt/scripts/src/mind/lifecycle/budget/index.ts";
import { cleanupVirtualMindFS, setupVirtualMindFS } from "../../../fixtures/index.ts";

describe("Mind Assembly Cadence Budget Utilities Suite", () => {
  beforeEach(() => {
    setupVirtualMindFS();
  });
  afterEach(() => {
    cleanupVirtualMindFS();
  });

  describe("Day Rollover and Topographic Concurrency", () => {
    it("rolls day key and resets counters on date boundary crossing", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-09-01",
        pulses_today: 42,
        wall_clock_ms_today: 120000,
      };
      const rolled = rollDayKeyIfNeeded(budget, "2026-09-02T10:00:00.000Z");
      expect(rolled.rolled).toBe(true);
      expect(rolled.dayKey).toBe("2026-09-02");
      expect(budget.day_key).toBe("2026-09-02");
      expect(budget.pulses_today).toBe(0);
      expect(budget.wall_clock_ms_today).toBe(0);
    });

    it("preserves counters when day key is identical", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-09-01",
        pulses_today: 42,
        wall_clock_ms_today: 120000,
      };
      const rolled = rollDayKeyIfNeeded(budget, "2026-09-01T20:00:00.000Z");
      expect(rolled.rolled).toBe(false);
      expect(budget.pulses_today).toBe(42);
      expect(budget.wall_clock_ms_today).toBe(120000);
    });

    it("avoids mutating budget state when dryRun option is enabled", () => {
      const budget: Record<string, unknown> = {
        day_key: "2026-09-01",
        pulses_today: 42,
        wall_clock_ms_today: 120000,
      };
      const rolled = rollDayKeyIfNeeded(budget, "2026-09-05T00:00:00.000Z", { dryRun: true });
      expect(rolled.rolled).toBe(true);
      expect(budget.day_key).toBe("2026-09-01");
      expect(budget.pulses_today).toBe(42);
    });

    it("computes topological concurrency with edge inputs and boundary clamps", () => {
      expect(computeTopologicalConcurrency(0, 0)).toBe(5);
      expect(computeTopologicalConcurrency(-10, 5)).toBe(5);
      expect(computeTopologicalConcurrency(20, 0)).toBe(20);
      expect(computeTopologicalConcurrency(10, 20)).toBe(5);
      expect(computeTopologicalConcurrency(100, 2)).toBe(50);
      expect(computeTopologicalConcurrency(30, 3, 2, 25)).toBe(10);
    });
  });

  describe("Granular Boundary Checks and Utilities", () => {
    it("clamps max_agents_in_flight between 1 and 50", () => {
      const underClamp = checkMaxAgentsInFlight({ max_agents_in_flight: 0 }, 1);
      expect(underClamp.ok).toBe(false);
      if (!underClamp.ok) expect(underClamp.limit).toBe(1);

      const overClamp = checkMaxAgentsInFlight({ max_agents_in_flight: 100 }, 50);
      expect(overClamp.ok).toBe(false);
      if (!overClamp.ok) expect(overClamp.limit).toBe(50);
    });

    it("formats round budget refusal with objectiveId label", () => {
      const res = checkRoundBudget({ round_budget: 3 }, 4, "obj-alpha");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("for objective 'obj-alpha'");
        expect(res.current).toBe(4);
        expect(res.limit).toBe(3);
      }
    });

    it("counts only active authorized agents", () => {
      const state = {
        agents: [
          { role: "implementer", status: "active" },
          { role: "validator", status: "active" },
          { role: "orchestrator", status: "active" },
          { role: "implementer", status: "active" },
          { role: "mind-auditor", status: "active" },
          { role: "custom-worker", status: "active" },
          { role: "implementer", status: "idle" },
        ],
      };
      expect(countActiveAgentsInFlight(state)).toBe(5);
      expect(countActiveAgentsInFlight({})).toBe(0);
    });

    it("evaluates checkDailyBudget with quiet hours, pulse limits, and timezone support", () => {
      const budget = {
        quiet_hours: "22:00-06:00",
        timezone: "UTC",
        daily_pulse_limit: 10,
        pulses_today: 10,
        day_key: "2026-09-01",
      };
      const quietRes = checkDailyBudget(budget, "2026-09-01T23:00:00.000Z");
      expect(quietRes.ok).toBe(false);
      expect(quietRes.key).toBe("quiet_hours");

      const pulseRes = checkDailyBudget(budget, "2026-09-01T12:00:00.000Z");
      expect(pulseRes.ok).toBe(false);
      expect(pulseRes.key).toBe("daily_pulse_limit");

      const okBudget = {
        quiet_hours: null,
        daily_pulse_limit: 50,
        pulses_today: 2,
        daily_wall_clock_limit_ms: 100000,
        wall_clock_ms_today: 100,
        day_key: "2026-09-01",
      };
      expect(checkDailyBudget(okBudget, "2026-09-01T12:00:00.000Z").ok).toBe(true);
    });

    it("parses now input in diverse formats and updates budget", () => {
      const rawIso = "2026-09-01T13:00:00.000Z";
      const timestamp = Date.parse(rawIso);
      expect(parseNowMs(timestamp)).toBe(timestamp);
      expect(parseNowMs(new Date(timestamp))).toBe(timestamp);
      expect(parseNowMs(rawIso)).toBe(timestamp);
      expect(Number.isFinite(parseNowMs(undefined))).toBe(true);

      const charterYaml =
        "identity: mind\ngoals:\n  - id: G1\n    statement: operate\nnon_goals:\n  - stall\nbudgets:\n  max_agents_in_flight: 8\n";
      const initial = readMindBudget(charterYaml);
      expect(initial.pulses_today).toBe(0);
      expect(initial.max_agents_in_flight).toBe(8);
      const updated = updateMindBudget(
        (curr) => ({ ...curr, max_agents_in_flight: 12 }),
        charterYaml,
      );
      expect(updated.max_agents_in_flight).toBe(12);
    });
  });
});
