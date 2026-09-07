import { describe, expect, it } from "bun:test";
import { evaluateRulesBatch1 } from "../../../olt/scripts/src/authority/supervisory/eval-rules-1.ts";
import { evaluateRulesBatch2 } from "../../../olt/scripts/src/authority/supervisory/eval-rules-2.ts";
import type { UnifiedAgentModel } from "../../../olt/scripts/src/authority/manifest/types.ts";
import type {
  PersonaViolation,
  SupervisoryReminderEvaluationContext,
} from "../../../olt/scripts/src/authority/supervisory/types.ts";

const dummyModel: UnifiedAgentModel = {
  name: "test-coordinator",
  role: "coordinator",
  tier: 1,
};

describe("Supervisory Rule: Evaluation Batches 1 & 2", () => {
  it("detects SUPERVISOR_ZERO_FILE_EDIT_BREACH when tier < 3 role modifies code", () => {
    const violations: PersonaViolation[] = [];
    const directives: string[] = [];
    const ctx: SupervisoryReminderEvaluationContext = {
      fileModificationsOnSupervisoryThread: ["src/index.ts"],
    };

    evaluateRulesBatch1("coordinator", 1, dummyModel, ctx, [], violations, directives);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.code === "SUPERVISOR_ZERO_FILE_EDIT_BREACH")).toBe(true);
    const v = violations.find((v) => v.code === "SUPERVISOR_ZERO_FILE_EDIT_BREACH");
    expect(v?.severity).toBe("critical");
  });

  it("passes clean supervisor without direct file edits", () => {
    const violations: PersonaViolation[] = [];
    const directives: string[] = [];
    const ctx: SupervisoryReminderEvaluationContext = {
      fileModificationsOnSupervisoryThread: [],
      directExecutionAttempts: [],
    };

    evaluateRulesBatch1("coordinator", 1, dummyModel, ctx, [], violations, directives);
    expect(violations.filter((v) => v.code === "SUPERVISOR_ZERO_FILE_EDIT_BREACH").length).toBe(0);
  });

  it("detects FOUR_TIER_VIEWPORT_MATRIX_BREACH when UI tasks lack multi-viewport checks", () => {
    const violations: PersonaViolation[] = [];
    const directives: string[] = [];
    const ctx: SupervisoryReminderEvaluationContext = {
      uiTasksMissingViewportValidation: ["task-login-ui"],
    };

    evaluateRulesBatch2("coordinator", 1, ctx, [], violations, directives);
    expect(violations.some((v) => v.code === "FOUR_TIER_VIEWPORT_MATRIX_BREACH")).toBe(true);
  });

  it("detects SUPERVISOR_TASK_SELF_EXECUTION_BREACH when supervisor claims or implements tasks", () => {
    const violations: PersonaViolation[] = [];
    const directives: string[] = [];
    const ctx: SupervisoryReminderEvaluationContext = {
      directExecutionAttempts: ["claim_task", "implement_task"],
    };

    evaluateRulesBatch1("coordinator", 1, dummyModel, ctx, [], violations, directives);
    expect(violations.some((v) => v.code === "SUPERVISOR_TASK_SELF_EXECUTION_BREACH")).toBe(true);
    const v = violations.find((v) => v.code === "SUPERVISOR_TASK_SELF_EXECUTION_BREACH");
    expect(v?.severity).toBe("critical");
  });

  it("detects UNPROVEN_GATE_RISK for tier 2 coordinator with unproven compiled gates", () => {
    const violations: PersonaViolation[] = [];
    const directives: string[] = [];
    const ctx: SupervisoryReminderEvaluationContext = {
      unprovenGatesCount: 3,
    };

    evaluateRulesBatch2("coordinator", 2, ctx, [], violations, directives);
    expect(violations.some((v) => v.code === "UNPROVEN_GATE_RISK")).toBe(true);
  });

  it("detects QUALITATIVE_PASS_RUBBER_STAMP_BREACH when supervisor accepts qualitative-only passes", () => {
    const violations: PersonaViolation[] = [];
    const directives: string[] = [];
    const ctx: SupervisoryReminderEvaluationContext = {
      qualitativePassesWithoutProof: ["task-report-pass"],
    };

    evaluateRulesBatch2("coordinator", 1, ctx, [], violations, directives);
    expect(violations.some((v) => v.code === "QUALITATIVE_PASS_RUBBER_STAMP_BREACH")).toBe(true);
  });

  it("accumulates multiple distinct violations across batch 1 and batch 2 in contaminated context", () => {
    const violations: PersonaViolation[] = [];
    const directives: string[] = [];
    const ctx: SupervisoryReminderEvaluationContext = {
      fileModificationsOnSupervisoryThread: ["src/app.ts"],
      directExecutionAttempts: ["claim_task"],
      uiTasksMissingViewportValidation: ["task-checkout-ui"],
      qualitativePassesWithoutProof: ["task-pass-unproven"],
    };

    evaluateRulesBatch1("coordinator", 1, dummyModel, ctx, [], violations, directives);
    evaluateRulesBatch2("coordinator", 1, ctx, [], violations, directives);

    const codes = violations.map((v) => v.code);
    expect(codes).toContain("SUPERVISOR_ZERO_FILE_EDIT_BREACH");
    expect(codes).toContain("SUPERVISOR_TASK_SELF_EXECUTION_BREACH");
    expect(codes).toContain("FOUR_TIER_VIEWPORT_MATRIX_BREACH");
    expect(codes).toContain("QUALITATIVE_PASS_RUBBER_STAMP_BREACH");
    expect(violations.length).toBeGreaterThanOrEqual(4);
    expect(directives.length).toBeGreaterThanOrEqual(4);
  });

  it("exempts tier 3 implementers from SUPERVISOR_ZERO_FILE_EDIT_BREACH", () => {
    const violations: PersonaViolation[] = [];
    const directives: string[] = [];
    const ctx: SupervisoryReminderEvaluationContext = {
      fileModificationsOnSupervisoryThread: ["src/app.ts"],
    };
    const implementerModel: UnifiedAgentModel = {
      name: "test-implementer",
      role: "implementer",
      tier: 3,
    };

    evaluateRulesBatch1("implementer", 3, implementerModel, ctx, [], violations, directives);
    expect(violations.filter((v) => v.code === "SUPERVISOR_ZERO_FILE_EDIT_BREACH").length).toBe(0);
  });
});
