import { describe, expect, test } from "bun:test";
import {
  buildCapabilitiesProfile,
  detectHostApp,
  formatThreadIdentificationBrief,
  identifyExecutionContext,
  validateTierSpawning,
  type ExecutionTier,
} from "../../../olt/scripts/src/authority/thread/index.ts";

describe("Thread Identifier - Execution Context Resolution & Tier Spawning", () => {
  test("validateTierSpawning validates valid and invalid spawning transitions", () => {
    expect(validateTierSpawning(0, 1).allowed).toBe(true);
    expect(validateTierSpawning(1, 2).allowed).toBe(true);
    expect(validateTierSpawning(2, 3).allowed).toBe(true);
    expect(validateTierSpawning(3, 3).allowed).toBe(true);

    expect(validateTierSpawning(0, 0).allowed).toBe(false);
    expect(validateTierSpawning(0, 2).allowed).toBe(false);
    expect(validateTierSpawning(0, 3).allowed).toBe(false);
    expect(validateTierSpawning(1, 0).allowed).toBe(false);
    expect(validateTierSpawning(1, 1).allowed).toBe(false);
    expect(validateTierSpawning(1, 3).allowed).toBe(false);
    expect(validateTierSpawning(2, 0).allowed).toBe(false);
    expect(validateTierSpawning(2, 1).allowed).toBe(false);
    expect(validateTierSpawning(2, 2).allowed).toBe(false);
    expect(validateTierSpawning(3, 0).allowed).toBe(false);
    expect(validateTierSpawning(3, 1).allowed).toBe(false);
    expect(validateTierSpawning(3, 2).allowed).toBe(false);
  });

  test("validateTierSpawning returns detailed rejection reasons across role boundaries", () => {
    const t3to0 = validateTierSpawning(3, 0, "implementer", "mind");
    expect(t3to0.allowed).toBe(false);
    expect(t3to0.reason).toContain(
      "Tier 3 worker cannot spawn Tier 0 (mind) (role escalation violation)",
    );

    const t3to1 = validateTierSpawning(3, 1, "implementer", "orchestrator");
    expect(t3to1.allowed).toBe(false);
    expect(t3to1.reason).toContain(
      "Tier 3 worker cannot spawn Tier 1 (orchestrator) (role escalation violation)",
    );

    const t3to2 = validateTierSpawning(3, 2, "implementer", "coordinator");
    expect(t3to2.allowed).toBe(false);
    expect(t3to2.reason).toContain(
      "Tier 3 worker cannot spawn Tier 2 (coordinator) (role escalation violation)",
    );

    const t0to2 = validateTierSpawning(0, 2, "mind", "coordinator");
    expect(t0to2.allowed).toBe(false);
    expect(t0to2.reason).toContain("Tier 0 Mind Lead cannot directly spawn Tier 2");

    const t1to3 = validateTierSpawning(1, 3, "orchestrator", "implementer");
    expect(t1to3.allowed).toBe(false);
    expect(t1to3.reason).toContain("Tier 1 Orchestrator Lead cannot directly spawn Tier 3");

    const t2to0 = validateTierSpawning(2, 0, "coordinator", "mind");
    expect(t2to0.allowed).toBe(false);
    expect(t2to0.reason).toContain("Tier 2 Coordinator Lead cannot deploy Tier 0");

    const invalidTier = validateTierSpawning(9 as unknown as ExecutionTier, 3);
    expect(invalidTier.allowed).toBe(false);
    expect(invalidTier.reason).toContain("Invalid tier hierarchy transition");
  });

  test("identifyExecutionContext correctly detects Tier 0 (Mind Lead / Interactive Main)", () => {
    const mainCtx = identifyExecutionContext({
      isInteractiveMainThread: true,
      env: { NODE_ENV: "test" },
    });
    expect(mainCtx.tier).toBe(0);
    expect(mainCtx.is_main_thread).toBe(true);
    expect(mainCtx.compliance_state).toBe("restrained");
    expect(mainCtx.advisory).toContain("MAIN THREAD RESTRAINT ACTIVE");
    expect(mainCtx.defect).toBeNull();

    const sessionCtx = identifyExecutionContext({
      env: {
        CONVERSATION_ID: "conv-12345",
      },
    });
    expect(sessionCtx.tier).toBe(0);
    expect(sessionCtx.is_main_thread).toBe(true);
    expect(sessionCtx.compliance_state).toBe("restrained");

    const explicitTier0 = identifyExecutionContext({
      tier: 0,
      isInteractiveMainThread: false,
    });
    expect(explicitTier0.tier).toBe(0);
    expect(explicitTier0.role).toBe("mind");
    expect(explicitTier0.is_main_thread).toBe(false);
    expect(explicitTier0.compliance_state).toBe("compliant");
  });

  test("identifyExecutionContext correctly detects Tier 1, Tier 2, and Tier 3", () => {
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

    const implCtx = identifyExecutionContext({
      agentId: "impl-wave-1",
      env: {
        HARNESS_AGENT_ID: "impl-wave-1",
      },
    });
    expect(implCtx.tier).toBe(3);
    expect(implCtx.role).toBe("implementer");
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
});
