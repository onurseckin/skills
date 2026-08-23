import { describe, expect, test } from "bun:test";
import {
  MIND_STRATEGIC_ALTITUDE,
  MIND_HARD_ZEROS,
  MIND_PROACTIVE_BANDWIDTH_ACTIVITIES,
  diagnoseMacroDag,
  groomBacklog,
  evaluateStrategicCandidateAdmission,
  planProactiveRoadmap,
  executeProactiveMindCognition,
  formatStrategicCognitionBrief,
  verifyMindRoleStrategicInvariants,
  type MacroDagTaskNode,
  type StrategicCandidate,
} from "../../../orchestrating-long-tasks/scripts/src/mind/strategic-purpose.ts";

describe("Tier 0 Mind Strategic Purpose & Proactive Cognition", () => {
  describe("Invariants & Constants", () => {
    test("defines strategic altitude at 30,000 feet", () => {
      expect(MIND_STRATEGIC_ALTITUDE).toBe("30,000 feet");
    });

    test("defines the 3 Hard Zeros", () => {
      expect(MIND_HARD_ZEROS.ZERO_SOURCE_CODE_EDITS).toBe("zero_source_code_edits");
      expect(MIND_HARD_ZEROS.ZERO_UNIT_TEST_EXECUTION).toBe("zero_unit_test_execution");
      expect(MIND_HARD_ZEROS.ZERO_CRITIC_JOBS).toBe("zero_critic_jobs");
    });

    test("defines the 4 proactive bandwidth activities for long execution windows", () => {
      expect(MIND_PROACTIVE_BANDWIDTH_ACTIVITIES).toContain("macro_dag_diagnostics");
      expect(MIND_PROACTIVE_BANDWIDTH_ACTIVITIES).toContain("backlog_grooming");
      expect(MIND_PROACTIVE_BANDWIDTH_ACTIVITIES).toContain("candidate_admission");
      expect(MIND_PROACTIVE_BANDWIDTH_ACTIVITIES).toContain("proactive_roadmap_planning");
    });
  });

  describe("diagnoseMacroDag", () => {
    test("handles empty nodes gracefully", () => {
      const diag = diagnoseMacroDag({ nodes: [] });
      expect(diag.totalNodes).toBe(0);
      expect(diag.criticalPathLength).toBe(0);
      expect(diag.totalWorkMs).toBe(0);
      expect(diag.concurrencyRecommendation).toBe(1);
      expect(diag.bottlenecks).toEqual([]);
    });

    test("analyzes DAG topology, computes Work/Span P = W / S, and detects bottlenecks", () => {
      const nodes: MacroDagTaskNode[] = [
        {
          taskId: "root-1",
          role: "implementer",
          status: "completed",
          durationEstimateMs: 60_000,
          dependencies: [],
          writeScope: ["src/core"],
        },
        {
          taskId: "branch-a",
          role: "implementer",
          status: "leased",
          durationEstimateMs: 60_000,
          dependencies: ["root-1"],
          writeScope: ["src/module-a"],
        },
        {
          taskId: "branch-b",
          role: "implementer",
          status: "ready",
          durationEstimateMs: 60_000,
          dependencies: ["root-1"],
          writeScope: ["src/module-b"],
        },
        {
          taskId: "branch-c",
          role: "implementer",
          status: "ready",
          durationEstimateMs: 60_000,
          dependencies: ["root-1"],
          writeScope: ["src/module-c"],
        },
        {
          taskId: "branch-d",
          role: "implementer",
          status: "ready",
          durationEstimateMs: 60_000,
          dependencies: ["root-1"],
          writeScope: ["src/module-d"],
        },
        {
          taskId: "sink-1",
          role: "validator",
          status: "pending",
          durationEstimateMs: 60_000,
          dependencies: ["branch-a", "branch-b", "branch-c", "branch-d"],
          writeScope: ["tests/e2e"],
        },
      ];

      const diag = diagnoseMacroDag({ nodes });

      expect(diag.totalNodes).toBe(6);
      expect(diag.completedNodes).toBe(1);
      expect(diag.leasedNodes).toBe(1);
      expect(diag.readyNodes).toBe(3);
      expect(diag.criticalPathLength).toBe(3); // root-1 -> branch-* -> sink-1
      expect(diag.totalWorkMs).toBe(360_000);
      expect(diag.criticalSpanMs).toBe(180_000);
      expect(diag.workSpanRatio).toBe(2.0); // 360k / 180k = 2.0
      expect(diag.concurrencyRecommendation).toBe(2);

      // Fan-out bottleneck on root-1 (4 downstream branches)
      const fanOut = diag.bottlenecks.find((b) => b.type === "fan_out");
      expect(fanOut).toBeDefined();
      expect(fanOut?.taskId).toBe("root-1");

      // Fan-in bottleneck on sink-1 (4 upstream dependencies)
      const fanIn = diag.bottlenecks.find((b) => b.type === "fan_in");
      expect(fanIn).toBeDefined();
      expect(fanIn?.taskId).toBe("sink-1");

      // Subagent allocations
      expect(diag.subagentAllocations["implementer"]).toBe(5);
      expect(diag.subagentAllocations["validator"]).toBe(1);
    });

    test("flags failed node as critical path bottleneck", () => {
      const nodes: MacroDagTaskNode[] = [
        {
          taskId: "failed-task",
          role: "implementer",
          status: "failed",
          dependencies: [],
        },
      ];
      const diag = diagnoseMacroDag({ nodes });
      expect(diag.failedNodes).toBe(1);
      expect(diag.bottlenecks.some((b) => b.type === "critical_path" && b.taskId === "failed-task")).toBe(true);
    });
  });

  describe("groomBacklog", () => {
    test("grooms, categorizes, and ranks backlog items by strategic priority", () => {
      const raw = [
        {
          id: "item-low",
          title: "Documentation typo in comment",
          category: "DOCUMENTATION",
          priority: "LOW" as const,
          status: "actionable" as const,
        },
        {
          id: "item-crit",
          title: "Crash on corrupted capsule state",
          category: "SYSTEM_DESIGN",
          priority: "CRITICAL" as const,
          status: "actionable" as const,
        },
        {
          id: "item-high",
          title: "Multi-coordinator memory footprint optimization",
          category: "PERFORMANCE",
          priority: "HIGH" as const,
          status: "actionable" as const,
        },
        {
          id: "item-dormant",
          title: "Legacy fallback format",
          category: "DORMANT_CRITERIA",
          priority: "MEDIUM" as const,
          status: "dormant" as const,
        },
        {
          id: "item-pruned",
          title: "Obsolete node v14 compatibility",
          category: "ARCHITECTURAL_HEALTH",
          priority: "LOW" as const,
          status: "pruned" as const,
        },
      ];

      const result = groomBacklog({ rawItems: raw });

      expect(result.scannedCount).toBe(5);
      expect(result.actionableCount).toBe(3);
      expect(result.dormantCount).toBe(1);
      expect(result.prunedCount).toBe(1);

      // Strategic priorities should be sorted CRITICAL -> HIGH -> LOW
      expect(result.strategicPriorities.length).toBe(3);
      expect(result.strategicPriorities[0]).toContain("[CRITICAL]");
      expect(result.strategicPriorities[0]).toContain("Crash on corrupted capsule state");
      expect(result.strategicPriorities[1]).toContain("[HIGH]");
      expect(result.strategicPriorities[2]).toContain("[LOW]");
    });
  });

  describe("evaluateStrategicCandidateAdmission", () => {
    test("admits candidate satisfying all 6 admission gates", () => {
      const candidates: StrategicCandidate[] = [
        {
          id: "cand-1",
          title: "Implement Sugiyama Visualizer Layering",
          objectiveStatement: "Add Sugiyama DAG vertex layering and barycenter edge crossing reduction.",
          charterGoalIds: ["goal-visualization", "goal-observability"],
          writeScope: ["src/visualizer"],
        },
      ];

      const result = evaluateStrategicCandidateAdmission(candidates, {
        charterGoals: ["goal-visualization", "goal-observability", "goal-security"],
        activeScopes: ["src/auth"],
        declinedIds: [],
        currentAgentsInFlight: 2,
        maxAgentsInFlight: 8,
      });

      expect(result.evaluatedCount).toBe(1);
      expect(result.admittedCount).toBe(1);
      expect(result.declinedCount).toBe(0);

      const evaluation = result.evaluations[0]!;
      expect(evaluation.admitted).toBe(true);
      expect(evaluation.gate1Witnessed).toBe(true);
      expect(evaluation.gate2InCharter).toBe(true);
      expect(evaluation.gate3Falsifiable).toBe(true);
      expect(evaluation.gate4DisjointScope).toBe(true);
      expect(evaluation.gate5BudgetOk).toBe(true);
      expect(evaluation.gate6NotDuplicate).toBe(true);
      expect(evaluation.assignedTier1Orchestrator).toBe("orchestrator_wave-next");
    });

    test("declines candidate on charter goal mismatch (Gate 2) or scope collision (Gate 4)", () => {
      const candidates: StrategicCandidate[] = [
        {
          id: "cand-out-of-charter",
          title: "Add Blockchain Ledger",
          objectiveStatement: "Integrate decentralized blockchain tokens into state storage.",
          charterGoalIds: ["goal-crypto-token"], // not in charter
          writeScope: ["src/crypto"],
        },
        {
          id: "cand-colliding-scope",
          title: "Refactor Authentication Engine",
          objectiveStatement: "Rewrite session store and token validator logic.",
          charterGoalIds: ["goal-security"],
          writeScope: ["src/auth"], // collides with active write scope
        },
      ];

      const result = evaluateStrategicCandidateAdmission(candidates, {
        charterGoals: ["goal-security", "goal-visualization"],
        activeScopes: ["src/auth"],
        declinedIds: [],
      });

      expect(result.evaluatedCount).toBe(2);
      expect(result.admittedCount).toBe(0);
      expect(result.declinedCount).toBe(2);

      const cand1 = result.evaluations[0]!;
      expect(cand1.admitted).toBe(false);
      expect(cand1.failingGates).toContain(2);

      const cand2 = result.evaluations[1]!;
      expect(cand2.admitted).toBe(false);
      expect(cand2.failingGates).toContain(4);
    });
  });

  describe("planProactiveRoadmap", () => {
    test("proactively synthesizes future fleet execution roadmap across 2+ hour horizon", () => {
      const roadmap = planProactiveRoadmap({
        fleetId: "fleet-gen-5-future",
        targetHorizonHours: 3.0,
        backlogPriorities: [
          "Zero-Token Action Chaining",
          "Recursive Graph Scheduler",
          "APCA Contrast Hardening",
        ],
      });

      expect(roadmap.fleetId).toBe("fleet-gen-5-future");
      expect(roadmap.targetHorizonHours).toBe(3.0);
      expect(roadmap.targetHorizonMs).toBe(10_800_000);
      expect(roadmap.waves.length).toBeGreaterThanOrEqual(2);
      expect(roadmap.totalTasks).toBeGreaterThanOrEqual(3);
      expect(roadmap.maxParallelism).toBeGreaterThanOrEqual(2);

      const wave1 = roadmap.waves[0]!;
      expect(wave1.waveNumber).toBe(1);
      expect(wave1.atomicTasks.length).toBe(3);
      expect(wave1.isolatedWriteScopes.length).toBeGreaterThan(0);

      const wave2 = roadmap.waves[1]!;
      expect(wave2.waveNumber).toBe(2);
      expect(wave2.atomicTasks.some((t) => t.role === "validator")).toBe(true);
    });
  });

  describe("executeProactiveMindCognition & formatStrategicCognitionBrief", () => {
    test("executes end-to-end proactive cognition for a 2.5 hour subordinate execution window", () => {
      const result = executeProactiveMindCognition({
        subordinateExecutionWindowMs: 9_000_000, // 2.5 hours
        fleetId: "fleet-autonomous-wave-6",
        charterGoals: ["goal-macro-cognition", "goal-reliability"],
        candidates: [
          {
            id: "cand-macro-1",
            title: "Proactive Fleet Synthesis",
            objectiveStatement: "Synthesize next-generation atomic task plans during idle pulses.",
            charterGoalIds: ["goal-macro-cognition"],
            writeScope: ["src/mind/proactive"],
          },
        ],
      });

      expect(result.altitude).toBe("30,000 feet");
      expect(result.subordinateExecutionWindowHours).toBe(2.5);
      expect(result.macroDag).toBeDefined();
      expect(result.backlogGrooming).toBeDefined();
      expect(result.candidateAdmission.admittedCount).toBe(1);
      expect(result.proactiveRoadmap.waves.length).toBeGreaterThanOrEqual(2);
      expect(result.strategicSummary).toContain("[Mind 30,000ft Cognition]");

      const brief = formatStrategicCognitionBrief(result);
      expect(brief).toContain("Tier 0 Mind Strategic Cognition");
      expect(brief).toContain("30,000 feet");
      expect(brief).toContain("Macro DAG Diagnostics");
      expect(brief).toContain("Backlog Grooming");
      expect(brief).toContain("Candidate Admission");
      expect(brief).toContain("Proactive Roadmap Planning for Future Fleets");
    });
  });

  describe("verifyMindRoleStrategicInvariants", () => {
    test("passes fully compliant role text", () => {
      const validText = `
        Strategic Brain at 30,000 feet
        Zero Source Code Edits: never write, edit, stage, revert, format or delete any repository file
        Zero Unit Test Execution: never run unit test suites directly
        Zero Critic Jobs: never perform line-level reviews or critic passes
        During long subordinate execution windows (2+ hours), Mind actively uses its bandwidth for
        macro-level DAG diagnostics, backlog grooming, candidate admission, and proactive roadmap planning.
      `;

      const check = verifyMindRoleStrategicInvariants(validText);
      expect(check.isValid).toBe(true);
      expect(check.altitudeCompliant).toBe(true);
      expect(check.zeroEditsCompliant).toBe(true);
      expect(check.zeroUnitTestsCompliant).toBe(true);
      expect(check.zeroCriticCompliant).toBe(true);
      expect(check.proactiveBandwidthCompliant).toBe(true);
      expect(check.violations).toEqual([]);
    });

    test("flags non-compliant role text missing 3 hard zeros or proactive bandwidth", () => {
      const invalidText = "Simple supervisor role";
      const check = verifyMindRoleStrategicInvariants(invalidText);
      expect(check.isValid).toBe(false);
      expect(check.violations.length).toBeGreaterThan(0);
    });
  });
});
