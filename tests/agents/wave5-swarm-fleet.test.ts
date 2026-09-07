import { describe, expect, it } from "bun:test";
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

describe("Wave 5: Dedicated Agent Manifests & Fleet Matrix", () => {
  // =========================================================================
  // 2. Fleet Matrix: Exhaustive 31-Agent Swarm Operational Contract Matrix
  // =========================================================================
  describe("Fleet Matrix (31 Agents Registry)", () => {
    it("verifies exact archetype counts across all 4 tiers", () => {
      expect(ALL_31_AGENT_ARCHETYPES.length).toBe(26);
      expect(TIER_0_1_GOVERNANCE_AGENTS.length).toBe(7);
      expect(TIER_2_ORCHESTRATION_AGENTS.length).toBe(8);
      expect(TIER_3_EXECUTION_AGENTS.length).toBe(4);
      expect(TIER_3_QUALITY_AGENTS.length).toBe(7);
      expect(getAllAgentArchetypes().length).toBe(26);

      // Verify optical dimensions, viewports, and synthetic states constants
      expect(OPTICAL_DIMENSIONS_8.length).toBe(8);
      expect(MANDATORY_VIEWPORTS_4.length).toBe(4);
      expect(SYNTHETIC_STATES_4.length).toBe(4);
    });

    it("retrieves operational contracts seamlessly", () => {
      // Direct canonical lookup
      const mindContract = requireAgentContract("sovereign-mind");
      expect(mindContract.id).toBe("sovereign-mind");
      expect(mindContract.tier).toBe(0);
      expect(mindContract.category).toBe("governance");

      // No aliases available
      const legacyMind = getAgentContract("mind");
      expect(legacyMind).toBeUndefined();

      const implementerContract = requireAgentContract("implementer");
      expect(implementerContract.id).toBe("implementer");
      expect(implementerContract.toolBoundaries.canWriteCode).toBe(true);

      const debuggerContract = requireAgentContract("ui-headless-validator");
      expect(debuggerContract.id).toBe("ui-headless-validator");
      expect(debuggerContract.isHeadlessDebugger).toBe(true);

      const visualContract = requireAgentContract("ui-optical-validator");
      expect(visualContract.id).toBe("ui-optical-validator");
      expect(visualContract.isHeadfulReviewer).toBe(true);
      expect(visualContract.isSourceCodeBlind).toBe(true);

      expect(normalizeAgentRole("orch")).toBe("orch");
      expect(normalizeAgentRole("coord")).toBe("coord");
      expect(normalizeAgentRole("sub-implementer")).toBe("sub-implementer");
      expect(normalizeAgentRole("worker")).toBe("worker");
    });

    it("lists agents by tier and category correctly", () => {
      const governanceList = listAgentsByCategory("governance");
      expect(governanceList.length).toBe(7);

      const orchestrationList = listAgentsByCategory("orchestration");
      expect(orchestrationList.length).toBe(8);

      const executionList = listAgentsByCategory("execution");
      expect(executionList.length).toBe(4);

      const qualityList = listAgentsByCategory("quality");
      expect(qualityList.length).toBe(7);

      const tier3List = listAgentsByTier(3);
      expect(tier3List.length).toBe(12); // 4 execution + 7 quality
    });

    it("validates tool boundaries and prohibits unauthorized tool execution", () => {
      // Cognitive UI Visual Reviewer must not write code or execute shell
      const writeAttempt = validateAgentToolCall("ui-optical-validator", "write_to_file");
      expect(writeAttempt.allowed).toBe(false);
      expect(writeAttempt.violation).toContain("ZERO_SOURCE_EDITS");

      const execAttempt = validateAgentToolCall("ui-optical-validator", "run:exec");
      expect(execAttempt.allowed).toBe(false);
      expect(execAttempt.violation).toContain("ZERO command execution privileges");

      // Implementer is allowed to write code and execute commands
      const implementerWrite = validateAgentToolCall("implementer", "write_to_file");
      expect(implementerWrite.allowed).toBe(true);

      const implementerExec = validateAgentToolCall("implementer", "run_command");
      expect(implementerExec.allowed).toBe(true);

      // UI Headless Debugger is allowed to run commands but NOT write code
      const debuggerExec = validateAgentToolCall("ui-headless-validator", "run:exec");
      expect(debuggerExec.allowed).toBe(true);

      const debuggerWrite = validateAgentToolCall("ui-headless-validator", "replace_file_content");
      expect(debuggerWrite.allowed).toBe(false);
    });

    it("validates subagent spawn permissions according to tier hierarchy", () => {
      // Coordinator can spawn implementers and validators
      const coordSpawn = validateAgentSpawn("feature-coordinator", "implementer");
      expect(coordSpawn.allowed).toBe(true);

      // Primary implementer can spawn sub-implementers
      const impSpawn = validateAgentSpawn("implementer", "sub-implementer");
      expect(impSpawn.allowed).toBe(true);

      // Sub-implementer cannot spawn further subagents
      const subImpSpawn = validateAgentSpawn("sub-implementer", "sub-investigator");
      expect(subImpSpawn.allowed).toBe(false);
      expect(subImpSpawn.violation).toContain("does not have subagent spawn authority");

      // Implementer cannot spawn orchestrator
      const invalidSpawn = validateAgentSpawn("implementer", "domain-orchestrator");
      expect(invalidSpawn.allowed).toBe(false);
    });

    it("verifies specialized role predicates", () => {
      expect(isHeadfulReviewer("ui-optical-validator")).toBe(true);
      expect(isHeadfulReviewer("implementer")).toBe(false);

      expect(isHeadlessDebugger("ui-headless-validator")).toBe(true);
      expect(isHeadlessDebugger("ui-headless-validator")).toBe(true);
      expect(isHeadlessDebugger("completeness-critic")).toBe(false);

      expect(isSourceCodeBlind("ui-optical-validator")).toBe(true);
      expect(isSourceCodeBlind("independent-planner")).toBe(true);
      expect(isSourceCodeBlind("implementer")).toBe(false);
    });
  });

  // =========================================================================
  // 3. Sovereign Equilibrium & Complexity Triage Engine
  // =========================================================================
});
