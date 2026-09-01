import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  ALLOWED_SUPERVISORY_TOOLS,
  DEFAULT_REVOKED_TOOLS,
  MechanicalContainmentEngine,
  type AgentContainmentState,
} from "../../../olt/scripts/src/mind/containment/index.ts";
import {
  assertSupervisoryContainment,
  checkSupervisoryContainment,
  detectSupervisoryViolation,
  isSupervisoryRoleForContainment,
  resetDefaultContainmentEngine,
} from "../../../olt/scripts/src/authority/guards/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("MechanicalContainmentEngine", () => {
describe("Strike Reset, Decay, and TTL Expiration", () => {
    it("resets strikes cleanly via resetStrikes", () => {
      const engine = new MechanicalContainmentEngine();
      const agentId = "coord-reset";
      const role = "coordinator";

      engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_CODE_EDIT",
        attemptedAction: "write",
      });
      engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_CODE_EDIT",
        attemptedAction: "edit",
      });
      expect(engine.getAgentState(agentId).strikeCount).toBe(2);
      expect(engine.getAgentState(agentId).capabilitiesRevoked).toBe(true);

      engine.resetStrikes(agentId);
      const resetState = engine.getAgentState(agentId);
      expect(resetState.strikeCount).toBe(0);
      expect(resetState.capabilitiesRevoked).toBe(false);
      expect(resetState.isTerminated).toBe(false);
    });

    it("decays strikes by step via decayStrikes", () => {
      const engine = new MechanicalContainmentEngine();
      const agentId = "coord-decay";
      const role = "coordinator";

      engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_CODE_EDIT",
        attemptedAction: "write",
      });
      engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_CODE_EDIT",
        attemptedAction: "edit",
      });
      expect(engine.getAgentState(agentId).strikeCount).toBe(2);

      engine.decayStrikes(agentId, 1);
      const stateDecayed = engine.getAgentState(agentId);
      expect(stateDecayed.strikeCount).toBe(1);
      expect(stateDecayed.capabilitiesRevoked).toBe(false);

      engine.decayStrikes(agentId, 1);
      expect(engine.getAgentState(agentId).strikeCount).toBe(0);
    });

    it("decays expired strikes based on TTL via decayExpiredStrikes", () => {
      const engine = new MechanicalContainmentEngine({ strikeDecayMs: 5000 });
      const agentId = "coord-ttl";
      const role = "coordinator";

      const oldTimestamp = new Date(Date.now() - 10000).toISOString();
      engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_CODE_EDIT",
        attemptedAction: "write",
        timestamp: oldTimestamp,
      });

      expect(engine.getAgentState(agentId).strikeCount).toBe(1);

      const decayed = engine.decayExpiredStrikes();
      expect(decayed).toBe(1);
      expect(engine.getAgentState(agentId).strikeCount).toBe(0);
    });
  });

describe("Serialization and Deserialization", () => {
    it("serializes and restores containment engine state losslessly", () => {
      const engine = new MechanicalContainmentEngine({ strikeDecayMs: 60000 });
      engine.registerAgent("agent-ser-1", "coordinator");
      engine.interceptAction({
        agentId: "agent-ser-1",
        role: "coordinator",
        actionType: "DIRECT_CODE_EDIT",
        attemptedAction: "write_to_file",
        targetFile: "test.ts",
      });

      const json = engine.serialize();
      const restored = MechanicalContainmentEngine.deserialize(json);

      const restoredState = restored.getAgentState("agent-ser-1");
      expect(restoredState.strikeCount).toBe(1);
      expect(restoredState.role).toBe("coordinator");
      expect(restoredState.violations).toHaveLength(1);
      expect(restoredState.violations[0]?.targetFile).toBe("test.ts");
    });
  });

describe("Authority Guard Integration (assertSupervisoryContainment)", () => {
    it("permits actions unconditionally for non-supervisory worker roles", () => {
      const workerResult = checkSupervisoryContainment({
        agentId: "worker-impl-1",
        role: "implementer",
        toolName: "write_to_file",
        command: "bun test tests/unit",
      });

      expect(workerResult.action).toBe("ALLOW");
      expect(workerResult.blocked).toBe(false);
      expect(workerResult.strikeLevel).toBe(0);
    });

    it("identifies supervisory roles correctly via isSupervisoryRoleForContainment", () => {
      expect(isSupervisoryRoleForContainment("mind")).toBe(true);
      expect(isSupervisoryRoleForContainment("orchestrator")).toBe(true);
      expect(isSupervisoryRoleForContainment("coordinator")).toBe(true);
      expect(isSupervisoryRoleForContainment("domain-coordinator")).toBe(true);
      expect(isSupervisoryRoleForContainment("mind-auditor")).toBe(true);
      expect(isSupervisoryRoleForContainment("skill-auditor")).toBe(true);

      expect(isSupervisoryRoleForContainment("implementer")).toBe(false);
      expect(isSupervisoryRoleForContainment("validator")).toBe(false);
      expect(isSupervisoryRoleForContainment("worker")).toBe(false);
    });

    it("detects supervisory violations from toolName and command strings", () => {
      const editViol = detectSupervisoryViolation({
        role: "coordinator",
        toolName: "write_to_file",
      });
      expect(editViol).not.toBeNull();
      expect(editViol?.violationType).toBe("DIRECT_CODE_EDIT");

      const testViol = detectSupervisoryViolation({
        role: "orchestrator",
        command: "bun test tests/mind",
      });
      expect(testViol).not.toBeNull();
      expect(testViol?.violationType).toBe("DIRECT_TEST_RUN");

      const gitViol = detectSupervisoryViolation({
        role: "mind",
        command: "git commit -m 'bypass'",
      });
      expect(gitViol).not.toBeNull();
      expect(gitViol?.violationType).toBe("DIRECT_MUTATION_COMMAND");
    });

    it("assertSupervisoryContainment throws HarnessError on boundary breach", () => {
      expect(() => {
        assertSupervisoryContainment({
          agentId: "orch-violator",
          role: "orchestrator",
          toolName: "write_to_file",
          targetFile: "src/index.ts",
        });
      }).toThrow(HarnessError);
    });
  });
});
