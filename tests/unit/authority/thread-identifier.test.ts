import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentIdToRole,
  agentIdToTier,
  buildCapabilitiesProfile,
  detectHostApp,
  formatThreadIdentificationBrief,
  identifyExecutionContext,
  parseTierValue,
  recordBlunder,
  roleToTier,
  TIER_NAMES,
  validateTierSpawning,
  type ExecutionTier,
} from "../../../olt/scripts/src/authority/thread-identifier.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Thread Identifier - 4-Tier Authority & Spawning Rules", () => {
  test("TIER_NAMES explicitly defines all 4 execution tiers", () => {
    expect(TIER_NAMES[0]).toContain("Tier 0: Mind Lead");
    expect(TIER_NAMES[1]).toContain("Tier 1: Orchestrator Lead");
    expect(TIER_NAMES[2]).toContain("Tier 2: Coordinator Lead");
    expect(TIER_NAMES[3]).toContain("Tier 3: Implementer / Validator");
  });

  test("parseTierValue parses strings into correct execution tiers", () => {
    // Tier 0
    expect(parseTierValue("0")).toBe(0);
    expect(parseTierValue("tier-0")).toBe(0);
    expect(parseTierValue("tier_0")).toBe(0);
    expect(parseTierValue("tier 0")).toBe(0);
    expect(parseTierValue("mind")).toBe(0);
    expect(parseTierValue("human")).toBe(0);
    expect(parseTierValue("Tier 0: Mind Lead")).toBe(0);

    // Tier 1
    expect(parseTierValue("1")).toBe(1);
    expect(parseTierValue("tier-1")).toBe(1);
    expect(parseTierValue("tier_1")).toBe(1);
    expect(parseTierValue("tier 1")).toBe(1);
    expect(parseTierValue("orchestrator")).toBe(1);
    expect(parseTierValue("orch")).toBe(1);
    expect(parseTierValue("mind-auditor")).toBe(1);
    expect(parseTierValue("auditor")).toBe(1);

    // Tier 2
    expect(parseTierValue("2")).toBe(2);
    expect(parseTierValue("tier-2")).toBe(2);
    expect(parseTierValue("tier_2")).toBe(2);
    expect(parseTierValue("tier 2")).toBe(2);
    expect(parseTierValue("coordinator")).toBe(2);
    expect(parseTierValue("coord")).toBe(2);

    // Tier 3
    expect(parseTierValue("3")).toBe(3);
    expect(parseTierValue("tier-3")).toBe(3);
    expect(parseTierValue("tier_3")).toBe(3);
    expect(parseTierValue("tier 3")).toBe(3);
    expect(parseTierValue("implementer")).toBe(3);
    expect(parseTierValue("validator")).toBe(3);
    expect(parseTierValue("critic")).toBe(3);
    expect(parseTierValue("completeness-critic")).toBe(3);
    expect(parseTierValue("repairer")).toBe(3);
    expect(parseTierValue("planner")).toBe(3);
    expect(parseTierValue("plan-validator")).toBe(3);

    // Null/Invalid
    expect(parseTierValue(undefined)).toBeNull();
    expect(parseTierValue("")).toBeNull();
    expect(parseTierValue("invalid")).toBeNull();
    expect(parseTierValue("unknown-tier")).toBeNull();
  });

  test("roleToTier maps standard roles to tiers", () => {
    expect(roleToTier("mind")).toBe(0);
    expect(roleToTier("human")).toBe(0);
    expect(roleToTier("user")).toBe(0);
    expect(roleToTier("orchestrator")).toBe(1);
    expect(roleToTier("orch-lead")).toBe(1);
    expect(roleToTier("mind-auditor")).toBe(1);
    expect(roleToTier("auditor")).toBe(1);
    expect(roleToTier("coordinator")).toBe(2);
    expect(roleToTier("coord-1")).toBe(2);
    expect(roleToTier("implementer")).toBe(3);
    expect(roleToTier("validator")).toBe(3);
    expect(roleToTier("repairer")).toBe(3);
    expect(roleToTier("random-worker")).toBe(3);
  });

  test("agentIdToTier and agentIdToRole infer tier and role from naming conventions", () => {
    expect(agentIdToTier("mind-0")).toBe(0);
    expect(agentIdToRole("mind-0")).toBe("mind");

    expect(agentIdToTier("mind-audit-1")).toBe(1);
    expect(agentIdToRole("mind-audit-1")).toBe("mind-auditor");

    expect(agentIdToTier("orch-lead")).toBe(1);
    expect(agentIdToRole("orch-lead")).toBe("orchestrator");

    expect(agentIdToTier("coord-alpha")).toBe(2);
    expect(agentIdToRole("coord-alpha")).toBe("coordinator");

    expect(agentIdToTier("impl-task-1")).toBe(3);
    expect(agentIdToRole("impl-task-1")).toBe("implementer");

    expect(agentIdToTier("val-task-1")).toBe(3);
    expect(agentIdToRole("val-task-1")).toBe("validator");

    expect(agentIdToTier("critic-task-1")).toBe(3);
    expect(agentIdToRole("critic-task-1")).toBe("completeness-critic");

    expect(agentIdToTier("repair-task-1")).toBe(3);
    expect(agentIdToRole("repair-task-1")).toBe("repairer");

    expect(agentIdToTier("plan-val-1")).toBe(3);
    expect(agentIdToRole("plan-val-1")).toBe("plan-validator");

    expect(agentIdToTier("plan-1")).toBe(3);
    expect(agentIdToRole("plan-1")).toBe("planner");

    expect(agentIdToTier("unknown-agent")).toBeNull();
    expect(agentIdToRole("unknown-agent")).toBeNull();
  });

  test("validateTierSpawning validates valid and invalid spawning transitions", () => {
    // Valid 4-tier transitions
    expect(validateTierSpawning(0, 1).allowed).toBe(true);
    expect(validateTierSpawning(1, 2).allowed).toBe(true);
    expect(validateTierSpawning(2, 3).allowed).toBe(true);
    expect(validateTierSpawning(3, 3).allowed).toBe(true);

    // Invalid transitions
    expect(validateTierSpawning(0, 0).allowed).toBe(false); // Mind -> Mind
    expect(validateTierSpawning(0, 2).allowed).toBe(false); // Mind -> Coordinator
    expect(validateTierSpawning(0, 3).allowed).toBe(false); // Mind -> Implementer
    expect(validateTierSpawning(1, 0).allowed).toBe(false); // Orchestrator -> Mind
    expect(validateTierSpawning(1, 1).allowed).toBe(false); // Orchestrator -> Orchestrator
    expect(validateTierSpawning(1, 3).allowed).toBe(false); // Orchestrator -> Implementer
    expect(validateTierSpawning(2, 0).allowed).toBe(false); // Coordinator -> Mind
    expect(validateTierSpawning(2, 1).allowed).toBe(false); // Coordinator -> Orchestrator
    expect(validateTierSpawning(2, 2).allowed).toBe(false); // Coordinator -> Coordinator
    expect(validateTierSpawning(3, 0).allowed).toBe(false); // Implementer -> Mind
    expect(validateTierSpawning(3, 1).allowed).toBe(false); // Implementer -> Orchestrator
    expect(validateTierSpawning(3, 2).allowed).toBe(false); // Implementer -> Coordinator
  });

  test("identifyExecutionContext correctly detects Tier 0 (Mind Lead / Interactive Main)", () => {
    // Interactive main thread
    const mainCtx = identifyExecutionContext({
      isInteractiveMainThread: true,
      env: {},
    });
    expect(mainCtx.tier).toBe(0);
    expect(mainCtx.is_main_thread).toBe(true);
    expect(mainCtx.compliance_state).toBe("restrained");
    expect(mainCtx.advisory).toContain("MAIN THREAD RESTRAINT ACTIVE");
    expect(mainCtx.blunder).not.toBeNull();
    expect(mainCtx.blunder?.type).toBe("main_thread_direct_execution");

    // Session-based main thread without subagent headers
    const sessionCtx = identifyExecutionContext({
      env: {
        CONVERSATION_ID: "conv-12345",
      },
    });
    expect(sessionCtx.tier).toBe(0);
    expect(sessionCtx.is_main_thread).toBe(true);
    expect(sessionCtx.compliance_state).toBe("restrained");

    // Explicit Tier 0
    const explicitTier0 = identifyExecutionContext({
      tier: 0,
      isInteractiveMainThread: false,
    });
    expect(explicitTier0.tier).toBe(0);
    expect(explicitTier0.role).toBe("mind");
    expect(explicitTier0.is_main_thread).toBe(false);
    expect(explicitTier0.compliance_state).toBe("compliant");
  });

  test("identifyExecutionContext correctly detects Tier 1 (Orchestrator Lead)", () => {
    const orchCtx = identifyExecutionContext({
      role: "orchestrator",
      agentId: "orch-lead-1",
      env: {
        HARNESS_EXECUTION_TIER: "1",
        HARNESS_AGENT_ROLE: "orchestrator",
        HARNESS_AGENT_ID: "orch-lead-1",
      },
    });
    expect(orchCtx.tier).toBe(1);
    expect(orchCtx.role).toBe("orchestrator");
    expect(orchCtx.agent_id).toBe("orch-lead-1");
    expect(orchCtx.is_main_thread).toBe(false);
    expect(orchCtx.compliance_state).toBe("compliant");
    expect(orchCtx.capabilities.command_taxonomy).toContain("Orchestration");
  });

  test("identifyExecutionContext correctly detects Tier 2 (Coordinator Lead)", () => {
    const coordCtx = identifyExecutionContext({
      role: "coordinator",
      agentId: "coord-test",
      env: {
        HARNESS_AGENT_ROLE: "coordinator",
        HARNESS_AGENT_ID: "coord-test",
      },
    });

    expect(coordCtx.tier).toBe(2);
    expect(coordCtx.role).toBe("coordinator");
    expect(coordCtx.agent_id).toBe("coord-test");
    expect(coordCtx.is_main_thread).toBe(false);
    expect(coordCtx.compliance_state).toBe("compliant");
    expect(coordCtx.capabilities.command_taxonomy).toContain("Coordination");
  });

  test("identifyExecutionContext correctly detects Tier 3 (Implementer / Validator / Repairer)", () => {
    const implCtx = identifyExecutionContext({
      agentId: "impl-wave-1",
      env: {
        HARNESS_AGENT_ID: "impl-wave-1",
      },
    });
    expect(implCtx.tier).toBe(3);
    expect(implCtx.role).toBe("implementer");
    expect(implCtx.agent_id).toBe("impl-wave-1");
    expect(implCtx.is_main_thread).toBe(false);
    expect(implCtx.compliance_state).toBe("compliant");
    expect(implCtx.capabilities.command_taxonomy).toContain("Implementation");

    const valCtx = identifyExecutionContext({
      role: "validator",
      agentId: "val-wave-1",
    });
    expect(valCtx.tier).toBe(3);
    expect(valCtx.role).toBe("validator");
    expect(valCtx.agent_id).toBe("val-wave-1");
  });

  test("detectHostApp identifies host applications correctly", () => {
    expect(detectHostApp({ CLAUDE_CODE_VERSION: "1.0.0" })).toBe("Claude Code");
    expect(detectHostApp({ CLAUDE_CLI: "1" })).toBe("Claude Code");
    expect(detectHostApp({ ANTIGRAVITY_CLI: "1" })).toBe("Antigravity/Gemini CLI");
    expect(detectHostApp({ GEMINI_CLI: "1" })).toBe("Antigravity/Gemini CLI");
    expect(detectHostApp({ TERM_PROGRAM: "cursor" })).toBe("Cursor");
    expect(detectHostApp({ CURSOR_VERSION: "0.40.0" })).toBe("Cursor");
    expect(detectHostApp({ OPENCODE_CLI: "1" })).toBe("OpenCode");
    expect(detectHostApp({ CODEX_CLI: "1" })).toBe("Codex");
    expect(detectHostApp({ TERM_PROGRAM: "vscode" })).toBe("VSCode Terminal");
    expect(detectHostApp({})).toBe("Generic Host");
  });

  test("buildCapabilitiesProfile reflects tier sandbox taxonomy and tools", () => {
    const tier0Caps = buildCapabilitiesProfile(0, {
      GRANTED_TOOLS: "bash, read_file, write_file",
      ENVIRONMENT_GRANTS: "root, network",
    });
    expect(tier0Caps.command_taxonomy).toContain("Full Root");
    expect(tier0Caps.tools).toEqual(["bash", "read_file", "write_file"]);
    expect(tier0Caps.environment_grants).toEqual(["root", "network"]);

    const tier1Caps = buildCapabilitiesProfile(1, {});
    expect(tier1Caps.command_taxonomy).toContain("Orchestration");

    const tier2Caps = buildCapabilitiesProfile(2, {});
    expect(tier2Caps.command_taxonomy).toContain("Coordination");

    const tier3Caps = buildCapabilitiesProfile(3, {});
    expect(tier3Caps.command_taxonomy).toContain("Implementation");
  });

  test("formatThreadIdentificationBrief formats markdown summary accurately", () => {
    const context = identifyExecutionContext({
      role: "coordinator",
      agentId: "coord-test",
      env: {
        GRANTED_TOOLS: "task_claim, task_submit",
      },
    });

    const brief = formatThreadIdentificationBrief(context);
    expect(brief).toContain("### Thread Authority Identification (`whoami`)");
    expect(brief).toContain("Tier 2");
    expect(brief).toContain("coord-test");
    expect(brief).toContain("COMPLIANT");
    expect(brief).toContain("task_claim, task_submit");
  });

  test("recordBlunder persists blunder log into runRoot or capsules dir", () => {
    const dir = scratchRoot(import.meta.path, "blunder-log");
    const blunderRecord = {
      id: "blunder-test-123",
      type: "main_thread_direct_execution" as const,
      severity: "critical" as const,
      timestamp: new Date().toISOString(),
      pid: 1234,
      ppid: 1,
      agent_id: "main-user",
      observation: "Direct file modification on main thread",
      remediation: "Dispatch Tier 2 coordinator",
      context: {
        cwd: dir,
        indicators: { TEST: "1" },
      },
    };

    recordBlunder(blunderRecord, { runRoot: dir });
    const blundersFile = join(dir, "blunders.jsonl");
    expect(existsSync(blundersFile)).toBe(true);
    const content = readFileSync(blundersFile, "utf8");
    expect(content).toContain("blunder-test-123");
    expect(content).toContain("main_thread_direct_execution");
  });
});

describe("Thread Identifier - Invariants & Cleanliness Audit", () => {
  test("zero TypeScript any and zero suppressions across thread-identifier files", () => {
    const sourceFiles = [
      join(__dirname, "../../../olt/scripts/src/authority/thread-identifier.ts"),
      __filename,
    ];

    const anyAnnotation = new RegExp(":\\s*any\\b");
    const anyCast = new RegExp("as\\s+any\\b");
    const anyGeneric = new RegExp("<\\s*any\\s*>");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");

      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });
});
