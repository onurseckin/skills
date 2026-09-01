import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  MIND_CHARTER_INVARIANTS,
  auditAntiStagnationHealth,
  checkAntiStagnationDoctor,
  type AntiStagnationAuditReport,
  type AntiStagnationDoctorOptions,
} from "../../../olt/scripts/src/reporting/doctor/anti-stagnation/index.ts";
import {
  HistoricalDebateMemory,
  type StrategicCommitment,
  type StrategicResolution,
} from "../../../olt/scripts/src/mind/auditing/socratic/index.ts";
import {
  SupersessionIndex,
  type SupersessionIndexState,
} from "../../../olt/scripts/src/mind/memory/index.ts";
import {
  computeSnapshotChecksum,
  type SuspendedAnimationSnapshot,
} from "../../../olt/scripts/src/mind/lifecycle/index.ts";
import {
  createInitialDashboardState,
  type ExecutiveDashboardState,
} from "../../../olt/scripts/src/mind/reporting/index.ts";
import { runDoctor } from "../../../olt/scripts/src/reporting/doctor.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";

describe("Anti-Stagnation Doctor & Mind Charter Invariant Engine", () => {
  describe("5. Invariant 4: Anti-Make-Work & Genuine Value", () => {
    it("flags synthetic churn detected state as ANTI_MAKEWORK_GENUINE_VALUE violation", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          makework: {
            detected_churn: true,
            reason: "COSMETIC_CHURN: rename only without value",
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "ANTI_MAKEWORK_GENUINE_VALUE");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
    });

    it("warns when Mind experiences chronic zero-delta cycles (MIND_CREATIVE_STAGNATION)", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          pulse: {
            is_stagnant: true,
            error_code: "MIND_CREATIVE_STAGNATION",
            consecutive_zero_delta: 4,
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      const finding = result.findings.find((f) => f.code === "ANTI_MAKEWORK_GENUINE_VALUE");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("WARN");
      expect(finding?.message).toContain("MIND_CREATIVE_STAGNATION");
    });
  });

  describe("6. Invariant 5: Cumulative Socratic Progression & Debate Memory Integrity", () => {
    it("flags unfulfilled commitments without justification as CUMULATIVE_SOCRATIC_PROGRESSION violation", () => {
      const memory = new HistoricalDebateMemory(
        [],
        [
          {
            id: "comm-unjustified-1",
            topic: "Benchmark Invariant",
            agreedResolution: "Achieve 20% gain",
            targetMilestone: "M2",
            status: "breached",
            justification: "", // Missing justification
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      );

      const options: AntiStagnationDoctorOptions = {
        state: { mind: { generation: 1 } },
        socraticMemory: memory,
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "CUMULATIVE_SOCRATIC_PROGRESSION");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain(
        "unfulfilled strategic commitment(s) lack recorded justifications",
      );
    });

    it("passes when unfulfilled commitments have valid recorded justifications", () => {
      const memory = new HistoricalDebateMemory(
        [],
        [
          {
            id: "comm-justified-1",
            topic: "Benchmark Invariant",
            agreedResolution: "Achieve 20% gain",
            targetMilestone: "M2",
            status: "breached",
            justification:
              "Superseded by architectural simplification under Priority 2 Pareto ruling.",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      );

      const options: AntiStagnationDoctorOptions = {
        state: { mind: { generation: 1 } },
        socraticMemory: memory,
      };

      const result = checkAntiStagnationDoctor(options);
      const socraticViolations = result.findings.filter(
        (f) => f.code === "CUMULATIVE_SOCRATIC_PROGRESSION",
      );
      expect(socraticViolations).toHaveLength(0);
    });
  });

  describe("7. Invariant 6: Pre-Declared Pareto Arbitration", () => {
    it("flags Priority 4 Speculative Abstraction winning approach as PRE_DECLARED_PARETO_ARBITRATION violation", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          pareto: {
            recentArbitrations: [
              {
                id: "arb-bad-1",
                topic: "Indirection Layer",
                winningApproach: "Deep Factory Wrappers",
                chosenPriorityLevel: 4, // Forbidden Priority 4
                rationale: "Hypothetical future extensibility",
              },
            ],
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "PRE_DECLARED_PARETO_ARBITRATION");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("Speculative Abstraction");
    });

    it("flags deadlocked impasses > 2 without mandatory Crucible escalation", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          socratic: {
            consecutiveImpasseCycles: 4,
            requiresCrucible: false, // Crucible omitted despite deadlock
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "PRE_DECLARED_PARETO_ARBITRATION");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("Crucible escalation");
    });
  });

  describe("8. Invariant 7: Innovation Portfolio 70/20/10 Balance", () => {
    it("flags CORE_DEFICIT balance status as INNOVATION_PORTFOLIO_70_20_10 violation", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          portfolio: {
            balanceStatus: "CORE_DEFICIT",
            trackA_CoreStabilityAndPolish: { percentage: 25.0 },
            trackC_ExploratoryHorizonBets: { percentage: 40.0 },
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "INNOVATION_PORTFOLIO_70_20_10");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
    });
  });

  describe("9. Invariant 8: Ergonomic Walkthrough & Product Craft", () => {
    it("flags blocking aesthetic deficits as ERGONOMIC_WALKTHROUGH_AUDITING violation", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          product_craft: {
            ergonomicWalkthroughStatus: "DEFICIT_NOTICE",
            compositeCraftScore: 78.0,
            passThreshold: 85.0,
            openDeficits: { blockingCount: 2, totalOpen: 2 },
            microInteractionLatencyMs: 34.0,
            microInteractionTargetMs: 16.0,
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "ERGONOMIC_WALKTHROUGH_AUDITING");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("blocking aesthetic deficit");
    });
  });

  describe("10. Invariant 10: Epistemic Supersession Indexing Acyclicity", () => {
    it("detects cyclic lineage in supersession index graph", () => {
      const cyclicIndex = new SupersessionIndex([
        {
          id: "A",
          title: "Node A",
          status: "SUPERSEDED",
          supersededBy: "B",
          timestamp: new Date().toISOString(),
        },
        {
          id: "B",
          title: "Node B",
          status: "SUPERSEDED",
          supersededBy: "C",
          timestamp: new Date().toISOString(),
        },
        {
          id: "C",
          title: "Node C",
          status: "SUPERSEDED",
          supersededBy: "A",
          timestamp: new Date().toISOString(),
        }, // Cycle A -> B -> C -> A
      ]);

      const options: AntiStagnationDoctorOptions = {
        state: { mind: { generation: 1 } },
        supersessionIndex: cyclicIndex,
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "EPISTEMIC_SUPERSESSION_INDEXING");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("cycle(s) detected in supersession lineage graph");
    });

    it("passes cleanly when supersession index is strictly acyclic", () => {
      const acyclicIndex = new SupersessionIndex([
        {
          id: "A",
          title: "Node A",
          status: "SUPERSEDED",
          supersededBy: "B",
          timestamp: new Date().toISOString(),
        },
        {
          id: "B",
          title: "Node B",
          status: "SUPERSEDED",
          supersededBy: "C",
          timestamp: new Date().toISOString(),
        },
        { id: "C", title: "Node C", status: "ACTIVE", timestamp: new Date().toISOString() },
      ]);

      const options: AntiStagnationDoctorOptions = {
        state: { mind: { generation: 1 } },
        supersessionIndex: acyclicIndex,
      };

      const result = checkAntiStagnationDoctor(options);
      const supersessionViolations = result.findings.filter(
        (f) => f.code === "EPISTEMIC_SUPERSESSION_INDEXING",
      );
      expect(supersessionViolations).toHaveLength(0);
    });
  });
});
