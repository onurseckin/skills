import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ALL_31_AGENT_ARCHETYPES,
  AntiOverheadWatchdog,
  FLEET_CONTRACT_REGISTRY,
  MANDATORY_VIEWPORTS_4,
  OPTICAL_DIMENSIONS_8,
  SYNTHETIC_STATES_4,
  TIER_0_1_GOVERNANCE_AGENTS,
  TIER_2_ORCHESTRATION_AGENTS,
  TIER_3_EXECUTION_AGENTS,
  TIER_3_QUALITY_AGENTS,
  advanceEpoch,
  autoHealUniversalHealth,
  classifyTaskComplexity,
  computeExecutionHealthScore,
  createEpistemicShard,
  createEpochMesh,
  createTrackAlphaState,
  createTrackBetaState,
  createWorktreeLease,
  defaultAntiOverheadWatchdog,
  diagnoseUniversalHealth,
  generateSwarmDispatchPlan,
  getAgentContract,
  getAllAgentArchetypes,
  getWorktreeLease,
  igniteSwarmEcosystem,
  isHeadfulReviewer,
  isHeadlessDebugger,
  isLeaseExpired,
  isSourceCodeBlind,
  listAgentsByCategory,
  listAgentsByTier,
  listWorktreeLeases,
  normalizeAgentRole,
  reclaimOrphanedWorktrees,
  recordAlphaHeartbeat,
  recordBetaRound,
  releaseWorktreeLease,
  renewWorktreeHeartbeat,
  requireAgentContract,
  symlinkDependencyCache,
  syncAndFastForwardWorktree,
  syncTrackAlphaAndBeta,
  validateAgentSpawn,
  validateAgentToolCall,
} from "../../olt/scripts/src/agents/index.ts";

describe("Wave 5: Sovereign Equilibrium & Complexity Triage", () => {
  describe("Sovereign Equilibrium & Complexity Triage", () => {
    it("classifies task complexity into 4 distinct levels", () => {
      // Level 1 Trivial
      const trivial = classifyTaskComplexity({ changedFilesCount: 1 });
      expect(trivial.level).toBe(1);
      expect(trivial.label).toBe("Trivial");
      expect(trivial.maxRecommendedAgents).toBe(1);
      expect(trivial.allowsSubDecomposition).toBe(false);

      // Level 2 Component
      const component = classifyTaskComplexity({ changedFilesCount: 4 });
      expect(component.level).toBe(2);
      expect(component.label).toBe("Component");
      expect(component.maxRecommendedAgents).toBe(2);
      expect(component.allowsSubDecomposition).toBe(false);

      // Level 3 Subsystem
      const subsystem = classifyTaskComplexity({ changedFilesCount: 8, dependenciesCount: 3 });
      expect(subsystem.level).toBe(3);
      expect(subsystem.label).toBe("Subsystem");
      expect(subsystem.maxRecommendedAgents).toBe(6);
      expect(subsystem.allowsSubDecomposition).toBe(true);

      // Level 4 Architectural
      const architectural = classifyTaskComplexity({ changedFilesCount: 22, riskScore: 85 });
      expect(architectural.level).toBe(4);
      expect(architectural.label).toBe("Architectural");
      expect(architectural.maxRecommendedAgents).toBe(12);
      expect(architectural.allowsSubDecomposition).toBe(true);
    });

    it("AntiOverheadWatchdog vetoes over-decomposition on Level 1 and Level 2 tasks", () => {
      const watchdog = new AntiOverheadWatchdog();

      // Level 1 task: Attempting to spawn 4 agents with a coordinator should be VETOED
      const evalLevel1 = watchdog.evaluateDecomposition(1, [
        "feature-coordinator",
        "primary-implementer",
        "sub-implementer",
        "general-validator",
      ]);
      expect(evalLevel1.vetoed).toBe(true);
      expect(evalLevel1.allowed).toBe(false);
      expect(evalLevel1.reason).toContain("AntiOverheadWatchdog VETO: Level 1");
      expect(evalLevel1.flattenedPlan?.primaryLead).toBe("primary-implementer");
      expect(evalLevel1.flattenedPlan?.workers.length).toBe(0);

      // Level 2 task: Attempting to spawn 4 agents with sub-implementers should be VETOED
      const evalLevel2 = watchdog.evaluateDecomposition(2, [
        "feature-coordinator",
        "primary-implementer",
        "sub-implementer",
        "general-validator",
      ]);
      expect(evalLevel2.vetoed).toBe(true);
      expect(evalLevel2.flattenedPlan?.maxConcurrency).toBe(2);

      // Level 3 task: Allowed to spawn multi-agent coordinator swarm
      const evalLevel3 = watchdog.evaluateDecomposition(3, [
        "feature-coordinator",
        "primary-implementer",
        "sub-implementer",
        "completeness-critic",
      ]);
      expect(evalLevel3.vetoed).toBe(false);
      expect(evalLevel3.allowed).toBe(true);

      // assertSovereignEquilibrium throws on violation
      expect(() => {
        watchdog.assertSovereignEquilibrium(1, ["feature-coordinator", "implementer"]);
      }).toThrow(/AntiOverheadWatchdog VETO/);
    });

    it("generates adaptive Swarm Dispatch Plans for UI and non-UI tasks", () => {
      // Non-UI Level 2 plan
      const nonUiPlan = generateSwarmDispatchPlan({ changedFilesCount: 3, isUiTask: false });
      expect(nonUiPlan.complexity.level).toBe(2);
      expect(nonUiPlan.primaryLead).toBe("primary-implementer");
      expect(nonUiPlan.validators).toContain("general-validator");
      expect(nonUiPlan.worktreeStrategy).toBe("in-tree");

      // UI Level 2 plan
      const uiPlan = generateSwarmDispatchPlan({ changedFilesCount: 3, isUiTask: true });
      expect(uiPlan.complexity.level).toBe(2);
      expect(uiPlan.validators).toContain("ui-visual-reviewer");

      // UI Level 3 Subsystem plan
      const uiSubsystemPlan = generateSwarmDispatchPlan({ changedFilesCount: 8, isUiTask: true });
      expect(uiSubsystemPlan.complexity.level).toBe(3);
      expect(uiSubsystemPlan.primaryLead).toBe("feature-coordinator");
      expect(uiSubsystemPlan.workers).toContain("primary-implementer");
      expect(uiSubsystemPlan.validators).toContain("ui-headless-debugger");
      expect(uiSubsystemPlan.validators).toContain("ui-visual-reviewer");
      expect(uiSubsystemPlan.worktreeStrategy).toBe("ephemeral-worktree");

      // Level 4 Architectural plan
      const archPlan = generateSwarmDispatchPlan({ changedFilesCount: 20, isUiTask: true });
      expect(archPlan.complexity.level).toBe(4);
      expect(archPlan.primaryLead).toBe("domain-orchestrator");
      expect(archPlan.workers).toContain("autonomous-repairer");
      expect(archPlan.validators).toContain("completeness-critic");
      expect(archPlan.worktreeStrategy).toBe("shard-pool");
    });
  });

  // =========================================================================
  // 4. High-Density Ephemeral Worktree Governance
  // =========================================================================
});
