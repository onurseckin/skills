import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_MESSAGE,
  formatBrainstormCapsuleError,
  evaluateBrainstormCapsuleLoading,
  auditBrainstormCapsuleState,
  type BrainstormCapsuleInspection,
  type Defect1788681063648Idt2y7Result,
} from "../../olt/scripts/src/mind/defect-cli-1788681063648-idt2y7.ts";

describe("Defect Remediation: defect-cli-1788681063648-idt2y7", () => {
  test("exports constants with expected values", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788681063648-idt2y7");
    expect(ERROR_CODE).toBe("CAPSULE_UNREADABLE");
    expect(DEFECT_MESSAGE).toContain("plan:brainstorm could not load capsule state");
  });

  test("formatBrainstormCapsuleError formats error message correctly", () => {
    const defaultErr = formatBrainstormCapsuleError();
    expect(defaultErr).toBe(DEFECT_MESSAGE);

    const customRun = formatBrainstormCapsuleError("test-run");
    expect(customRun).toContain("--run test-run");

    const allowlistMsg = formatBrainstormCapsuleError("test-run", true);
    expect(allowlistMsg).toContain("via grant bootstrap allowlist");
  });

  test("evaluateBrainstormCapsuleLoading checks readability and allowlist", () => {
    const unreadableDisallowed: BrainstormCapsuleInspection = {
      runId: "cross-system-communication-system",
      isReadable: false,
      onAllowlist: false,
    };
    expect(evaluateBrainstormCapsuleLoading(unreadableDisallowed)).toBe(false);

    const unreadableAllowed: BrainstormCapsuleInspection = {
      runId: "cross-system-communication-system",
      isReadable: false,
      onAllowlist: true,
    };
    expect(evaluateBrainstormCapsuleLoading(unreadableAllowed)).toBe(true);

    const readable: BrainstormCapsuleInspection = {
      runId: "active-run",
      isReadable: true,
      onAllowlist: false,
    };
    expect(evaluateBrainstormCapsuleLoading(readable)).toBe(true);
  });

  test("auditBrainstormCapsuleState detects default unreadable state", () => {
    const result: Defect1788681063648Idt2y7Result = auditBrainstormCapsuleState();
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toBe(DEFECT_MESSAGE);
  });

  test("auditBrainstormCapsuleState passes when readable", () => {
    const result = auditBrainstormCapsuleState({
      runId: "clean-run",
      isReadable: true,
      onAllowlist: false,
    });
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});
