import { describe, expect, it } from "bun:test";
import {
  DEFAULT_CONSECUTIVE_CRASH_THRESHOLD,
  deriveLane,
  deriveTheoreticalLane,
  selectLane,
  type LaneSelectorFacts,
} from "../../../olt/scripts/src/mind/lanes/selector.ts";

describe("Mind Lane Selector Coverage Suite", () => {
  it("exports default consecutive crash threshold constant", () => {
    expect(DEFAULT_CONSECUTIVE_CRASH_THRESHOLD).toBe(3);
  });

  describe("Halt & Intervention Conditions (Quiesce)", () => {
    it.each([
      [{ mode: "halted" } as LaneSelectorFacts, "mode halted"],
      [{ charterStatus: "DRIFTED" } as LaneSelectorFacts, "charter DRIFTED"],
      [{ charterStatus: "missing" } as LaneSelectorFacts, "charter missing"],
      [{ integrityStatus: "FAILED" } as LaneSelectorFacts, "integrity FAILED"],
      [{ unrepairableIssuesCount: 2 } as LaneSelectorFacts, "unrepairable issues"],
      [{ consecutiveCrashes: 3 } as LaneSelectorFacts, "consecutive crashes at threshold"],
      [{ consecutiveCrashes: 5 } as LaneSelectorFacts, "consecutive crashes above threshold"],
    ])("selects quiesce when %s (%s)", (facts) => {
      const decision = selectLane(facts);
      expect(decision.lane).toBe("quiesce");
      expect(decision.theoreticalLane).toBe("quiesce");
      expect(decision.reason).toBe("mind is halted or requires owner intervention");
      expect(decision.phaseMasked).toBe(false);
      expect(deriveLane(facts)).toBe("quiesce");
      expect(deriveTheoreticalLane(facts)).toBe("quiesce");
    });
  });

  describe("Deferral & Budget Conditions", () => {
    it.each([
      [{ budgetDeferred: true } as LaneSelectorFacts, "budget deferred flag"],
      [{ isQuietHours: true } as LaneSelectorFacts, "quiet hours active"],
      [{ mode: "paused" } as LaneSelectorFacts, "mode paused"],
      [
        { pulsesToday: 50, pulsesPerDay: 50 } as LaneSelectorFacts,
        "pulses today >= pulses per day",
      ],
      [
        { wallClockTodayMs: 3600000, wallClockPerDayMs: 3600000 } as LaneSelectorFacts,
        "wall clock today >= wall clock per day",
      ],
    ])("selects defer when %s (%s)", (facts) => {
      const decision = selectLane(facts);
      expect(decision.lane).toBe("defer");
      expect(decision.theoreticalLane).toBe("defer");
      expect(decision.reason).toBe("budget exhausted, quiet hours active, or paused");
      expect(decision.phaseMasked).toBe(false);
      expect(deriveLane(facts)).toBe("defer");
      expect(deriveTheoreticalLane(facts)).toBe("defer");
    });
  });

  describe("Rescue Lane Conditions", () => {
    it.each([
      [{ staleLeasesCount: 1 } as LaneSelectorFacts, "stale leases count > 0"],
      [{ liveRuns: [{ hasStaleLease: true }] } as LaneSelectorFacts, "live run has stale lease"],
      [{ deadAgentsCount: 2 } as LaneSelectorFacts, "dead agents count > 0"],
      [{ integrityStatus: "repairable" } as LaneSelectorFacts, "integrity status repairable"],
      [{ integrityIssuesCount: 3 } as LaneSelectorFacts, "integrity issues count > 0"],
    ])("selects rescue when %s (%s)", (facts) => {
      const decision = selectLane(facts);
      expect(decision.lane).toBe("rescue");
      expect(decision.theoreticalLane).toBe("rescue");
      expect(decision.reason).toBe(
        "stale leases, dead agents, or repairable integrity issues present",
      );
      expect(decision.phaseMasked).toBe(false);
      expect(deriveLane(facts)).toBe("rescue");
      expect(deriveTheoreticalLane(facts)).toBe("rescue");
    });
  });

  describe("Repair Lane Conditions", () => {
    it.each([
      [{ openFindingsCount: 1 } as LaneSelectorFacts, "open findings count > 0"],
      [{ liveRuns: [{ openFindingsCount: 2 }] } as LaneSelectorFacts, "live run open findings > 0"],
      [{ failingGatesCount: 1 } as LaneSelectorFacts, "failing gates count > 0"],
      [{ liveRuns: [{ failingGatesCount: 1 }] } as LaneSelectorFacts, "live run failing gates > 0"],
      [{ escalationsCount: 1 } as LaneSelectorFacts, "escalations count > 0"],
      [{ liveRuns: [{ escalatedCount: 1 }] } as LaneSelectorFacts, "live run escalated count > 0"],
    ])("selects repair when %s (%s)", (facts) => {
      const decision = selectLane(facts);
      expect(decision.lane).toBe("repair");
      expect(decision.theoreticalLane).toBe("repair");
      expect(decision.reason).toBe("open findings, failing gates, or escalations present");
      expect(decision.phaseMasked).toBe(false);
      expect(deriveLane(facts)).toBe("repair");
      expect(deriveTheoreticalLane(facts)).toBe("repair");
    });
  });

  describe("Advance Lane Conditions & Phase Masking", () => {
    it.each([
      [{ readyTasksCount: 1 } as LaneSelectorFacts, "ready tasks count > 0"],
      [{ dispatchableTasksCount: 2 } as LaneSelectorFacts, "dispatchable tasks count > 0"],
      [{ liveRuns: [{ readyTasksCount: 1 }] } as LaneSelectorFacts, "live run ready tasks > 0"],
    ])("masks advance to quiesce in Phase 2 for %s", (facts) => {
      const decision = selectLane(facts); // defaults to phase 2
      expect(decision.lane).toBe("quiesce");
      expect(decision.theoreticalLane).toBe("advance");
      expect(decision.phaseMasked).toBe(true);
      expect(decision.reason).toBe("advance lane not implemented in Phase 2; returning quiesce");
      expect(deriveLane(facts)).toBe("quiesce");
      expect(deriveTheoreticalLane(facts)).toBe("advance");
    });

    it("unmasks advance lane when allowAdvanceAndDiscover is true or phase >= 3", () => {
      const facts: LaneSelectorFacts = { readyTasksCount: 3 };
      const explicitDecision = selectLane(facts, { allowAdvanceAndDiscover: true });
      expect(explicitDecision.lane).toBe("advance");
      expect(explicitDecision.theoreticalLane).toBe("advance");
      expect(explicitDecision.phaseMasked).toBe(false);
      expect(explicitDecision.reason).toBe("dispatchable tasks available in live run");

      const phase3Decision = selectLane(facts, { phase: 3 });
      expect(phase3Decision.lane).toBe("advance");
      expect(phase3Decision.phaseMasked).toBe(false);
    });
  });

  describe("Discover Lane Conditions & Phase Masking", () => {
    it.each([
      [{ candidatesCount: 1 } as LaneSelectorFacts, "candidates count > 0"],
      [{ unadmittedCandidatesCount: 1 } as LaneSelectorFacts, "unadmitted candidates > 0"],
      [{ admittedCandidatesCount: 1 } as LaneSelectorFacts, "admitted candidates > 0"],
      [{ hasDiscoveryWork: true } as LaneSelectorFacts, "has discovery work boolean"],
    ])("masks discover to quiesce in Phase 2 for %s", (facts) => {
      const decision = selectLane(facts); // defaults to phase 2
      expect(decision.lane).toBe("quiesce");
      expect(decision.theoreticalLane).toBe("discover");
      expect(decision.phaseMasked).toBe(true);
      expect(decision.reason).toBe("discover lane not implemented in Phase 2; returning quiesce");
      expect(deriveLane(facts)).toBe("quiesce");
      expect(deriveTheoreticalLane(facts)).toBe("discover");
    });

    it("unmasks discover lane when allowAdvanceAndDiscover is true or phase >= 3", () => {
      const facts: LaneSelectorFacts = { candidatesCount: 2 };
      const explicitDecision = selectLane(facts, { allowAdvanceAndDiscover: true });
      expect(explicitDecision.lane).toBe("discover");
      expect(explicitDecision.theoreticalLane).toBe("discover");
      expect(explicitDecision.phaseMasked).toBe(false);
      expect(explicitDecision.reason).toBe("discovery candidates available to explore");

      const phase4Decision = selectLane(facts, { phase: 4 });
      expect(phase4Decision.lane).toBe("discover");
      expect(phase4Decision.phaseMasked).toBe(false);
    });
  });

  describe("Quiesce Fallback & Priority Ordering", () => {
    it("returns quiesce when no work is pending across any lane", () => {
      const emptyFacts: LaneSelectorFacts = {};
      const decision = selectLane(emptyFacts);
      expect(decision.lane).toBe("quiesce");
      expect(decision.theoreticalLane).toBe("quiesce");
      expect(decision.reason).toBe("no pending actions across any lane");
      expect(decision.phaseMasked).toBe(false);
      expect(deriveLane(emptyFacts)).toBe("quiesce");
      expect(deriveTheoreticalLane(emptyFacts)).toBe("quiesce");
    });

    it("evaluates lane priority hierarchy correctly", () => {
      // Halted takes precedence over Defer and Rescue
      expect(selectLane({ mode: "halted", budgetDeferred: true, staleLeasesCount: 1 }).lane).toBe(
        "quiesce",
      );

      // Defer takes precedence over Rescue and Repair
      expect(
        selectLane({ isQuietHours: true, deadAgentsCount: 1, openFindingsCount: 1 }).lane,
      ).toBe("defer");

      // Rescue takes precedence over Repair and Ready tasks
      expect(
        selectLane({ staleLeasesCount: 1, openFindingsCount: 1, readyTasksCount: 1 }).lane,
      ).toBe("rescue");

      // Repair takes precedence over Ready tasks and Discovery
      expect(
        selectLane(
          { openFindingsCount: 1, readyTasksCount: 1, candidatesCount: 1 },
          { allowAdvanceAndDiscover: true },
        ).lane,
      ).toBe("repair");

      // Ready tasks (advance) takes precedence over Candidates (discover)
      expect(
        selectLane({ readyTasksCount: 1, candidatesCount: 1 }, { allowAdvanceAndDiscover: true })
          .lane,
      ).toBe("advance");
    });

    it("ignores non-triggering zero counts and sub-threshold values", () => {
      const nonTriggeringFacts: LaneSelectorFacts = {
        unrepairableIssuesCount: 0,
        consecutiveCrashes: 2,
        pulsesToday: 5,
        pulsesPerDay: 10,
        wallClockTodayMs: 1000,
        wallClockPerDayMs: 5000,
        staleLeasesCount: 0,
        deadAgentsCount: 0,
        integrityIssuesCount: 0,
        openFindingsCount: 0,
        failingGatesCount: 0,
        escalationsCount: 0,
        readyTasksCount: 0,
        dispatchableTasksCount: 0,
        candidatesCount: 0,
        unadmittedCandidatesCount: 0,
        admittedCandidatesCount: 0,
        hasDiscoveryWork: false,
        liveRuns: [
          {
            hasStaleLease: false,
            openFindingsCount: 0,
            failingGatesCount: 0,
            escalatedCount: 0,
            readyTasksCount: 0,
          },
        ],
      };
      const decision = selectLane(nonTriggeringFacts, { allowAdvanceAndDiscover: true });
      expect(decision.lane).toBe("quiesce");
      expect(decision.theoreticalLane).toBe("quiesce");
    });
  });
});
