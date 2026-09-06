import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateCommandTerminalEvidence,
  type TerminalEvidenceValidationContext,
  type TerminalEvidenceValidationResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788679759242-9oasfd.ts";

describe("Defect Remediation: defect-cli-1788679759242-9oasfd", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679759242-9oasfd");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE.includes("C-f87dc8e8-ef4d-4e56-927a-3a4c23c2b063")).toBe(true);
  });

  test("flags running command intents lacking terminal evidence", () => {
    const ctx: TerminalEvidenceValidationContext = {
      commandIntents: [
        {
          commandId: "C-f87dc8e8-ef4d-4e56-927a-3a4c23c2b063",
          intent: "run-test",
          status: "running",
        },
      ],
    };
    const result: TerminalEvidenceValidationResult = validateCommandTerminalEvidence(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.missingEvidenceCommandIds).toContain("C-f87dc8e8-ef4d-4e56-927a-3a4c23c2b063");
    expect(result.error).toBe(
      "running command intents lack terminal evidence: C-f87dc8e8-ef4d-4e56-927a-3a4c23c2b063",
    );
  });

  test("passes when command intents have terminal evidence", () => {
    const ctx: TerminalEvidenceValidationContext = {
      commandIntents: [
        {
          commandId: "C-f87dc8e8-ef4d-4e56-927a-3a4c23c2b063",
          intent: "run-test",
          status: "running",
          terminalEvidence: {
            exitCode: 0,
            completedAt: Date.now(),
            terminalStatus: "completed",
          },
        },
      ],
    };
    const result: TerminalEvidenceValidationResult = validateCommandTerminalEvidence(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.missingEvidenceCommandIds.length).toBe(0);
  });
});
