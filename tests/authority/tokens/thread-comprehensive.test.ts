import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  agentIdToRole,
  agentIdToTier,
  buildCapabilitiesProfile,
  formatThreadIdentificationBrief,
  identifyExecutionContext,
  isStandardAgentId,
  parseStandardAgentId,
  recommendStandardAgentId,
  recordDefect,
  roleToTier,
  validateAgentNamingConvention,
  validateTierSpawning,
  type DefectRecord,
  type ExecutionTier,
} from "../../../olt/scripts/src/authority/thread/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

describe("Authority Thread Context, Naming, Role Mapping & Spawning Comprehensive", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  test("validateTierSpawning default roles and invalid tiers", () => {
    expect(validateTierSpawning(0, 1).allowed).toBe(true);
    expect(validateTierSpawning(0, 2).allowed).toBe(false);
    expect(validateTierSpawning(1, 2).allowed).toBe(true);
    expect(validateTierSpawning(1, 3).allowed).toBe(false);
    expect(validateTierSpawning(2, 3).allowed).toBe(true);
    expect(validateTierSpawning(2, 1).allowed).toBe(false);
    expect(validateTierSpawning(3, 3).allowed).toBe(true);
    expect(validateTierSpawning(3, 2).allowed).toBe(false);
    expect(validateTierSpawning(4 as unknown as ExecutionTier, 1).allowed).toBe(false);
  });

  test("parseStandardAgentId edge cases and parsing details", () => {
    expect(parseStandardAgentId("no-underscore")).toBeNull();
    expect(parseStandardAgentId("prefix_")).toBeNull();
    expect(parseStandardAgentId("unknownprefix_suffix")).toBeNull();
    expect(parseStandardAgentId("coordinator_domain-cli")).toEqual({
      role: "coordinator",
      tier: 2,
      bindingType: "domain",
      contextOrTaskId: "domain-cli",
    });

    const parsedTask = parseStandardAgentId("implementer_task-123-fix-bug");
    expect(parsedTask?.taskId).toBe("task-123");
    expect(parsedTask?.taskSlug).toBe("fix-bug");

    expect(isStandardAgentId("invalid")).toBe(false);
    expect(isStandardAgentId("mind_pulse-1")).toBe(true);
  });

  test("recommendStandardAgentId for all role types", () => {
    expect(recommendStandardAgentId("mind", "pulse-1")).toBe("mind_pulse-1");
    expect(recommendStandardAgentId("orchestrator", "wave-1")).toBe("orchestrator_wave-1");
    expect(recommendStandardAgentId("mind-auditor", "audit-1")).toBe("mind-auditor_audit-1");
    expect(recommendStandardAgentId("coordinator", "domain-a")).toBe("coordinator_domain-a");
    expect(recommendStandardAgentId("implementer", "task-100", "my-slug")).toBe(
      "implementer_task-100-my-slug",
    );
    expect(recommendStandardAgentId("validator_ui_design", "task-100")).toBe(
      "validator_ui_design_task-100",
    );
    expect(recommendStandardAgentId("completeness_critic", "run-100")).toBe(
      "completeness_critic_run-100",
    );
    expect(recommendStandardAgentId("unknown-role", "ctx")).toBe("unknown-role_ctx");
  });

  test("validateAgentNamingConvention validations and recommended IDs", () => {
    expect(validateAgentNamingConvention("mind_pulse-1", "mind", 0).valid).toBe(true);
    expect(validateAgentNamingConvention("bad-id", "mind", 0).valid).toBe(false);
    expect(validateAgentNamingConvention("implementer_task-1", "implementer", 3).valid).toBe(true);
    expect(validateAgentNamingConvention("implementer_bad", "implementer", 3).valid).toBe(false);
    expect(validateAgentNamingConvention("coordinator_sub", "coordinator", 2).valid).toBe(true);
  });

  test("roleToTier and agentIdToRole / agentIdToTier mappings", () => {
    expect(roleToTier("mind")).toBe(0);
    expect(roleToTier("orchestrator")).toBe(1);
    expect(roleToTier("coordinator")).toBe(2);
    expect(roleToTier("implementer")).toBe(3);
    expect(roleToTier("validator_security")).toBe(3);
    expect(roleToTier("nonexistent")).toBe(3);

    expect(agentIdToRole("mind_pulse-1")).toBe("mind");
    expect(agentIdToRole("orchestrator_phase-1")).toBe("orchestrator");
    expect(agentIdToRole("coordinator_wave-1")).toBe("coordinator");
    expect(agentIdToRole("implementer_task-1")).toBe("implementer");
    expect(agentIdToRole("unknown_agent")).toBeNull();

    expect(agentIdToTier("mind_pulse-1")).toBe(0);
    expect(agentIdToTier("orchestrator_phase-1")).toBe(1);
    expect(agentIdToTier("coordinator_wave-1")).toBe(2);
    expect(agentIdToTier("implementer_task-1")).toBe(3);
    expect(agentIdToTier("unknown_agent")).toBeNull();
  });

  test("buildCapabilitiesProfile and formatThreadIdentificationBrief", () => {
    const profile = buildCapabilitiesProfile(2, { GRANTED_TOOLS: "tool1,tool2" });
    expect(profile.command_taxonomy).toContain("Coordination / Dispatch Only");
    expect(profile.tools).toEqual(["tool1", "tool2"]);

    const ctx = identifyExecutionContext({
      role: "coordinator",
      agentId: "coordinator_test",
      tier: 2,
    });
    const brief = formatThreadIdentificationBrief(ctx);
    expect(brief).toContain("Tier 2: Coordinator Lead");
    expect(brief).toContain("coordinator_test");
  });

  test("identifyExecutionContext and recordDefect", () => {
    const sandbox = "/virtual/thread-tokens/context";
    const ctx = identifyExecutionContext({
      cwd: sandbox,
      role: "coordinator",
      agentId: "coordinator_wave-1",
      env: {
        AGENT_ID: "coordinator_wave-1",
        ROLE: "coordinator",
      },
    });
    expect(ctx.tier).toBe(2);
    expect(ctx.role).toBe("coordinator");
    expect(ctx.agent_id).toBe("coordinator_wave-1");

    const defect: DefectRecord = {
      id: "defect-test-1",
      type: "main_thread_direct_execution",
      severity: "critical",
      timestamp: new Date().toISOString(),
      pid: process.pid,
      ppid: 1,
      agent_id: "main-user",
      observation: "Direct file modification on main thread",
      remediation: "Dispatch Tier 2 coordinator",
      context: { cwd: sandbox, indicators: {} },
    };

    recordDefect(defect, { cwd: sandbox });
    expect(recordDefect).toBeDefined();

    const ctxWithDefect = identifyExecutionContext({
      cwd: sandbox,
      runRoot: sandbox,
      isInteractiveMainThread: true,
      argv: ["bun", "harness.ts", "task:claim"],
      recordDefectInTest: true,
    });
    expect(ctxWithDefect.defect).toBeDefined();
    expect(ctxWithDefect.defect?.severity).toBe("critical");
  });
});
