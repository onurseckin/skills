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
});
