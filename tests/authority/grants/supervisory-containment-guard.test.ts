import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  assertSupervisoryContainment,
  checkSupervisoryContainment,
  detectSupervisoryViolation,
  isSupervisoryRoleForContainment,
  resetDefaultContainmentEngine,
  setDefaultContainmentEngine,
} from "../../../olt/scripts/src/authority/guards/index.ts";
import { MechanicalContainmentEngine } from "../../../olt/scripts/src/mind/containment/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

describe("Authority Guards Integration", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
    resetDefaultContainmentEngine();
    setDefaultContainmentEngine(new MechanicalContainmentEngine());
  });

  afterEach(() => {
    cleanupVirtualAuthorityFS();
    resetDefaultContainmentEngine();
  });

  test("recognizes supervisory roles across tiers", () => {
    expect(isSupervisoryRoleForContainment("mind")).toBe(true);
    expect(isSupervisoryRoleForContainment("mind_supervisor")).toBe(true);
    expect(isSupervisoryRoleForContainment("mind-supervisor")).toBe(true);
    expect(isSupervisoryRoleForContainment("mind-auditor")).toBe(true);
    expect(isSupervisoryRoleForContainment("orchestrator")).toBe(true);
    expect(isSupervisoryRoleForContainment("domain-orchestrator")).toBe(true);
    expect(isSupervisoryRoleForContainment("coordinator")).toBe(true);
    expect(isSupervisoryRoleForContainment("feature-coordinator")).toBe(true);
    expect(isSupervisoryRoleForContainment("coordinator-1")).toBe(true);
    expect(isSupervisoryRoleForContainment("implementer")).toBe(false);
    expect(isSupervisoryRoleForContainment("worker")).toBe(false);
    expect(isSupervisoryRoleForContainment("mechanic-validator")).toBe(false);
  });

  test("detects violations from tool names, commands, and arguments", () => {
    const v1 = detectSupervisoryViolation({
      role: "domain-coordinator",
      toolName: "write_to_file",
    });
    expect(v1?.violationType).toBe("DIRECT_CODE_EDIT");

    const v2 = detectSupervisoryViolation({
      role: "feature-coordinator",
      command: "bun test tests/unit.test.ts",
    });
    expect(v2?.violationType).toBe("DIRECT_TEST_RUN");

    const v3 = detectSupervisoryViolation({
      role: "orchestrator",
      command: "git commit -m 'update'",
    });
    expect(v3?.violationType).toBe("DIRECT_MUTATION_COMMAND");

    const v4 = detectSupervisoryViolation({
      role: "coordinator",
      command: "task:claim task-123",
    });
    expect(v4?.violationType).toBe("BYPASS_DELEGATION");

    const v5 = detectSupervisoryViolation({
      role: "mind",
      command: "critic:review finding-456",
    });
    expect(v5?.violationType).toBe("CRITIC_JOB_EXECUTION");

    const vNone = detectSupervisoryViolation({
      role: "implementer",
      toolName: "write_to_file",
    });
    expect(vNone).toBeNull();
  });

  test("checkSupervisoryContainment allows permitted actions and intercepts violations", () => {
    const allowed = checkSupervisoryContainment({
      agentId: "coord-1",
      role: "coordinator",
      toolName: "invoke_subagent",
    });
    expect(allowed.action).toBe("ALLOW");
    expect(allowed.blocked).toBe(false);

    const intercepted1 = checkSupervisoryContainment({
      agentId: "coord-1",
      role: "coordinator",
      toolName: "write_to_file",
      targetFile: "src/index.ts",
    });
    expect(intercepted1.action).toBe("HALT_AND_DELEGATE");
    expect(intercepted1.strikeLevel).toBe(1);
    expect(intercepted1.blocked).toBe(true);

    const intercepted2 = checkSupervisoryContainment({
      agentId: "coord-1",
      role: "coordinator",
      toolName: "replace_file_content",
      targetFile: "src/index.ts",
    });
    expect(intercepted2.action).toBe("CAPABILITY_REVOCATION");
    expect(intercepted2.strikeLevel).toBe(2);
    expect(intercepted2.blocked).toBe(true);

    const toolBlocked = checkSupervisoryContainment({
      agentId: "coord-1",
      role: "coordinator",
      toolName: "run_command",
    });
    expect(toolBlocked.blocked).toBe(true);
    expect(toolBlocked.action).toBe("CAPABILITY_REVOCATION");
  });

  test("assertSupervisoryContainment throws HarnessError when action is blocked", () => {
    expect(() => {
      assertSupervisoryContainment({
        agentId: "coord-strict",
        role: "coordinator",
        toolName: "write_to_file",
      });
    }).toThrow(HarnessError);

    try {
      assertSupervisoryContainment({
        agentId: "coord-strict",
        role: "coordinator",
        toolName: "write_to_file",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("ROLE_BOUNDARY_DEVIATION");
    }
  });

  test("non-supervisory roles bypass supervisory containment checks", () => {
    const res = checkSupervisoryContainment({
      agentId: "impl-1",
      role: "implementer",
      toolName: "write_to_file",
      targetFile: "src/impl.ts",
    });

    expect(res.action).toBe("ALLOW");
    expect(res.blocked).toBe(false);
    expect(res.strikeLevel).toBe(0);
  });
});
