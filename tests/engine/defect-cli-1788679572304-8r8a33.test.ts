import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_MESSAGE,
  IMPLEMENTER_CONTRACT_PATH,
  IMPLEMENTER_ALLOWED_COMMANDS,
  IMPLEMENTER_GRANTED_COMMANDS,
  TASK_ABANDON_AUTHORIZED_ROLES,
  type ImplementerLifecycleEvaluation,
  type Defect17886795723048r8a33Result,
  formatImplementerAbandonError,
  formatRoleBoundaryError,
  evaluateImplementerLifecycleAction,
  auditImplementerLifecycleBoundary,
  auditImplementerTaskAbandonBoundary,
  isCommandGrantedToRole,
} from "../../olt/scripts/src/engine/defect-cli-1788679572304-8r8a33.ts";

describe("Defect Remediation: defect-cli-1788679572304-8r8a33", () => {
  test("exports expected defect metadata and configuration constants", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679572304-8r8a33");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_MESSAGE).toContain("role implementer may not invoke task:abandon");
    expect(DEFECT_MESSAGE).toContain("implementer_lifecycle");
    expect(IMPLEMENTER_CONTRACT_PATH).toBe(
      "/Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml",
    );
    expect(IMPLEMENTER_ALLOWED_COMMANDS.length).toBe(22);
    expect(IMPLEMENTER_ALLOWED_COMMANDS).toContain("task:brief");
    expect(IMPLEMENTER_ALLOWED_COMMANDS).toContain("task:claim");
    expect(IMPLEMENTER_ALLOWED_COMMANDS).toContain("task:release");
    expect(IMPLEMENTER_ALLOWED_COMMANDS).toContain("branch:abandon");
    expect(IMPLEMENTER_ALLOWED_COMMANDS).not.toContain("task:abandon");
    expect(IMPLEMENTER_GRANTED_COMMANDS).toEqual(IMPLEMENTER_ALLOWED_COMMANDS);
    expect(TASK_ABANDON_AUTHORIZED_ROLES).toContain("coordinator");
  });

  test("verifies role command grant matrix cleanly", () => {
    expect(isCommandGrantedToRole("implementer", "task:brief")).toBe(true);
    expect(isCommandGrantedToRole("implementer", "task:claim")).toBe(true);
    expect(isCommandGrantedToRole("implementer", "task:check")).toBe(true);
    expect(isCommandGrantedToRole("implementer", "task:submit")).toBe(true);
    expect(isCommandGrantedToRole("implementer", "task:release")).toBe(true);
    expect(isCommandGrantedToRole("implementer", "task:abandon")).toBe(false);
    expect(isCommandGrantedToRole("implementer", "unknown:command")).toBe(false);
    expect(isCommandGrantedToRole("coordinator", "task:abandon")).toBe(true);
    expect(isCommandGrantedToRole("unauthorized_role", "task:abandon")).toBe(false);
  });

  test("formats role boundary error message adhering to defect template", () => {
    const defaultFormatted = formatImplementerAbandonError();
    expect(defaultFormatted).toBe(DEFECT_MESSAGE);

    const customFormatted = formatImplementerAbandonError(
      "custom_implementer",
      "task:abandon",
      "implementer",
    );
    expect(customFormatted).toContain("agent custom_implementer holds a implementer grant");

    const roleBoundaryFormatted = formatRoleBoundaryError(
      "implementer_lifecycle",
      "implementer",
      "task:abandon",
      IMPLEMENTER_CONTRACT_PATH,
    );
    expect(roleBoundaryFormatted).toBe(DEFECT_MESSAGE);
  });

  test("evaluates implementer lifecycle actions accurately", () => {
    const allowedEval: ImplementerLifecycleEvaluation =
      evaluateImplementerLifecycleAction("task:claim");
    expect(allowedEval.allowed).toBe(true);
    expect(allowedEval.action).toBe("task:claim");
    expect(allowedEval.error).toBeUndefined();

    const blockedEval: ImplementerLifecycleEvaluation =
      evaluateImplementerLifecycleAction("task:abandon");
    expect(blockedEval.allowed).toBe(false);
    expect(blockedEval.action).toBe("task:abandon");
    expect(blockedEval.error).toBe(DEFECT_MESSAGE);
    expect(blockedEval.remediation).toBeDefined();

    const coordinatorEval = evaluateImplementerLifecycleAction(
      "task:abandon",
      "coordinator_agent",
      "coordinator",
    );
    expect(coordinatorEval.allowed).toBe(true);

    const objectInputEval = evaluateImplementerLifecycleAction({
      action: "task:release",
      agentId: "worker_impl",
    });
    expect(objectInputEval.allowed).toBe(true);

    const objectBlockedEval = evaluateImplementerLifecycleAction({
      action: "task:abandon",
      agentId: "worker_impl",
      role: "implementer",
    });
    expect(objectBlockedEval.allowed).toBe(false);
  });

  test("audits implementer lifecycle boundary for defect remediation", () => {
    const defaultAudit: Defect17886795723048r8a33Result = auditImplementerLifecycleBoundary();
    expect(defaultAudit.remediated).toBe(true);
    expect(defaultAudit.defectId).toBe(DEFECT_ID);
    expect(defaultAudit.errorCode).toBe(ERROR_CODE);
    expect(defaultAudit.allowed).toBe(false);
    expect(defaultAudit.errors.length).toBe(1);
    expect(defaultAudit.errors[0]).toBe(DEFECT_MESSAGE);
    expect(defaultAudit.evaluation.allowed).toBe(false);

    const allowedAudit = auditImplementerLifecycleBoundary("task:claim");
    expect(allowedAudit.remediated).toBe(true);
    expect(allowedAudit.allowed).toBe(true);
    expect(allowedAudit.errors.length).toBe(0);

    const aliasAudit = auditImplementerTaskAbandonBoundary({
      action: "task:release",
      role: "implementer",
    });
    expect(aliasAudit.remediated).toBe(true);
    expect(aliasAudit.allowed).toBe(true);
    expect(aliasAudit.errors.length).toBe(0);
  });
});
