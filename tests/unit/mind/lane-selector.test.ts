import { describe, expect, test } from "bun:test";
import {
  deriveLane,
  deriveTheoreticalLane,
  selectLane,
  type LaneSelectorFacts,
  type MindLane,
} from "../../../orchestrating-long-tasks/scripts/src/mind/lane.ts";

describe("lane.ts — Pure Lane Selector", () => {
  describe("Table tests across conditions and boundaries", () => {
    interface TableCase {
      readonly description: string;
      readonly facts: LaneSelectorFacts;
      readonly expectedPhase2Lane: MindLane;
      readonly expectedTheoreticalLane: MindLane;
      readonly expectedPhaseMasked?: boolean;
    }

    const tableCases: readonly TableCase[] = [
      {
        description: "completely empty facts defaults to quiesce",
        facts: {},
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "quiesce",
        expectedPhaseMasked: false,
      },
      {
        description: "all counts zero and mode idle returns quiesce",
        facts: {
          mode: "idle",
          budgetDeferred: false,
          isQuietHours: false,
          staleLeasesCount: 0,
          deadAgentsCount: 0,
          openFindingsCount: 0,
          failingGatesCount: 0,
          escalationsCount: 0,
          readyTasksCount: 0,
          candidatesCount: 0,
          liveRuns: [],
        },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "quiesce",
        expectedPhaseMasked: false,
      },
      // Preconditions: Halt
      {
        description: "mode halted returns quiesce",
        facts: { mode: "halted" },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "quiesce",
        expectedPhaseMasked: false,
      },
      {
        description: "charter DRIFTED returns quiesce",
        facts: { charterStatus: "DRIFTED" },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "quiesce",
        expectedPhaseMasked: false,
      },
      {
        description: "charter missing returns quiesce",
        facts: { charterStatus: "missing" },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "quiesce",
        expectedPhaseMasked: false,
      },
      {
        description: "integrity FAILED returns quiesce",
        facts: { integrityStatus: "FAILED" },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "quiesce",
        expectedPhaseMasked: false,
      },
      {
        description: "unrepairable integrity issues > 0 returns quiesce",
        facts: { unrepairableIssuesCount: 2 },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "quiesce",
        expectedPhaseMasked: false,
      },
      {
        description: "consecutive crashes >= 3 returns quiesce",
        facts: { consecutiveCrashes: 3 },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "quiesce",
        expectedPhaseMasked: false,
      },
      // Preconditions: Defer
      {
        description: "budgetDeferred flag true returns defer",
        facts: { budgetDeferred: true },
        expectedPhase2Lane: "defer",
        expectedTheoreticalLane: "defer",
        expectedPhaseMasked: false,
      },
      {
        description: "isQuietHours flag true returns defer",
        facts: { isQuietHours: true },
        expectedPhase2Lane: "defer",
        expectedTheoreticalLane: "defer",
        expectedPhaseMasked: false,
      },
      {
        description: "mode paused returns defer",
        facts: { mode: "paused" },
        expectedPhase2Lane: "defer",
        expectedTheoreticalLane: "defer",
        expectedPhaseMasked: false,
      },
      {
        description: "pulses today >= pulses per day boundary returns defer",
        facts: { pulsesToday: 96, pulsesPerDay: 96 },
        expectedPhase2Lane: "defer",
        expectedTheoreticalLane: "defer",
        expectedPhaseMasked: false,
      },
      {
        description: "pulses today < pulses per day boundary does not defer",
        facts: { pulsesToday: 95, pulsesPerDay: 96 },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "quiesce",
        expectedPhaseMasked: false,
      },
      {
        description: "wall clock today >= wall clock per day boundary returns defer",
        facts: { wallClockTodayMs: 21_600_000, wallClockPerDayMs: 21_600_000 },
        expectedPhase2Lane: "defer",
        expectedTheoreticalLane: "defer",
        expectedPhaseMasked: false,
      },
      {
        description: "wall clock today < wall clock per day boundary does not defer",
        facts: { wallClockTodayMs: 21_599_999, wallClockPerDayMs: 21_600_000 },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "quiesce",
        expectedPhaseMasked: false,
      },
      // Priority 1: RESCUE
      {
        description: "staleLeasesCount > 0 returns rescue",
        facts: { staleLeasesCount: 1 },
        expectedPhase2Lane: "rescue",
        expectedTheoreticalLane: "rescue",
        expectedPhaseMasked: false,
      },
      {
        description: "live run with hasStaleLease returns rescue",
        facts: {
          liveRuns: [
            {
              runId: "run-1",
              hasStaleLease: true,
              tasksCount: 2,
              leasedCount: 1,
              escalatedCount: 0,
              greenGatesCount: 0,
              totalGatesCount: 1,
              readyTasksCount: 0,
              openFindingsCount: 0,
              failingGatesCount: 0,
            },
          ],
        },
        expectedPhase2Lane: "rescue",
        expectedTheoreticalLane: "rescue",
        expectedPhaseMasked: false,
      },
      {
        description: "deadAgentsCount > 0 returns rescue",
        facts: { deadAgentsCount: 1 },
        expectedPhase2Lane: "rescue",
        expectedTheoreticalLane: "rescue",
        expectedPhaseMasked: false,
      },
      {
        description: "integrityStatus repairable returns rescue",
        facts: { integrityStatus: "repairable" },
        expectedPhase2Lane: "rescue",
        expectedTheoreticalLane: "rescue",
        expectedPhaseMasked: false,
      },
      {
        description: "integrityIssuesCount > 0 (repairable) returns rescue",
        facts: { integrityIssuesCount: 1 },
        expectedPhase2Lane: "rescue",
        expectedTheoreticalLane: "rescue",
        expectedPhaseMasked: false,
      },
      // Priority 2: REPAIR
      {
        description: "openFindingsCount > 0 returns repair",
        facts: { openFindingsCount: 2 },
        expectedPhase2Lane: "repair",
        expectedTheoreticalLane: "repair",
        expectedPhaseMasked: false,
      },
      {
        description: "live run with open findings returns repair",
        facts: {
          liveRuns: [
            {
              runId: "run-2",
              openFindingsCount: 1,
              hasStaleLease: false,
              failingGatesCount: 0,
              escalatedCount: 0,
            },
          ],
        },
        expectedPhase2Lane: "repair",
        expectedTheoreticalLane: "repair",
        expectedPhaseMasked: false,
      },
      {
        description: "failingGatesCount > 0 returns repair",
        facts: { failingGatesCount: 1 },
        expectedPhase2Lane: "repair",
        expectedTheoreticalLane: "repair",
        expectedPhaseMasked: false,
      },
      {
        description: "live run with failing gates returns repair",
        facts: {
          liveRuns: [
            {
              runId: "run-3",
              failingGatesCount: 2,
              hasStaleLease: false,
              openFindingsCount: 0,
              escalatedCount: 0,
            },
          ],
        },
        expectedPhase2Lane: "repair",
        expectedTheoreticalLane: "repair",
        expectedPhaseMasked: false,
      },
      {
        description: "escalationsCount > 0 returns repair",
        facts: { escalationsCount: 1 },
        expectedPhase2Lane: "repair",
        expectedTheoreticalLane: "repair",
        expectedPhaseMasked: false,
      },
      {
        description: "live run with escalated task returns repair",
        facts: {
          liveRuns: [
            {
              runId: "run-4",
              escalatedCount: 1,
              hasStaleLease: false,
              openFindingsCount: 0,
              failingGatesCount: 0,
            },
          ],
        },
        expectedPhase2Lane: "repair",
        expectedTheoreticalLane: "repair",
        expectedPhaseMasked: false,
      },
      // Priority 3: ADVANCE (Phase 2 returns quiesce with phaseMasked: true)
      {
        description: "readyTasksCount > 0 in Phase 2 returns quiesce (advance masked)",
        facts: { readyTasksCount: 3 },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "advance",
        expectedPhaseMasked: true,
      },
      {
        description: "dispatchableTasksCount > 0 in Phase 2 returns quiesce (advance masked)",
        facts: { dispatchableTasksCount: 1 },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "advance",
        expectedPhaseMasked: true,
      },
      {
        description: "live run with ready tasks in Phase 2 returns quiesce (advance masked)",
        facts: {
          liveRuns: [
            {
              runId: "run-5",
              readyTasksCount: 2,
              hasStaleLease: false,
              openFindingsCount: 0,
              failingGatesCount: 0,
              escalatedCount: 0,
            },
          ],
        },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "advance",
        expectedPhaseMasked: true,
      },
      // Priority 4: DISCOVER (Phase 2 returns quiesce with phaseMasked: true)
      {
        description: "candidatesCount > 0 in Phase 2 returns quiesce (discover masked)",
        facts: { candidatesCount: 1 },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "discover",
        expectedPhaseMasked: true,
      },
      {
        description: "unadmittedCandidatesCount > 0 in Phase 2 returns quiesce (discover masked)",
        facts: { unadmittedCandidatesCount: 2 },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "discover",
        expectedPhaseMasked: true,
      },
      {
        description: "hasDiscoveryWork true in Phase 2 returns quiesce (discover masked)",
        facts: { hasDiscoveryWork: true },
        expectedPhase2Lane: "quiesce",
        expectedTheoreticalLane: "discover",
        expectedPhaseMasked: true,
      },
    ];

    for (const {
      description,
      facts,
      expectedPhase2Lane,
      expectedTheoreticalLane,
      expectedPhaseMasked,
    } of tableCases) {
      test(`Table test: ${description}`, () => {
        const lane = deriveLane(facts);
        expect(lane).toBe(expectedPhase2Lane);

        const theoretical = deriveTheoreticalLane(facts);
        expect(theoretical).toBe(expectedTheoreticalLane);

        const decision = selectLane(facts);
        expect(decision.lane).toBe(expectedPhase2Lane);
        expect(decision.theoreticalLane).toBe(expectedTheoreticalLane);
        if (expectedPhaseMasked !== undefined) {
          expect(decision.phaseMasked).toBe(expectedPhaseMasked);
        }
      });
    }
  });

  describe("Priority Order Enforcement (rescue -> repair -> advance -> discover)", () => {
    test("RESCUE takes precedence over REPAIR", () => {
      const facts: LaneSelectorFacts = {
        staleLeasesCount: 1,
        openFindingsCount: 3,
        failingGatesCount: 2,
        escalationsCount: 1,
      };
      expect(deriveLane(facts)).toBe("rescue");
      expect(deriveTheoreticalLane(facts)).toBe("rescue");
    });

    test("RESCUE takes precedence over ADVANCE", () => {
      const facts: LaneSelectorFacts = {
        deadAgentsCount: 1,
        readyTasksCount: 5,
      };
      expect(deriveLane(facts)).toBe("rescue");
      expect(deriveTheoreticalLane(facts)).toBe("rescue");
    });

    test("RESCUE takes precedence over DISCOVER", () => {
      const facts: LaneSelectorFacts = {
        integrityStatus: "repairable",
        candidatesCount: 4,
        hasDiscoveryWork: true,
      };
      expect(deriveLane(facts)).toBe("rescue");
      expect(deriveTheoreticalLane(facts)).toBe("rescue");
    });

    test("REPAIR takes precedence over ADVANCE", () => {
      const facts: LaneSelectorFacts = {
        staleLeasesCount: 0,
        deadAgentsCount: 0,
        openFindingsCount: 1,
        readyTasksCount: 4,
      };
      expect(deriveLane(facts)).toBe("repair");
      expect(deriveTheoreticalLane(facts)).toBe("repair");
    });

    test("REPAIR takes precedence over DISCOVER", () => {
      const facts: LaneSelectorFacts = {
        staleLeasesCount: 0,
        deadAgentsCount: 0,
        failingGatesCount: 1,
        candidatesCount: 2,
      };
      expect(deriveLane(facts)).toBe("repair");
      expect(deriveTheoreticalLane(facts)).toBe("repair");
    });

    test("ADVANCE takes precedence over DISCOVER (when advance is enabled)", () => {
      const facts: LaneSelectorFacts = {
        staleLeasesCount: 0,
        deadAgentsCount: 0,
        openFindingsCount: 0,
        failingGatesCount: 0,
        escalationsCount: 0,
        readyTasksCount: 1,
        candidatesCount: 3,
      };
      // In Phase 2, both return quiesce
      expect(deriveLane(facts)).toBe("quiesce");
      // Theoretically (Phase 3+), advance wins
      expect(deriveTheoreticalLane(facts)).toBe("advance");
      expect(deriveLane(facts, { allowAdvanceAndDiscover: true })).toBe("advance");
    });

    test("DISCOVER is strictly UNREACHABLE while any prior lane (rescue, repair, advance) is non-empty", () => {
      const candidateFacts: LaneSelectorFacts = {
        candidatesCount: 5,
        hasDiscoveryWork: true,
      };

      // 1. Non-empty rescue blocks discover
      const rescueBlocked: LaneSelectorFacts = { ...candidateFacts, staleLeasesCount: 1 };
      expect(deriveTheoreticalLane(rescueBlocked)).toBe("rescue");

      const deadAgentBlocked: LaneSelectorFacts = { ...candidateFacts, deadAgentsCount: 1 };
      expect(deriveTheoreticalLane(deadAgentBlocked)).toBe("rescue");

      const integrityBlocked: LaneSelectorFacts = {
        ...candidateFacts,
        integrityStatus: "repairable",
      };
      expect(deriveTheoreticalLane(integrityBlocked)).toBe("rescue");

      // 2. Non-empty repair blocks discover
      const findingsBlocked: LaneSelectorFacts = { ...candidateFacts, openFindingsCount: 1 };
      expect(deriveTheoreticalLane(findingsBlocked)).toBe("repair");

      const gatesBlocked: LaneSelectorFacts = { ...candidateFacts, failingGatesCount: 1 };
      expect(deriveTheoreticalLane(gatesBlocked)).toBe("repair");

      const escalationBlocked: LaneSelectorFacts = { ...candidateFacts, escalationsCount: 1 };
      expect(deriveTheoreticalLane(escalationBlocked)).toBe("repair");

      // 3. Non-empty advance blocks discover
      const readyTasksBlocked: LaneSelectorFacts = { ...candidateFacts, readyTasksCount: 1 };
      expect(deriveTheoreticalLane(readyTasksBlocked)).toBe("advance");

      // 4. Only when 1, 2, and 3 are all provably empty is discover reached
      const cleanDiscovery: LaneSelectorFacts = {
        staleLeasesCount: 0,
        deadAgentsCount: 0,
        openFindingsCount: 0,
        failingGatesCount: 0,
        escalationsCount: 0,
        readyTasksCount: 0,
        candidatesCount: 5,
      };
      expect(deriveTheoreticalLane(cleanDiscovery)).toBe("discover");
    });
  });

  describe("Phase 2 Specific Behaviors", () => {
    test("Phase 2 returns quiesce for advance and discover without claiming success", () => {
      const advanceFacts: LaneSelectorFacts = { readyTasksCount: 2 };
      const advanceDecision = selectLane(advanceFacts, { phase: 2 });
      expect(advanceDecision.lane).toBe("quiesce");
      expect(advanceDecision.theoreticalLane).toBe("advance");
      expect(advanceDecision.phaseMasked).toBe(true);

      const discoverFacts: LaneSelectorFacts = { candidatesCount: 1 };
      const discoverDecision = selectLane(discoverFacts, { phase: 2 });
      expect(discoverDecision.lane).toBe("quiesce");
      expect(discoverDecision.theoreticalLane).toBe("discover");
      expect(discoverDecision.phaseMasked).toBe(true);
    });

    test("Phase 3 enables advance and discover", () => {
      const advanceFacts: LaneSelectorFacts = { readyTasksCount: 2 };
      expect(deriveLane(advanceFacts, { phase: 3 })).toBe("advance");

      const discoverFacts: LaneSelectorFacts = { candidatesCount: 1 };
      expect(deriveLane(discoverFacts, { phase: 3 })).toBe("discover");
    });
  });

  describe("Purity and Boundary Invariants", () => {
    test("deriveLane is a pure deterministic function with no side-effects", () => {
      const facts: LaneSelectorFacts = Object.freeze({
        mode: "idle",
        staleLeasesCount: 1,
        openFindingsCount: 2,
        readyTasksCount: 3,
        liveRuns: Object.freeze([
          Object.freeze({
            runId: "run-frozen",
            hasStaleLease: true,
            openFindingsCount: 1,
            readyTasksCount: 2,
          }),
        ]),
      });

      // Idempotency: multiple calls produce identical results
      const run1 = deriveLane(facts);
      const run2 = deriveLane(facts);
      const run3 = deriveLane(facts);
      expect(run1).toBe("rescue");
      expect(run2).toBe("rescue");
      expect(run3).toBe("rescue");

      const decision1 = selectLane(facts);
      const decision2 = selectLane(facts);
      expect(decision1).toEqual(decision2);
    });

    test("boundary testing consecutive crashes: 2 does not halt, 3 halts to quiesce", () => {
      const facts2: LaneSelectorFacts = { consecutiveCrashes: 2, staleLeasesCount: 1 };
      expect(deriveLane(facts2)).toBe("rescue");

      const facts3: LaneSelectorFacts = { consecutiveCrashes: 3, staleLeasesCount: 1 };
      expect(deriveLane(facts3)).toBe("quiesce");
    });

    test("boundary testing pulsesToday vs pulsesPerDay", () => {
      const belowLimit: LaneSelectorFacts = {
        pulsesToday: 41,
        pulsesPerDay: 96,
        staleLeasesCount: 1,
      };
      expect(deriveLane(belowLimit)).toBe("rescue");

      const atLimit: LaneSelectorFacts = { pulsesToday: 96, pulsesPerDay: 96, staleLeasesCount: 1 };
      expect(deriveLane(atLimit)).toBe("defer");

      const aboveLimit: LaneSelectorFacts = {
        pulsesToday: 97,
        pulsesPerDay: 96,
        staleLeasesCount: 1,
      };
      expect(deriveLane(aboveLimit)).toBe("defer");
    });

    test("boundary testing wallClockTodayMs vs wallClockPerDayMs", () => {
      const belowLimit: LaneSelectorFacts = {
        wallClockTodayMs: 21_599_999,
        wallClockPerDayMs: 21_600_000,
        openFindingsCount: 1,
      };
      expect(deriveLane(belowLimit)).toBe("repair");

      const atLimit: LaneSelectorFacts = {
        wallClockTodayMs: 21_600_000,
        wallClockPerDayMs: 21_600_000,
        openFindingsCount: 1,
      };
      expect(deriveLane(atLimit)).toBe("defer");
    });
  });
});
