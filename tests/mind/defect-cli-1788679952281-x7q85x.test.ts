import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  evaluateValidatorConfinement,
  delegateValidatorExecution,
  type ValidatorConfinementContext,
  type ValidatorConfinementResult,
} from "../../olt/scripts/src/mind/defect-cli-1788679952281-x7q85x.ts";

describe("Defect Remediation: defect-cli-1788679952281-x7q85x", () => {
  test("exports expected defect metadata and error code", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679952281-x7q85x");
    expect(ERROR_CODE).toBe("ROLE_CONFINEMENT_VIOLATION");
    expect(DEFECT_TITLE.length).toBeGreaterThan(20);
    expect(DEFECT_TITLE).toContain("validator_lifecycle");
  });

  test("rejects direct execution tool category by cognitive validator", () => {
    const context: ValidatorConfinementContext = {
      actor: "validator_lifecycle",
      role: "validator",
      toolCategory: "test-runner",
      validatorSubtype: "cognitive",
    };
    const result: ValidatorConfinementResult = evaluateValidatorConfinement(context);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toBe(DEFECT_TITLE);
  });

  test("allows execution when delegated to mechanic validator", () => {
    const result: ValidatorConfinementResult = delegateValidatorExecution(
      "validator_lifecycle",
      "test-runner",
      "mechanic_validator_runner",
    );
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.remediationAction).toContain("Delegated");
  });

  test("permits read-only inspection tools for cognitive validator", () => {
    const context: ValidatorConfinementContext = {
      actor: "validator_lifecycle",
      role: "validator",
      toolCategory: "file-reader",
      validatorSubtype: "cognitive",
    };
    const result: ValidatorConfinementResult = evaluateValidatorConfinement(context);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});
