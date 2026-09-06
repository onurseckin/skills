import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  resolveTaskRecoverCommand,
  type TaskRecoveryCommandContext,
  type TaskRecoveryCommandResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788679439467-6gsvmd.ts";

describe("Defect Remediation: defect-cli-1788679439467-6gsvmd", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679439467-6gsvmd");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("task:recover")).toBe(true);
  });

  test("resolves task:recover to task:release", () => {
    const ctx: TaskRecoveryCommandContext = {
      requestedCommand: "task:recover",
      taskId: "task-lane-2",
    };
    const result: TaskRecoveryCommandResult = resolveTaskRecoverCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.resolved).toBe(true);
    expect(result.canonicalCommand).toBe("task:release");
    expect(result.action).toBe("release_orphaned_lease");
  });

  test("preserves native task:release command", () => {
    const ctx: TaskRecoveryCommandContext = {
      requestedCommand: "task:release",
    };
    const result: TaskRecoveryCommandResult = resolveTaskRecoverCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(true);
    expect(result.canonicalCommand).toBe("task:release");
  });

  test("rejects unknown command", () => {
    const ctx: TaskRecoveryCommandContext = {
      requestedCommand: "task:explode",
    };
    const result: TaskRecoveryCommandResult = resolveTaskRecoverCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toBe("unknown command: task:explode");
  });
});
