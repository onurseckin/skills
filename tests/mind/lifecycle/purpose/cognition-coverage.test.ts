import { describe, expect, it } from "bun:test";
import {
  executeProactiveMindCognition,
  formatStrategicCognitionBrief,
  verifyMindRoleStrategicInvariants,
} from "../../../../olt/scripts/src/mind/lifecycle/purpose/cognition.ts";
import type {
  MacroDagTaskNode,
  ProactiveMindCognitionResult,
  StrategicCandidate,
} from "../../../../olt/scripts/src/mind/lifecycle/purpose/types.ts";
import { MIND_STRATEGIC_ALTITUDE } from "../../../../olt/scripts/src/mind/lifecycle/purpose/types.ts";

describe("Tier 0 Mind Proactive Cognition Suite (cognition.ts)", () => {
  const sampleNodes: MacroDagTaskNode[] = [
    {
      taskId: "t1",
      role: "architect",
      status: "completed",
      durationEstimateMs: 5000,
      dependencies: [],
      writeScope: ["src/core"],
    },
    {
      taskId: "t2",
      role: "engineer",
      status: "ready",
      durationEstimateMs: 10000,
      dependencies: ["t1"],
      writeScope: ["src/feature"],
    },
    {
      taskId: "t3",
      role: "tester",
      status: "pending",
      durationEstimateMs: 8000,
      dependencies: ["t2"],
      writeScope: ["tests/feature"],
    },
  ];

  const sampleCandidate: StrategicCandidate = {
    id: "cand-101",
    title: "Implement Stream Backpressure",
    objectiveStatement: "Add reactive stream buffering to prevent memory exhaustion",
    charterGoalIds: ["GOAL-STABILITY"],
    writeScope: ["src/streams"],
  };

  const sampleCandidateDeclined: StrategicCandidate = {
    id: "cand-declined",
    title: "Unsupported Feature",
    objectiveStatement: "Feature that is out of charter and blocked",
    charterGoalIds: ["UNKNOWN-GOAL"],
    writeScope: ["src/other"],
  };

  describe("executeProactiveMindCognition", () => {
    it("executes proactively with default parameters and 2-hour window", () => {
      const result = executeProactiveMindCognition();
      expect(result.altitude).toBe(MIND_STRATEGIC_ALTITUDE);
      expect(result.subordinateExecutionWindowMs).toBe(7_200_000);
      expect(result.subordinateExecutionWindowHours).toBe(2);
      expect(result.macroDag.totalNodes).toBe(0);
      expect(result.backlogGrooming.scannedCount).toBe(0);
      expect(result.candidateAdmission.evaluatedCount).toBe(0);
      expect(result.proactiveRoadmap.waves.length).toBeGreaterThan(0);
      expect(result.strategicSummary).toContain(
        "[Mind 30,000ft Cognition] Utilized 2h subordinate execution window:",
      );
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });

    it("executes proactive cognition across custom nodes, backlog, candidates and horizon", () => {
      const result = executeProactiveMindCognition({
        subordinateExecutionWindowMs: 14_400_000,
        nodes: sampleNodes,
        rawBacklog: [
          {
            id: "fb-1",
            title: "Improve error handling",
            category: "BUG",
            priority: "HIGH",
            source: "telemetry",
            status: "actionable",
          },
        ],
        charterGoals: ["GOAL-STABILITY"],
        candidates: [sampleCandidate, sampleCandidateDeclined],
        activeScopes: ["src/active"],
        declinedIds: ["cand-declined"],
        fleetId: "fleet-beta",
        targetHorizonHours: 6.0,
      });

      expect(result.subordinateExecutionWindowMs).toBe(14_400_000);
      expect(result.subordinateExecutionWindowHours).toBe(4);
      expect(result.macroDag.totalNodes).toBe(3);
      expect(result.backlogGrooming.scannedCount).toBe(1);
      expect(result.candidateAdmission.evaluatedCount).toBe(2);
      expect(result.candidateAdmission.admittedCount).toBe(1);
      expect(result.candidateAdmission.declinedCount).toBe(1);
      expect(result.proactiveRoadmap.targetHorizonHours).toBe(6.0);
      expect(result.strategicSummary).toContain("Utilized 4h subordinate execution window:");
      expect(result.strategicSummary).toContain("Admissions (1/2 admitted)");
    });
  });

  describe("formatStrategicCognitionBrief", () => {
    it("formats markdown brief with bottlenecks, admitted candidates, and roadmap waves", () => {
      const mockResult: ProactiveMindCognitionResult = {
        timestamp: "2026-09-01T20:00:00.000Z",
        altitude: MIND_STRATEGIC_ALTITUDE,
        subordinateExecutionWindowMs: 7_200_000,
        subordinateExecutionWindowHours: 2.0,
        macroDag: {
          totalNodes: 5,
          readyNodes: 2,
          leasedNodes: 1,
          completedNodes: 2,
          failedNodes: 0,
          criticalPathLength: 3,
          totalWorkMs: 25000,
          criticalSpanMs: 15000,
          workSpanRatio: 1.67,
          concurrencyRecommendation: 2,
          bottlenecks: [
            {
              taskId: "t-bn",
              type: "critical_path",
              description: "Longest chain",
              suggestedMitigation: "Split subtasks",
            },
          ],
          subagentAllocations: { default: 2 },
        },
        backlogGrooming: {
          scannedCount: 4,
          actionableCount: 2,
          dormantCount: 1,
          reconciledCount: 1,
          prunedCount: 0,
          items: [],
          strategicPriorities: ["Resolve critical memory bottleneck", "Migrate legacy queue"],
          groomingSummary: "Scanned 4 items, 2 actionable prioritized",
        },
        candidateAdmission: {
          evaluatedCount: 2,
          admittedCount: 1,
          declinedCount: 1,
          evaluations: [
            {
              candidateId: "c1",
              title: "C1",
              gate1Witnessed: true,
              gate2InCharter: true,
              gate3Falsifiable: true,
              gate4DisjointScope: true,
              gate5BudgetOk: true,
              gate6NotDuplicate: true,
              admitted: true,
              failingGates: [],
              decisionRationale: "Passes all gates",
            },
            {
              candidateId: "c2",
              title: "C2",
              gate1Witnessed: false,
              gate2InCharter: false,
              gate3Falsifiable: false,
              gate4DisjointScope: false,
              gate5BudgetOk: false,
              gate6NotDuplicate: false,
              admitted: false,
              failingGates: [1, 2],
              decisionRationale: "Missing charter alignment",
            },
          ],
          summary: "1 admitted, 1 declined",
        },
        proactiveRoadmap: {
          fleetId: "fleet-100",
          targetHorizonHours: 2.0,
          totalTasks: 1,
          proactiveStrategy: "Staged execution roadmap for upcoming fleet",
          waves: [
            {
              waveIndex: 1,
              title: "Wave 1: Foundation",
              estimatedParallelism: 3,
              atomicTasks: [
                {
                  taskId: "w1-t1",
                  role: "builder",
                  description: "Setup store",
                  writeScope: ["src/store"],
                  dependencies: [],
                },
              ],
            },
          ],
        },
        strategicSummary: "Executed 2h cognition successfully",
      };

      const brief = formatStrategicCognitionBrief(mockResult);
      expect(brief).toContain("### 🧠 Tier 0 Mind Strategic Cognition (Altitude: 30,000 feet)");
      expect(brief).toContain("**Subordinate Execution Window**: 2h (7200000ms)");
      expect(brief).toContain("📊 Macro DAG Diagnostics");
      expect(brief).toContain("`t-bn` [critical_path]: Longest chain");
      expect(brief).toContain("📋 Backlog Grooming & Strategic Priorities");
      expect(brief).toContain("* Resolve critical memory bottleneck");
      expect(brief).toContain("🛡️ Candidate Admission Pre-Evaluation");
      expect(brief).toContain("`c1`: ✅ ADMITTED — Passes all gates");
      expect(brief).toContain("`c2`: ❌ DECLINED — Missing charter alignment");
      expect(brief).toContain("🚀 Proactive Roadmap Planning for Future Fleets");
      expect(brief).toContain("**Wave 1: Foundation** (1 tasks, parallelism: 3)");
      expect(brief).toContain("`w1-t1` [builder]: Setup store");
    });

    it("formats brief cleanly when no bottlenecks exist", () => {
      const cleanResult = executeProactiveMindCognition({
        subordinateExecutionWindowMs: 3_600_000,
      });
      const brief = formatStrategicCognitionBrief(cleanResult);
      expect(brief).toContain("Bottlenecks: None detected (optimal topological flow)");
      expect(brief).toContain("Tier 0 Mind Strategic Cognition");
    });
  });

  describe("verifyMindRoleStrategicInvariants", () => {
    it("validates compliant prompts and detects missing invariants", () => {
      const compliant = `Tier 0 30,000 feet altitude. zero source edits. zero unit tests. zero critic jobs. proactive bandwidth dag diagnostics 2+ hours.`;
      const chkCompliant = verifyMindRoleStrategicInvariants(compliant);
      expect(
        chkCompliant.isValid && chkCompliant.altitudeCompliant && chkCompliant.zeroEditsCompliant,
      ).toBe(true);

      const chkEmpty = verifyMindRoleStrategicInvariants("Random generic text");
      expect(chkEmpty.isValid).toBe(false);
      expect(chkEmpty.violations).toHaveLength(5);

      const chkNoAlt = verifyMindRoleStrategicInvariants(
        "zero source edits. zero unit tests. zero critic jobs. proactive bandwidth 2+ hours.",
      );
      expect(chkNoAlt.isValid).toBe(false);
      expect(chkNoAlt.altitudeCompliant).toBe(false);

      const altPrompt = `Strategic brain tier 0: write/edit prohibited, never run unit tests, critic passes forbidden, proactive backlog grooming 2+ hours.`;
      expect(verifyMindRoleStrategicInvariants(altPrompt).isValid).toBe(true);
    });
  });
});
