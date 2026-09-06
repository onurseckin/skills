import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  resolveSyncCommand,
  type SyncCommandResolutionContext,
  type SyncCommandResolutionResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788680173232-dgvusi.ts";

describe("Defect Remediation: defect-cli-1788680173232-dgvusi", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788680173232-dgvusi");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("sync")).toBe(true);
  });

  test("resolves sync alias to queue:wave", () => {
    const ctx: SyncCommandResolutionContext = {
      requestedCommand: "sync",
    };
    const result: SyncCommandResolutionResult = resolveSyncCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.resolved).toBe(true);
    expect(result.canonicalCommand).toBe("queue:wave");
  });

  test("rejects unknown command", () => {
    const ctx: SyncCommandResolutionContext = {
      requestedCommand: "sync:all",
    };
    const result: SyncCommandResolutionResult = resolveSyncCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toBe("unknown command: sync:all");
  });
});
