import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { evaluateBudgetRefusalLadder } from "../../../../../olt/scripts/src/mind/lifecycle/budget/index.ts";
import { cleanupVirtualMindFS, setupVirtualMindFS } from "../../../fixtures/index.ts";

describe("Mind Assembly Cadence Budget Suite", () => {
  beforeEach(() => {
    setupVirtualMindFS();
  });
  afterEach(() => {
    cleanupVirtualMindFS();
  });

  describe("evaluateBudgetRefusalLadder Hierarchy and Shadowing", () => {
    const noonMs = Date.parse("2026-09-01T12:00:00.000Z");
    const midnightQuietMs = Date.parse("2026-09-01T01:30:00.000Z");
    const base = {
      quiet_hours: "00:00-06:00",
      daily_pulse_limit: 100,
      pulses_today: 10,
      daily_wall_clock_limit_ms: 3600000,
      wall_clock_ms_today: 1000,
      max_agents_in_flight: 10,
      max_rounds_per_objective: 5,
      max_open_proposals: 10,
      day_key: "2026-09-01",
    };

    it("evaluates clean pass when all metrics are within allocated limits", () => {
      const res = evaluateBudgetRefusalLadder(base, {
        now: noonMs,
        activeAgentsCount: 2,
        roundIndex: 2,
        openProposalsCount: 1,
      });
      expect(res.ok).toBe(true);
    });

    it("Priority 1: quiet hours refusal shadows daily pulse, wall clock, agent, round, and proposal violations", () => {
      const budget = {
        ...base,
        daily_pulse_limit: 5,
        daily_wall_clock_limit_ms: 100,
        max_agents_in_flight: 1,
        max_rounds_per_objective: 1,
        max_open_proposals: 1,
      };
      const res = evaluateBudgetRefusalLadder(budget, {
        now: midnightQuietMs,
        activeAgentsCount: 10,
        roundIndex: 5,
        openProposalsCount: 10,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("quiet_hours");
        expect(res.outcome).toBe("deferred");
        expect(res.repairArgv).toBe("mind:wake");
      }
    });

    it("Priority 2: daily pulse limit refusal shadows wall clock, agent, round, and proposal violations", () => {
      const budget = {
        ...base,
        daily_pulse_limit: 10,
        daily_wall_clock_limit_ms: 100,
        max_agents_in_flight: 1,
        max_rounds_per_objective: 1,
        max_open_proposals: 1,
      };
      const res = evaluateBudgetRefusalLadder(budget, {
        now: noonMs,
        activeAgentsCount: 5,
        roundIndex: 3,
        openProposalsCount: 4,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("daily_pulse_limit");
        expect(res.outcome).toBe("deferred");
      }
    });

    it("Priority 3: daily wall clock limit refusal shadows agent, round, and proposal violations", () => {
      const budget = {
        ...base,
        daily_pulse_limit: 100,
        daily_wall_clock_limit_ms: 500,
        max_agents_in_flight: 1,
        max_rounds_per_objective: 1,
        max_open_proposals: 1,
      };
      const res = evaluateBudgetRefusalLadder(budget, {
        now: noonMs,
        activeAgentsCount: 5,
        roundIndex: 3,
        openProposalsCount: 4,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("daily_wall_clock_limit_ms");
        expect(res.outcome).toBe("deferred");
      }
    });

    it("Priority 4: active agents in flight refusal shadows round and proposal violations", () => {
      const budget = {
        ...base,
        quiet_hours: null,
        daily_wall_clock_limit_ms: 100000,
        max_agents_in_flight: 2,
        max_rounds_per_objective: 1,
        max_open_proposals: 1,
      };
      const res = evaluateBudgetRefusalLadder(budget, {
        now: noonMs,
        activeAgentsCount: 3,
        roundIndex: 10,
        openProposalsCount: 5,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("max_agents_in_flight");
        expect(res.outcome).toBe("deferred");
        expect(res.repairArgv).toBe("agent:release");
      }
    });

    it("Priority 5: round budget refusal shadows open proposal violation", () => {
      const budget = {
        ...base,
        quiet_hours: null,
        daily_wall_clock_limit_ms: 100000,
        max_agents_in_flight: 10,
        max_rounds_per_objective: 3,
        max_open_proposals: 1,
      };
      const res = evaluateBudgetRefusalLadder(budget, {
        now: noonMs,
        activeAgentsCount: 1,
        roundIndex: 4,
        openProposalsCount: 5,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("round_budget");
        expect(res.outcome).toBe("paused");
      }
    });

    it("Priority 6: open proposals ceiling refusal triggers when previous checks pass", () => {
      const budget = {
        ...base,
        quiet_hours: null,
        daily_wall_clock_limit_ms: 100000,
        max_agents_in_flight: 10,
        max_rounds_per_objective: 5,
        max_open_proposals: 2,
      };
      const res = evaluateBudgetRefusalLadder(budget, {
        now: noonMs,
        activeAgentsCount: 1,
        roundIndex: 2,
        openProposalsCount: 2,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.key).toBe("max_open_proposals");
        expect(res.outcome).toBe("paused");
      }
    });

    it("computes active agents directly from state.agents array if activeAgentsCount option is omitted", () => {
      const state = {
        budget: { quiet_hours: null, max_agents_in_flight: 2 },
        agents: [
          { role: "implementer", status: "active" },
          { role: "validator", status: "active" },
        ],
      };
      const res = evaluateBudgetRefusalLadder(state, { now: noonMs });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.key).toBe("max_agents_in_flight");
    });
  });
});
