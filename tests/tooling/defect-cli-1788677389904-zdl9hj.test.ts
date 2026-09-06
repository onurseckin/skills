import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  CANONICAL_STATUS_COMMANDS,
  resolveStatusCommand,
  buildStatusCommandManifest,
  type StatusResolutionContext,
  type StatusResolutionResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788677389904-zdl9hj.ts";

describe("Defect Remediation: defect-cli-1788677389904-zdl9hj", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788677389904-zdl9hj");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("status")).toBe(true);
  });

  test("resolves bare status command to run:status", () => {
    const ctx: StatusResolutionContext = {
      command: "status",
      actor: "coordinator_tooling_cluster",
    };
    const result: StatusResolutionResult = resolveStatusCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.resolved).toBe(true);
    expect(result.targetCommand).toBe("run:status");
  });

  test("resolves task:status and queue:status aliases", () => {
    expect(CANONICAL_STATUS_COMMANDS["task:status"]).toBe("task:brief");
    expect(CANONICAL_STATUS_COMMANDS["queue:status"]).toBe("queue:wave");
    expect(CANONICAL_STATUS_COMMANDS["capsule:status"]).toBe("run:status");
  });

  test("builds complete status command manifest", () => {
    const manifest = buildStatusCommandManifest();
    expect(manifest.length).toBeGreaterThanOrEqual(4);
    const bareStatus = manifest.find((m) => m.rawCommand === "status");
    expect(bareStatus).toBeDefined();
    expect(bareStatus?.resolvedCommand).toBe("run:status");
  });

  test("fails resolution cleanly for unknown non-status commands", () => {
    const ctx: StatusResolutionContext = {
      command: "unknown_nonexistent_command",
    };
    const result: StatusResolutionResult = resolveStatusCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.resolved).toBe(false);
    expect(result.error).toBe("unknown command: unknown_nonexistent_command");
  });
});
