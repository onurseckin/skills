import { describe, expect, it } from "bun:test";
import { BootGateEnforcer } from "../../../olt/scripts/src/watchdog/boot-gate-enforcer/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("BootGateEnforcer Pre-Flight Gate Verification", () => {
  it("enforces whoami and doctor pre-flight gates sequentially", () => {
    const enforcer = new BootGateEnforcer();
    const agent = enforcer.registerSpawnedSubagent({
      agentId: "impl-wave-01",
      role: "implementer",
      taskId: "task-p47",
    });

    expect(agent.bootGatePassed).toBe(false);
    expect(agent.whoamiExecuted).toBe(false);
    expect(agent.doctorExecuted).toBe(false);

    // Initial state fails assertions
    expect(() => enforcer.assertBootGatesPassed("impl-wave-01", "claiming task")).toThrow(
      HarnessError,
    );

    // After whoami
    enforcer.recordWhoamiExecution("impl-wave-01");
    const v1 = enforcer.verifyBootGates("impl-wave-01");
    expect(v1.passed).toBe(false);
    expect(v1.missingGates).toEqual(["doctor"]);
    expect(() => enforcer.assertBootGatesPassed("impl-wave-01", "writing files")).toThrow(
      HarnessError,
    );

    // After doctor
    enforcer.recordDoctorExecution("impl-wave-01");
    const v2 = enforcer.verifyBootGates("impl-wave-01");
    expect(v2.passed).toBe(true);
    expect(v2.missingGates).toEqual([]);
    expect(() => enforcer.assertBootGatesPassed("impl-wave-01", "claiming task")).not.toThrow();
  });

  it("handles unregistered subagent verification gracefully", () => {
    const enforcer = new BootGateEnforcer();
    const result = enforcer.verifyBootGates("unknown-agent");
    expect(result.passed).toBe(false);
    expect(result.missingGates).toEqual(["whoami", "doctor"]);
    expect(result.violations[0]).toContain("has no recorded pre-flight boot gates");

    expect(() => enforcer.assertBootGatesPassed("unknown-agent")).toThrow(HarnessError);
  });

  it("registers subagents idempotently and manages lifecycle reset", () => {
    const enforcer = new BootGateEnforcer();
    const r1 = enforcer.registerSpawnedSubagent({ agentId: "agent-a", role: "implementer" });
    const r2 = enforcer.registerSpawnedSubagent({ agentId: "agent-a", role: "implementer" });
    expect(r1).toBe(r2);

    expect(enforcer.getAllRecords().length).toBe(1);
    expect(enforcer.getRecord("agent-a")?.agentId).toBe("agent-a");

    enforcer.reset();
    expect(enforcer.getAllRecords().length).toBe(0);
    expect(enforcer.getRecord("agent-a")).toBeUndefined();
  });

  it("detects whoami and doctor invocations inside arbitrary command line arrays", () => {
    const enforcer = new BootGateEnforcer();
    enforcer.registerSpawnedSubagent({ agentId: "sub-1", role: "implementer" });

    enforcer.recordCommandExecution("sub-1", ["bun", "scripts/harness.ts", "whoami"]);
    expect(enforcer.getRecord("sub-1")?.whoamiExecuted).toBe(true);
    expect(enforcer.getRecord("sub-1")?.doctorExecuted).toBe(false);

    enforcer.recordCommandExecution("sub-1", ["bun", "scripts/harness.ts", "doctor", "--run"]);
    expect(enforcer.getRecord("sub-1")?.doctorExecuted).toBe(true);
    expect(enforcer.getRecord("sub-1")?.bootGatePassed).toBe(true);
  });
});
