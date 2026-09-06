import { describe, expect, test } from "bun:test";
import {
  AUTHORIZED_ROLES_FOR_TASK_ABANDON,
  IMPLEMENTER_YAML_CONTRACT,
  formatImplementerGuardError,
  guardRoleTaskBoundary,
  auditImplementerGuardInterlock,
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  IMPLEMENTER_COMMANDS,
  type RoleBoundaryGuardVerdict,
  type Defect1788679595404156ubwResult,
} from "../../olt/scripts/src/engine/defect-cli-1788679595404-156ubw.ts";

describe("Defect Remediation: defect-cli-1788679595404-156ubw", () => {
  test("exports valid defect metadata and constants", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679595404-156ubw");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE).toContain("role implementer may not invoke task:abandon");
    expect(AUTHORIZED_ROLES_FOR_TASK_ABANDON).toContain("coordinator");
    expect(AUTHORIZED_ROLES_FOR_TASK_ABANDON.includes("implementer")).toBe(false);
  });

  test("verifies implementer yaml contract structure and commands", () => {
    expect(IMPLEMENTER_YAML_CONTRACT.path).toBe(
      "/Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml",
    );
    expect(String(IMPLEMENTER_YAML_CONTRACT)).toBe(
      "/Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml",
    );
    expect(IMPLEMENTER_YAML_CONTRACT.role).toBe("implementer");
    expect(IMPLEMENTER_YAML_CONTRACT.commands).toContain("task:claim");
    expect(IMPLEMENTER_YAML_CONTRACT.commands).toContain("task:submit");
    expect(IMPLEMENTER_YAML_CONTRACT.commands).toContain("run:exec");
    expect(IMPLEMENTER_YAML_CONTRACT.commands.includes("task:abandon")).toBe(false);
    expect(IMPLEMENTER_COMMANDS.length).toBe(22);
  });

  test("formats exact implementer guard error message by default", () => {
    const errorMsg = formatImplementerGuardError();
    const expected =
      "role implementer may not invoke task:abandon: agent implementer_guard holds a implementer grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/implementer.yaml grants only task:brief, task:claim, queue:pop, task:check, task:heartbeat, run:exec, task:submit, task:release, branch:open, branch:collect, branch:abandon, finding:get, report:get, evidence:get, agent:register, agent:report, agent:release, doctor, whoami, msg:send, msg:recv, msg:poll. [Remediation: Ensure agent holds an authorized role for task:abandon or delegate the action to an authorized subagent via subagent dispatch.]";
    expect(errorMsg).toBe(expected);
  });

  test("formats customized implementer guard error with options and strings", () => {
    const customMsg = formatImplementerGuardError({
      agentId: "implementer_custom",
      command: "task:abandon",
      role: "implementer",
    });
    expect(customMsg).toContain("agent implementer_custom holds a implementer grant");
    expect(customMsg).toContain("role implementer may not invoke task:abandon");

    const positionalMsg = formatImplementerGuardError("implementer_test");
    expect(positionalMsg).toContain("agent implementer_test holds a implementer grant");
  });

  test("guardRoleTaskBoundary blocks implementer from task:abandon", () => {
    const verdict: RoleBoundaryGuardVerdict = guardRoleTaskBoundary(
      "implementer",
      "task:abandon",
      "implementer_guard",
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.errorCode).toBe(ERROR_CODE);
    expect(verdict.error).toBeDefined();
    expect(verdict.error).toContain("role implementer may not invoke task:abandon");
    expect(verdict.remediation).toContain("Ensure agent holds an authorized role for task:abandon");
  });

  test("guardRoleTaskBoundary allows coordinator to invoke task:abandon", () => {
    const verdict: RoleBoundaryGuardVerdict = guardRoleTaskBoundary(
      "coordinator",
      "task:abandon",
      "coordinator_lead",
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.error).toBeUndefined();
  });

  test("guardRoleTaskBoundary allows implementer to invoke granted commands", () => {
    const claimVerdict = guardRoleTaskBoundary("implementer", "task:claim", "implementer_3");
    expect(claimVerdict.allowed).toBe(true);

    const submitVerdict = guardRoleTaskBoundary("implementer", "task:submit", "implementer_3");
    expect(submitVerdict.allowed).toBe(true);

    const execVerdict = guardRoleTaskBoundary("implementer", "run:exec", "implementer_3");
    expect(execVerdict.allowed).toBe(true);
  });

  test("guardRoleTaskBoundary blocks implementer from non-granted commands", () => {
    const ungrantedVerdict = guardRoleTaskBoundary(
      "implementer",
      "plan:compile",
      "implementer_guard",
    );
    expect(ungrantedVerdict.allowed).toBe(false);
    expect(ungrantedVerdict.errorCode).toBe(ERROR_CODE);
  });

  test("auditImplementerGuardInterlock verifies interlock remediation cleanly", () => {
    const result: Defect1788679595404156ubwResult = auditImplementerGuardInterlock();
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.verdicts.length).toBeGreaterThanOrEqual(4);
  });

  test("auditImplementerGuardInterlock handles targeted options", () => {
    const targetedResult = auditImplementerGuardInterlock({
      agentId: "implementer_guard",
      role: "implementer",
      command: "task:abandon",
    });
    expect(targetedResult.remediated).toBe(true);
    expect(targetedResult.allowed).toBe(true);
    expect(targetedResult.errors.length).toBe(0);
  });
});
