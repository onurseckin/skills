import { describe, expect, it } from "bun:test";
import {
  checkDailyBudget,
  checkMaxAgentsInFlight,
  checkMaxOpenProposals,
  checkRoundBudget,
  countActiveAgentsInFlight,
  evaluateBudgetRefusalLadder,
} from "../../../../olt/scripts/src/mind/lifecycle/budget/calculator.ts";

describe("Budget Calculator Suite (calculator.ts)", () => {
  const fixedNow = new Date("2026-09-01T14:00:00.000Z").getTime();

  describe("countActiveAgentsInFlight", () => {
    it("returns 0 for empty or invalid agent list", () => {
      expect(countActiveAgentsInFlight({})).toBe(0);
      expect(countActiveAgentsInFlight({ agents: null })).toBe(0);
      expect(countActiveAgentsInFlight({ agents: "invalid" as unknown as unknown[] })).toBe(0);
    });

    it("counts only active agents with authorized roles", () => {
      const state = {
        agents: [
          { role: "implementer", status: "active" },
          { role: "validator", status: "active" },
          { role: "orchestrator", status: "active" },
          { role: "repairer", status: "active" },
          { role: "mind-auditor", status: "active" },
          { role: "observer", status: "active" }, // unauthorized role
          { role: "implementer", status: "idle" }, // inactive
          { role: "validator", status: "terminated" }, // inactive
        ],
      };
      expect(countActiveAgentsInFlight(state)).toBe(5);
    });
  });

  describe("checkMaxAgentsInFlight", () => {
    it("allows execution when active agents count is below max limit", () => {
      const res = checkMaxAgentsInFlight({ max_agents_in_flight: 5 }, 3);
      expect(res.ok).toBe(true);
    });

    it("defers execution when active count reaches max limit", () => {
      const res = checkMaxAgentsInFlight({ max_agents_in_flight: 5 }, 5);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("max_agents_in_flight");
        expect(res.outcome).toBe("deferred");
        expect(res.repairArgv).toBe("agent:release");
        expect(res.current).toBe(5);
        expect(res.limit).toBe(5);
      }
    });

    it("clamps max_agents_in_flight between 1 and 50", () => {
      const lowRes = checkMaxAgentsInFlight({ max_agents_in_flight: 0 }, 1);
      expect(lowRes.ok).toBe(false);
      if (!lowRes.ok) expect(lowRes.limit).toBe(1);

      const highRes = checkMaxAgentsInFlight({ max_agents_in_flight: 100 }, 50);
      expect(highRes.ok).toBe(false);
      if (!highRes.ok) expect(highRes.limit).toBe(50);
    });

    it("derives max concurrency from topological work and span parameters", () => {
      const res = checkMaxAgentsInFlight(
        {},
        10,
        { totalWork: 100, span: 10 }, // 100/10 = 10 max concurrency
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.limit).toBe(10);
    });

    it("calculates active count from state object", () => {
      const state = {
        agents: [
          { role: "implementer", status: "active" },
          { role: "validator", status: "active" },
        ],
      };
      const res = checkMaxAgentsInFlight({ max_agents_in_flight: 2 }, state);
      expect(res.ok).toBe(false);
    });
  });

  describe("checkRoundBudget", () => {
    it("permits round when roundIndex is within round budget", () => {
      expect(checkRoundBudget({ max_rounds_per_objective: 10 }, 5).ok).toBe(true);
      expect(checkRoundBudget({ round_budget: 10 }, 10).ok).toBe(true);
      expect(checkRoundBudget({}, 100).ok).toBe(true);
    });

    it("pauses round when roundIndex exceeds maximum rounds", () => {
      const res = checkRoundBudget({ max_rounds_per_objective: 3 }, 4, "obj-alpha");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("round_budget");
        expect(res.outcome).toBe("paused");
        expect(res.reason).toContain("for objective 'obj-alpha'");
        expect(res.current).toBe(4);
        expect(res.limit).toBe(3);
      }
    });
  });

  describe("checkMaxOpenProposals", () => {
    it("permits proposal when open count is below maximum ceiling", () => {
      expect(checkMaxOpenProposals({ max_open_proposals: 10 }, 5).ok).toBe(true);
      expect(checkMaxOpenProposals({}, 100).ok).toBe(true);
    });

    it("pauses proposal creation when open proposal count reaches ceiling", () => {
      const res = checkMaxOpenProposals({ max_open_proposals: 5 }, 5);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("max_open_proposals");
        expect(res.outcome).toBe("paused");
        expect(res.current).toBe(5);
        expect(res.limit).toBe(5);
      }
    });
  });

  describe("evaluateBudgetRefusalLadder", () => {
    it("passes cleanly when all budget thresholds are satisfied", () => {
      const state = {
        budget: {
          max_agents_in_flight: 10,
          max_rounds_per_objective: 5,
          max_open_proposals: 5,
        },
        agents: [{ role: "implementer", status: "active" }],
      };
      const res = evaluateBudgetRefusalLadder(state, {
        now: fixedNow,
        roundIndex: 2,
        openProposalsCount: 1,
      });
      expect(res.ok).toBe(true);
    });

    it("evaluates ladder priority 1: quiet hours refusal", () => {
      const res = evaluateBudgetRefusalLadder(
        { quiet_hours: "13:00-15:00 UTC" },
        { now: fixedNow },
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.key).toBe("quiet_hours");
    });

    it("evaluates ladder priority 2: daily pulse limit refusal", () => {
      const res = evaluateBudgetRefusalLadder(
        { day_key: "2026-09-01", pulses_today: 100, pulses_per_day: 100 },
        { now: fixedNow },
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.key).toBe("daily_pulse_limit");
    });

    it("evaluates ladder priority 3: daily wall clock limit refusal", () => {
      const res = evaluateBudgetRefusalLadder(
        { day_key: "2026-09-01", wall_clock_ms_today: 50_000, wall_clock_ms_per_day: 50_000 },
        { now: fixedNow },
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.key).toBe("daily_wall_clock_limit_ms");
    });

    it("evaluates ladder priority 4: active agents refusal via options or state", () => {
      const resOpt = evaluateBudgetRefusalLadder(
        { max_agents_in_flight: 2 },
        { now: fixedNow, activeAgentsCount: 3 },
      );
      expect(resOpt.ok).toBe(false);
      if (!resOpt.ok) expect(resOpt.key).toBe("max_agents_in_flight");

      const resState = evaluateBudgetRefusalLadder(
        {
          budget: { max_agents_in_flight: 1 },
          agents: [
            { role: "implementer", status: "active" },
            { role: "validator", status: "active" },
          ],
        },
        { now: fixedNow },
      );
      expect(resState.ok).toBe(false);
      if (!resState.ok) expect(resState.key).toBe("max_agents_in_flight");
    });

    it("evaluates ladder priority 5 & 6: round budget and open proposals", () => {
      const resRound = evaluateBudgetRefusalLadder(
        { max_rounds_per_objective: 2 },
        { now: fixedNow, roundIndex: 3 },
      );
      expect(resRound.ok).toBe(false);
      if (!resRound.ok) expect(resRound.key).toBe("round_budget");

      const resProp = evaluateBudgetRefusalLadder(
        { max_open_proposals: 2 },
        { now: fixedNow, openProposalsCount: 2 },
      );
      expect(resProp.ok).toBe(false);
      if (!resProp.ok) expect(resProp.key).toBe("max_open_proposals");
    });
  });

  describe("checkDailyBudget", () => {
    it("returns ok when daily budget constraints pass", () => {
      const budget = {
        timezone: "UTC",
        quiet_hours: "01:00-05:00",
        pulses_per_day: 100,
        day_key: "2026-09-01",
        pulses_today: 10,
      };
      const res = checkDailyBudget(budget, fixedNow);
      expect(res.ok).toBe(true);
    });

    it("returns refusal when quiet hours are active", () => {
      const budget = { quiet_hours: "13:00-15:00 UTC" };
      const res = checkDailyBudget(budget, fixedNow);
      expect(res.ok).toBe(false);
      expect(res.key).toBe("quiet_hours");
      expect(res.outcome).toBe("deferred");
    });

    it("returns refusal when daily pulse limit is exceeded", () => {
      const budget = {
        day_key: "2026-09-01",
        pulses_today: 50,
        pulses_per_day: 50,
      };
      const res = checkDailyBudget(budget, fixedNow);
      expect(res.ok).toBe(false);
      expect(res.key).toBe("daily_pulse_limit");
    });

    it("returns refusal when daily wall clock limit is exceeded", () => {
      const budget = {
        day_key: "2026-09-01",
        wall_clock_ms_today: 100_000,
        wall_clock_ms_per_day: 100_000,
      };
      const res = checkDailyBudget(budget, fixedNow);
      expect(res.ok).toBe(false);
      expect(res.key).toBe("daily_wall_clock_limit_ms");
    });
  });
});
