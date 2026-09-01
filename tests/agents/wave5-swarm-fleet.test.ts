import {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
} from "../../olt/scripts/src/authority/index.ts";
const AGENTS_DIR = path.join(process.cwd(), "olt", "agents");
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

describe("Wave 5: Dedicated Agent Manifests & Fleet Matrix", () => {
  describe("Dedicated Agent Manifests", () => {
    it("validates ui-debugger.yaml manifest schema and invariants", () => {
      const filePath = path.join(AGENTS_DIR, "ui-debugger.yaml");
      expect(fs.existsSync(filePath)).toBe(true);

      const rawYaml = fs.readFileSync(filePath, "utf-8");
      const manifest = parseUnifiedAgentManifest(rawYaml, filePath);

      expect(manifest.name).toBe("ui-debugger");
      expect(manifest.role).toBe("ui-debugger");
      expect(manifest.tier).toBe(3);
      expect(manifest.tools.enable_subagent_tools).toBe(false);
      expect(manifest.tools.enable_write_tools).toBe(false);

      expect(manifest.permissions.commands).toContain("run:exec");
      expect(manifest.permissions.commands).toContain("task:check");
      expect(manifest.permissions.commands).toContain("evidence:screenshots");

      expect(manifest.invariants).toContain("ZERO_SOURCE_EDITS");
      expect(manifest.invariants).toContain("NO_TEST_RE_RUNS");
      expect(manifest.invariants).toContain("TECHNICAL_DIAGNOSTICS_ONLY");
      expect(manifest.invariants).toContain("PROHIBIT_AESTHETIC_SIGN_OFF");
      expect(manifest.invariants).toContain("SYNTHETIC_STATE_PREFLIGHT_4_STATES");
      expect(manifest.invariants).toContain("DOM_INSPECTION_HARDLOCK");

      const validation = validateUnifiedAgentManifest(manifest);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    it("validates ui-visual-reviewer.yaml manifest schema, 8 optical dimensions and source-code blindness", () => {
      const filePath = path.join(AGENTS_DIR, "ui-visual-reviewer.yaml");
      expect(fs.existsSync(filePath)).toBe(true);

      const rawYaml = fs.readFileSync(filePath, "utf-8");
      const manifest = parseUnifiedAgentManifest(rawYaml, filePath);

      expect(manifest.name).toBe("ui-visual-reviewer");
      expect(manifest.role).toBe("ui-visual-reviewer");
      expect(manifest.tier).toBe(3);
      expect(manifest.tools.enable_subagent_tools).toBe(false);
      expect(manifest.tools.enable_write_tools).toBe(false);

      // Zero command privileges
      expect(manifest.permissions.commands).not.toContain("run:exec");
      expect(manifest.permissions.commands).toContain("evidence:screenshots");
      expect(manifest.permissions.commands).toContain("task:review");
      expect(manifest.permissions.commands).toContain("task:probe");

      expect(manifest.invariants).toContain("COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK");
      expect(manifest.invariants).toContain("SOURCE_CODE_BLINDNESS_QUARANTINE");
      expect(manifest.invariants).toContain("HEADFUL_CHROME_VISUAL_REVIEW_MANDATE");
      expect(manifest.invariants).toContain("OPTICAL_8_DIMENSIONS_AUDIT");
      expect(manifest.invariants).toContain("SOCRATIC_CHALLENGE_QUOTA");
      expect(manifest.invariants).toContain("SUPERFICIAL_UI_APPROVAL_BAN");
      expect(manifest.invariants).toContain("FOUR_VIEWPORT_MANDATE");

      const validation = validateUnifiedAgentManifest(manifest);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });
  });

  // =========================================================================
  // 2. Fleet Matrix: Exhaustive 31-Agent Swarm Operational Contract Matrix
  // =========================================================================
  describe("Fleet Matrix (31 Agents Registry)", () => {
    it("verifies exact archetype counts across all 4 tiers", () => {
      expect(ALL_31_AGENT_ARCHETYPES.length).toBe(31);
      expect(TIER_0_1_GOVERNANCE_AGENTS.length).toBe(8);
      expect(TIER_2_ORCHESTRATION_AGENTS.length).toBe(8);
      expect(TIER_3_EXECUTION_AGENTS.length).toBe(5);
      expect(TIER_3_QUALITY_AGENTS.length).toBe(10);
      expect(getAllAgentArchetypes().length).toBe(31);

      // Verify optical dimensions, viewports, and synthetic states constants
      expect(OPTICAL_DIMENSIONS_8.length).toBe(8);
      expect(MANDATORY_VIEWPORTS_4.length).toBe(4);
      expect(SYNTHETIC_STATES_4.length).toBe(4);
    });

    it("retrieves operational contracts and resolves aliases seamlessly", () => {
      // Direct canonical lookup
      const mindContract = requireAgentContract("sovereign-mind");
      expect(mindContract.id).toBe("sovereign-mind");
      expect(mindContract.tier).toBe(0);
      expect(mindContract.category).toBe("governance");

      // Legacy alias lookup
      const legacyMind = getAgentContract("mind");
      expect(legacyMind).toBeDefined();
      expect(legacyMind?.id).toBe("sovereign-mind");

      const implementerContract = requireAgentContract("implementer");
      expect(implementerContract.id).toBe("primary-implementer");
      expect(implementerContract.toolBoundaries.canWriteCode).toBe(true);

      const debuggerContract = requireAgentContract("ui-debugger");
      expect(debuggerContract.id).toBe("ui-headless-debugger");
      expect(debuggerContract.isHeadlessDebugger).toBe(true);

      const visualContract = requireAgentContract("ui-visual-reviewer");
      expect(visualContract.id).toBe("ui-visual-reviewer");
      expect(visualContract.isHeadfulReviewer).toBe(true);
      expect(visualContract.isSourceCodeBlind).toBe(true);

      expect(normalizeAgentRole("orch")).toBe("domain-orchestrator");
      expect(normalizeAgentRole("coord")).toBe("feature-coordinator");
      expect(normalizeAgentRole("repairer")).toBe("autonomous-repairer");
      expect(normalizeAgentRole("worker")).toBe("general-task-worker");
    });

    it("lists agents by tier and category correctly", () => {
      const governanceList = listAgentsByCategory("governance");
      expect(governanceList.length).toBe(8);

      const orchestrationList = listAgentsByCategory("orchestration");
      expect(orchestrationList.length).toBe(8);

      const executionList = listAgentsByCategory("execution");
      expect(executionList.length).toBe(5);

      const qualityList = listAgentsByCategory("quality");
      expect(qualityList.length).toBe(10);

      const tier3List = listAgentsByTier(3);
      expect(tier3List.length).toBe(16); // 5 execution + 10 quality + 1 plan-validator
    });

    it("validates tool boundaries and prohibits unauthorized tool execution", () => {
      // Cognitive UI Visual Reviewer must not write code or execute shell
      const writeAttempt = validateAgentToolCall("ui-visual-reviewer", "write_to_file");
      expect(writeAttempt.allowed).toBe(false);
      expect(writeAttempt.violation).toContain("ZERO_SOURCE_EDITS");

      const execAttempt = validateAgentToolCall("ui-visual-reviewer", "run:exec");
      expect(execAttempt.allowed).toBe(false);
      expect(execAttempt.violation).toContain("ZERO command execution privileges");

      // Implementer is allowed to write code and execute commands
      const implementerWrite = validateAgentToolCall("primary-implementer", "write_to_file");
      expect(implementerWrite.allowed).toBe(true);

      const implementerExec = validateAgentToolCall("primary-implementer", "run_command");
      expect(implementerExec.allowed).toBe(true);

      // UI Headless Debugger is allowed to run commands but NOT write code
      const debuggerExec = validateAgentToolCall("ui-headless-debugger", "run:exec");
      expect(debuggerExec.allowed).toBe(true);

      const debuggerWrite = validateAgentToolCall("ui-headless-debugger", "replace_file_content");
      expect(debuggerWrite.allowed).toBe(false);
    });

    it("validates subagent spawn permissions according to tier hierarchy", () => {
      // Coordinator can spawn implementers and validators
      const coordSpawn = validateAgentSpawn("feature-coordinator", "primary-implementer");
      expect(coordSpawn.allowed).toBe(true);

      // Primary implementer can spawn sub-implementers
      const impSpawn = validateAgentSpawn("primary-implementer", "sub-implementer");
      expect(impSpawn.allowed).toBe(true);

      // Sub-implementer cannot spawn further subagents
      const subImpSpawn = validateAgentSpawn("sub-implementer", "sub-investigator");
      expect(subImpSpawn.allowed).toBe(false);
      expect(subImpSpawn.violation).toContain("does not have subagent spawn authority");

      // Implementer cannot spawn orchestrator
      const invalidSpawn = validateAgentSpawn("primary-implementer", "domain-orchestrator");
      expect(invalidSpawn.allowed).toBe(false);
    });

    it("verifies specialized role predicates", () => {
      expect(isHeadfulReviewer("ui-visual-reviewer")).toBe(true);
      expect(isHeadfulReviewer("ui-cognitive-validator")).toBe(true);
      expect(isHeadfulReviewer("primary-implementer")).toBe(false);

      expect(isHeadlessDebugger("ui-headless-debugger")).toBe(true);
      expect(isHeadlessDebugger("ui-debugger")).toBe(true);
      expect(isHeadlessDebugger("completeness-critic")).toBe(false);

      expect(isSourceCodeBlind("ui-visual-reviewer")).toBe(true);
      expect(isSourceCodeBlind("independent-planner")).toBe(true);
      expect(isSourceCodeBlind("primary-implementer")).toBe(false);
    });
  });

  // =========================================================================
  // 3. Sovereign Equilibrium & Complexity Triage Engine
  // =========================================================================
});
