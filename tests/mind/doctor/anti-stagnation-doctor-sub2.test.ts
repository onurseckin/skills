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
let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(join(process.cwd(), "tmp-doctor-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

describe("4. Invariant 3: Three-Strike Mechanical Containment", () => {
    it("flags agent with 3 strikes that remains active as THREE_STRIKE_MECHANICAL_CONTAINMENT violation", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          strikes: {
            "impl-flaky-1": {
              count: 3,
              status: "active",
            },
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "THREE_STRIKE_MECHANICAL_CONTAINMENT");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("impl-flaky-1");
    });
  });

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
      const memory = new HistoricalDebateMemory([], [
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
      ]);

      const options: AntiStagnationDoctorOptions = {
        state: { mind: { generation: 1 } },
        socraticMemory: memory,
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "CUMULATIVE_SOCRATIC_PROGRESSION");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("unfulfilled strategic commitment(s) lack recorded justifications");
    });

    it("passes when unfulfilled commitments have valid recorded justifications", () => {
      const memory = new HistoricalDebateMemory([], [
        {
          id: "comm-justified-1",
          topic: "Benchmark Invariant",
          agreedResolution: "Achieve 20% gain",
          targetMilestone: "M2",
          status: "breached",
          justification: "Superseded by architectural simplification under Priority 2 Pareto ruling.",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const options: AntiStagnationDoctorOptions = {
        state: { mind: { generation: 1 } },
        socraticMemory: memory,
      };

      const result = checkAntiStagnationDoctor(options);
      const socraticViolations = result.findings.filter((f) => f.code === "CUMULATIVE_SOCRATIC_PROGRESSION");
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
});
