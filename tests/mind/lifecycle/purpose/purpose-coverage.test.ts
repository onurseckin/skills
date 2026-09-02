import { describe, expect, it } from "bun:test";
import {
  evaluateStrategicCandidateAdmission,
  planProactiveRoadmap,
} from "../../../../olt/scripts/src/mind/lifecycle/purpose/purpose.ts";
import type { StrategicCandidate } from "../../../../olt/scripts/src/mind/lifecycle/purpose/types.ts";

describe("Strategic Purpose & Admission Gates Suite (purpose.ts)", () => {
  const validCandidate: StrategicCandidate = {
    id: "cand-1",
    title: "Implement High-Throughput Memory Buffer",
    objectiveStatement: "Verify zero memory leak under 10k pulses stress run",
    charterGoalIds: ["G1", "G2"],
    writeScope: ["olt/scripts/src/engine/store/memory"],
    source: "mind-governance-audit",
    estimatedComplexity: "MEDIUM",
  };

  describe("evaluateStrategicCandidateAdmission", () => {
    it("admits candidate when all 6 admission gates pass", () => {
      const result = evaluateStrategicCandidateAdmission([validCandidate], {
        charterGoals: ["G1", "G3"],
        activeScopes: ["olt/scripts/src/other"],
        declinedIds: ["cand-other"],
        maxAgentsInFlight: 4,
        currentAgentsInFlight: 2,
      });

      expect(result.evaluatedCount).toBe(1);
      expect(result.admittedCount).toBe(1);
      expect(result.declinedCount).toBe(0);
      expect(result.summary).toContain("1 evaluated, 1 admitted, 0 declined");

      const ev = result.evaluations[0]!;
      expect(ev.candidateId).toBe("cand-1");
      expect(ev.title).toBe("Implement High-Throughput Memory Buffer");
      expect(ev.gate1Witnessed).toBe(true);
      expect(ev.gate2InCharter).toBe(true);
      expect(ev.gate3Falsifiable).toBe(true);
      expect(ev.gate4DisjointScope).toBe(true);
      expect(ev.gate5BudgetOk).toBe(true);
      expect(ev.gate6NotDuplicate).toBe(true);
      expect(ev.admitted).toBe(true);
      expect(ev.failingGates).toEqual([]);
      expect(ev.decisionRationale).toContain("Candidate admitted across all 6 gates");
      expect(ev.assignedTier1Orchestrator).toBe("orchestrator_wave-next");
    });

    it("evaluates default options correctly with empty charter goals and scopes", () => {
      const result = evaluateStrategicCandidateAdmission([validCandidate]);
      expect(result.admittedCount).toBe(1);
      expect(result.evaluations[0]!.gate2InCharter).toBe(true);
      expect(result.evaluations[0]!.gate5BudgetOk).toBe(true);
    });

    it("fails Gate 1 when objectiveStatement is empty or whitespace", () => {
      const cand: StrategicCandidate = {
        ...validCandidate,
        id: "cand-g1",
        objectiveStatement: "   ",
      };
      const result = evaluateStrategicCandidateAdmission([cand]);
      const ev = result.evaluations[0]!;
      expect(ev.gate1Witnessed).toBe(false);
      expect(ev.gate3Falsifiable).toBe(false);
      expect(ev.failingGates).toContain(1);
      expect(ev.failingGates).toContain(3);
      expect(ev.admitted).toBe(false);
      expect(ev.assignedTier1Orchestrator).toBeUndefined();
    });

    it("fails Gate 2 when candidate does not cite any matching charter goal", () => {
      const cand: StrategicCandidate = {
        ...validCandidate,
        id: "cand-g2",
        charterGoalIds: ["GX", "GY"],
      };
      const result = evaluateStrategicCandidateAdmission([cand], {
        charterGoals: ["G1", "G2"],
      });
      const ev = result.evaluations[0]!;
      expect(ev.gate2InCharter).toBe(false);
      expect(ev.failingGates).toEqual([2]);
      expect(ev.decisionRationale).toContain("Gate violations: [Gate 2]");
    });

    it("fails Gate 3 when objectiveStatement is too short (<10 chars)", () => {
      const cand: StrategicCandidate = {
        ...validCandidate,
        id: "cand-g3",
        objectiveStatement: "Fix bug",
      };
      const result = evaluateStrategicCandidateAdmission([cand]);
      const ev = result.evaluations[0]!;
      expect(ev.gate1Witnessed).toBe(true);
      expect(ev.gate3Falsifiable).toBe(false);
      expect(ev.failingGates).toEqual([3]);
    });

    it("fails Gate 4 when writeScope collides with active write scopes", () => {
      const cand: StrategicCandidate = {
        ...validCandidate,
        id: "cand-g4",
        writeScope: ["olt/scripts/src/engine", "olt/roles"],
      };
      const result = evaluateStrategicCandidateAdmission([cand], {
        activeScopes: ["olt/scripts/src/engine"],
      });
      const ev = result.evaluations[0]!;
      expect(ev.gate4DisjointScope).toBe(false);
      expect(ev.failingGates).toEqual([4]);
    });

    it("passes Gate 4 when candidate writeScope is empty", () => {
      const cand: StrategicCandidate = {
        ...validCandidate,
        id: "cand-g4-empty",
        writeScope: [],
      };
      const result = evaluateStrategicCandidateAdmission([cand], {
        activeScopes: ["olt/scripts/src/engine"],
      });
      expect(result.evaluations[0]!.gate4DisjointScope).toBe(true);
      expect(result.evaluations[0]!.admitted).toBe(true);
    });

    it("fails Gate 5 when current agents in flight meets or exceeds max capacity", () => {
      const cand: StrategicCandidate = { ...validCandidate, id: "cand-g5" };
      const result = evaluateStrategicCandidateAdmission([cand], {
        maxAgentsInFlight: 4,
        currentAgentsInFlight: 4,
      });
      const ev = result.evaluations[0]!;
      expect(ev.gate5BudgetOk).toBe(false);
      expect(ev.failingGates).toEqual([5]);
    });

    it("fails Gate 6 when candidate ID is in declinedIds set", () => {
      const cand: StrategicCandidate = { ...validCandidate, id: "cand-declined-1" };
      const result = evaluateStrategicCandidateAdmission([cand], {
        declinedIds: ["cand-declined-1"],
      });
      const ev = result.evaluations[0]!;
      expect(ev.gate6NotDuplicate).toBe(false);
      expect(ev.failingGates).toEqual([6]);
    });

    it("evaluates a batch of mixed passing and failing candidates", () => {
      const cand1: StrategicCandidate = { ...validCandidate, id: "cand-pass" };
      const cand2: StrategicCandidate = {
        ...validCandidate,
        id: "cand-fail",
        objectiveStatement: "short",
      };

      const result = evaluateStrategicCandidateAdmission([cand1, cand2]);
      expect(result.evaluatedCount).toBe(2);
      expect(result.admittedCount).toBe(1);
      expect(result.declinedCount).toBe(1);
      expect(result.summary).toBe("Candidate Admission: 2 evaluated, 1 admitted, 1 declined.");
    });
  });

  describe("planProactiveRoadmap", () => {
    it("synthesizes proactive roadmap plan with default options", () => {
      const plan = planProactiveRoadmap();
      expect(plan.fleetId).toMatch(/^fleet-future-/);
      expect(plan.targetHorizonHours).toBe(2.5);
      expect(plan.targetHorizonMs).toBe(9_000_000);
      expect(new Date(plan.plannedAt).getTime()).toBeGreaterThan(0);
      expect(plan.waves).toHaveLength(2);

      // Wave 1 defaults
      expect(plan.waves[0]!.waveNumber).toBe(1);
      expect(plan.waves[0]!.title).toContain("Strategic Foundations");
      expect(plan.waves[0]!.isolatedWriteScopes).toEqual(["olt/scripts/src/core", "olt/roles"]);
      expect(plan.waves[0]!.atomicTasks).toHaveLength(2);
      expect(plan.waves[0]!.atomicTasks[0]!.taskId).toBe("task-strategic-foundation-1");
      expect(plan.waves[0]!.atomicTasks[0]!.role).toBe("implementer");
      expect(plan.waves[0]!.atomicTasks[0]!.estimatedDurationMs).toBe(900_000);

      // Wave 2 defaults
      expect(plan.waves[1]!.waveNumber).toBe(2);
      expect(plan.waves[1]!.title).toContain("Multi-Viewport Validation");
      expect(plan.waves[1]!.isolatedWriteScopes).toEqual(["tests/unit/mind", "tests/unit/roles"]);
      expect(plan.waves[1]!.atomicTasks).toHaveLength(2);
      expect(plan.waves[1]!.atomicTasks[0]!.role).toBe("validator");
      expect(plan.waves[1]!.atomicTasks[0]!.estimatedDurationMs).toBe(600_000);

      expect(plan.totalTasks).toBe(4);
      expect(plan.maxParallelism).toBe(2);
      expect(plan.proactiveStrategy).toContain("Proactive Roadmap synthesized for Fleet");
      expect(plan.proactiveStrategy).toContain("peak topological concurrency P = 2");
    });

    it("populates Wave 1 tasks from admittedCandidates", () => {
      const candidates: StrategicCandidate[] = [
        {
          id: "cand-a",
          title: "Optimize JSON Serialization",
          objectiveStatement: "Verify 10x throughput on JSON streaming",
          charterGoalIds: ["G1"],
          writeScope: ["olt/core"],
          source: "audit",
          estimatedComplexity: "LOW",
        },
        {
          id: "cand-b",
          title: "Refactor Lock Manager",
          objectiveStatement: "Verify zero deadlock in advisory lock",
          charterGoalIds: ["G1"],
          writeScope: ["olt/lock"],
          source: "audit",
          estimatedComplexity: "HIGH",
        },
        {
          id: "cand-c",
          title: "Add Metric Exporting",
          objectiveStatement: "Verify prometheus format metrics",
          charterGoalIds: ["G2"],
          writeScope: ["olt/metrics"],
          source: "audit",
          estimatedComplexity: "LOW",
        },
      ];

      const plan = planProactiveRoadmap({
        fleetId: "fleet-custom-101",
        targetHorizonHours: 4.0,
        admittedCandidates: candidates,
      });

      expect(plan.fleetId).toBe("fleet-custom-101");
      expect(plan.targetHorizonHours).toBe(4.0);
      expect(plan.targetHorizonMs).toBe(14_400_000);
      expect(plan.waves[0]!.atomicTasks).toHaveLength(3);
      expect(plan.waves[0]!.atomicTasks[0]!.taskId).toBe("task-cand-a");
      expect(plan.waves[0]!.atomicTasks[0]!.description).toBe("Optimize JSON Serialization");
      expect(plan.waves[0]!.atomicTasks[1]!.taskId).toBe("task-cand-b");
      expect(plan.waves[0]!.atomicTasks[2]!.taskId).toBe("task-cand-c");
      expect(plan.waves[0]!.estimatedParallelism).toBe(3);
      expect(plan.totalTasks).toBe(5); // 3 in Wave 1 + 2 in Wave 2
      expect(plan.maxParallelism).toBe(3);
    });

    it("populates Wave 1 tasks from backlogPriorities up to 3 tasks when admittedCandidates empty", () => {
      const priorities = [
        "Priority 1: Hardened Telemetry",
        "Priority 2: Subordinate Lease Renewal",
        "Priority 3: Crash Recovery Journal",
        "Priority 4: Unreached Overflow Priority",
      ];

      const plan = planProactiveRoadmap({
        backlogPriorities: priorities,
      });

      expect(plan.waves[0]!.atomicTasks).toHaveLength(3);
      expect(plan.waves[0]!.atomicTasks[0]!.taskId).toBe("task-prio-1");
      expect(plan.waves[0]!.atomicTasks[0]!.description).toBe("Priority 1: Hardened Telemetry");
      expect(plan.waves[0]!.atomicTasks[1]!.taskId).toBe("task-prio-2");
      expect(plan.waves[0]!.atomicTasks[2]!.taskId).toBe("task-prio-3");
    });
  });
});
