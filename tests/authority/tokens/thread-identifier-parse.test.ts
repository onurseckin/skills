import { describe, expect, test } from "bun:test";
import {
  agentIdToRole,
  agentIdToTier,
  isStandardAgentId,
  parseStandardAgentId,
  parseTierValue,
  recommendStandardAgentId,
  roleToTier,
  TIER_NAMES,
  validateAgentNamingConvention,
} from "../../../olt/scripts/src/authority/thread/index.ts";

describe("Thread Identifier - Parsing, Tiers, and Naming Standards", () => {
  test("TIER_NAMES explicitly defines all 4 execution tiers", () => {
    expect(TIER_NAMES[0]).toContain("Tier 0: Mind Lead");
    expect(TIER_NAMES[1]).toContain("Tier 1: Orchestrator Lead");
    expect(TIER_NAMES[2]).toContain("Tier 2: Coordinator Lead");
    expect(TIER_NAMES[3]).toContain("Tier 3: Implementer / Validator");
  });

  test("parseTierValue parses strings into correct execution tiers", () => {
    expect(parseTierValue("0")).toBe(0);
    expect(parseTierValue("tier-0")).toBe(0);
    expect(parseTierValue("tier_0")).toBe(0);
    expect(parseTierValue("tier 0")).toBe(0);
    expect(parseTierValue("mind")).toBe(0);
    expect(parseTierValue("human")).toBe(0);
    expect(parseTierValue("Tier 0: Mind Lead")).toBe(0);

    expect(parseTierValue("1")).toBe(1);
    expect(parseTierValue("tier-1")).toBe(1);
    expect(parseTierValue("tier_1")).toBe(1);
    expect(parseTierValue("tier 1")).toBe(1);
    expect(parseTierValue("orchestrator")).toBe(1);
    expect(parseTierValue("orch")).toBe(1);
    expect(parseTierValue("mind-auditor")).toBe(1);
    expect(parseTierValue("auditor")).toBe(1);

    expect(parseTierValue("2")).toBe(2);
    expect(parseTierValue("tier-2")).toBe(2);
    expect(parseTierValue("tier_2")).toBe(2);
    expect(parseTierValue("tier 2")).toBe(2);
    expect(parseTierValue("coordinator")).toBe(2);
    expect(parseTierValue("coord")).toBe(2);

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

  test("parseStandardAgentId parses standard agent IDs correctly", () => {
    const mindParsed = parseStandardAgentId("mind_pulse-gen-1");
    expect(mindParsed).not.toBeNull();
    expect(mindParsed?.role).toBe("mind");
    expect(mindParsed?.tier).toBe(0);
    expect(mindParsed?.bindingType).toBe("pulse");
    expect(mindParsed?.contextOrTaskId).toBe("pulse-gen-1");

    const orchParsed = parseStandardAgentId("orchestrator_wave-2-foundations");
    expect(orchParsed).not.toBeNull();
    expect(orchParsed?.role).toBe("orchestrator");
    expect(orchParsed?.tier).toBe(1);
    expect(orchParsed?.bindingType).toBe("phase");

    const auditorParsed = parseStandardAgentId("mind-auditor_audit-gen-1");
    expect(auditorParsed).not.toBeNull();
    expect(auditorParsed?.role).toBe("mind-auditor");
    expect(auditorParsed?.tier).toBe(1);
    expect(auditorParsed?.bindingType).toBe("audit");

    const coordParsed = parseStandardAgentId("coordinator_domain-cli-tools");
    expect(coordParsed).not.toBeNull();
    expect(coordParsed?.role).toBe("coordinator");
    expect(coordParsed?.tier).toBe(2);
    expect(coordParsed?.bindingType).toBe("domain");

    const implParsed = parseStandardAgentId("implementer_task-p47-autonomic-watchdog");
    expect(implParsed).not.toBeNull();
    expect(implParsed?.role).toBe("implementer");
    expect(implParsed?.tier).toBe(3);
    expect(implParsed?.bindingType).toBe("task");
    expect(implParsed?.taskId).toBe("task-p47");
    expect(implParsed?.taskSlug).toBe("autonomic-watchdog");

    const valParsed = parseStandardAgentId("validator_task-p47-autonomic-watchdog");
    expect(valParsed).not.toBeNull();
    expect(valParsed?.role).toBe("validator");
    expect(valParsed?.tier).toBe(3);
    expect(valParsed?.taskId).toBe("task-p47");

    const repParsed = parseStandardAgentId("repairer_task-p47");
    expect(repParsed).not.toBeNull();
    expect(repParsed?.role).toBe("repairer");
    expect(repParsed?.tier).toBe(3);
    expect(repParsed?.taskId).toBe("task-p47");

    const criticParsed = parseStandardAgentId("completeness-critic_wave-2-foundations");
    expect(criticParsed).not.toBeNull();
    expect(criticParsed?.role).toBe("completeness-critic");

    const plannerParsed = parseStandardAgentId("planner_phase-1-planning");
    expect(plannerParsed).not.toBeNull();
    expect(plannerParsed?.role).toBe("planner");

    const planValParsed = parseStandardAgentId("plan-validator_phase-1-planning");
    expect(planValParsed).not.toBeNull();
    expect(planValParsed?.role).toBe("plan-validator");

    const valCodeParsed = parseStandardAgentId("validator-code-quality_task-p47");
    expect(valCodeParsed).not.toBeNull();
    expect(valCodeParsed?.role).toBe("validator-code-quality");

    const subImplParsed = parseStandardAgentId("sub-implementer_task-p47-sub1");
    expect(subImplParsed).not.toBeNull();
    expect(subImplParsed?.role).toBe("sub-implementer");
  });

  test("parseStandardAgentId and isStandardAgentId reject non-standard agent IDs", () => {
    expect(parseStandardAgentId("no-underscore-here")).toBeNull();
    expect(parseStandardAgentId("_leading-underscore")).toBeNull();
    expect(parseStandardAgentId("trailing-underscore_")).toBeNull();
    expect(parseStandardAgentId("unknown-role_task-1")).toBeNull();
    expect(parseStandardAgentId("implementer_INVALID_UPPERCASE")).toBeNull();
    expect(parseStandardAgentId("")).toBeNull();

    expect(isStandardAgentId("implementer_task-p47-autonomic-watchdog")).toBe(true);
    expect(isStandardAgentId("random-agent-123")).toBe(false);
  });

  test("recommendStandardAgentId constructs canonical agent identifiers", () => {
    expect(recommendStandardAgentId("implementer", "task-p47")).toBe("implementer_task-p47");
    expect(recommendStandardAgentId("implementer", "task-p47", "autonomic-watchdog")).toBe(
      "implementer_task-p47-autonomic-watchdog",
    );
    expect(recommendStandardAgentId("validator", "task-p47")).toBe("validator_task-p47");
    expect(recommendStandardAgentId("coordinator", "domain-cli")).toBe("coordinator_domain-cli");
    expect(recommendStandardAgentId("custom-role", "context-1")).toBe("custom-role_context-1");
  });

  test("validateAgentNamingConvention validates matches, roles, tiers, and task IDs", () => {
    const validRes = validateAgentNamingConvention(
      "implementer_task-p47-autonomic-watchdog",
      "implementer",
      3,
      "task-p47",
    );
    expect(validRes.valid).toBe(true);
    expect(validRes.role).toBe("implementer");
    expect(validRes.tier).toBe(3);
    expect(validRes.reason).toBeNull();

    const invalidFormat = validateAgentNamingConvention(
      "custom-agent-name",
      "implementer",
      3,
      "task-p47",
    );
    expect(invalidFormat.valid).toBe(false);
    expect(invalidFormat.reason).toContain("does not match the standardized naming convention");
    expect(invalidFormat.recommendedAgentId).toBe("implementer_task-p47");

    const roleMismatch = validateAgentNamingConvention(
      "validator_task-p47-autonomic-watchdog",
      "implementer",
      3,
      "task-p47",
    );
    expect(roleMismatch.valid).toBe(false);
    expect(roleMismatch.reason).toContain("Role mismatch");
    expect(roleMismatch.recommendedAgentId).toBe("implementer_task-p47");

    const tierMismatch = validateAgentNamingConvention("coordinator_domain-cli", "coordinator", 3);
    expect(tierMismatch.valid).toBe(false);
    expect(tierMismatch.reason).toContain("Tier mismatch");

    const taskIdMismatch = validateAgentNamingConvention(
      "implementer_task-p47-watchdog",
      "implementer",
      3,
      "task-p48",
    );
    expect(taskIdMismatch.valid).toBe(false);
    expect(taskIdMismatch.reason).toContain("Task ID mismatch");
    expect(taskIdMismatch.recommendedAgentId).toBe("implementer_task-p48-watchdog");

    const inferredRoleValidation = validateAgentNamingConvention("coord-custom-suffix");
    expect(inferredRoleValidation.valid).toBe(false);
    expect(inferredRoleValidation.recommendedAgentId).toBe("coordinator_task-id");
  });
});
