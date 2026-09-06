import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  COORDINATOR_AUTHORIZED_COMMANDS,
  auditCoordinatorCommandPermission,
} from "../../olt/scripts/src/mind/defect-cli-1788677361278-my38v3.ts";

describe("Defect Remediation: defect-cli-1788677361278-my38v3", () => {
  test("exports defect constants and allowed commands list", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788677361278-my38v3");
    expect(ERROR_CODE).toBe("PERMISSION_DENIED");
    expect(COORDINATOR_AUTHORIZED_COMMANDS.includes("plan:init")).toBe(true);
    expect(COORDINATOR_AUTHORIZED_COMMANDS.includes("run:exec")).toBe(false);
  });

  test("allows authorized coordinator commands", () => {
    const result = auditCoordinatorCommandPermission({
      role: "coordinator",
      actor: "coordinator_wave1",
      command: "plan:init",
    });
    expect(result.allowed).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("rejects coordinator invoking run:exec with permission denied", () => {
    const result = auditCoordinatorCommandPermission({
      role: "coordinator",
      actor: "coordinator_wave1",
      command: "run:exec",
    });
    expect(result.allowed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("role coordinator may not invoke run:exec");
  });
});
