import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  assertCoordinatorPreToolGuard,
  assertSupervisorPreToolGuard,
  resetDefaultContainmentEngine,
  setDefaultContainmentEngine,
} from "../../../olt/scripts/src/authority/guards/index.ts";
import { MechanicalContainmentEngine } from "../../../olt/scripts/src/mind/containment/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Supervisor Pre-Tool Guard Containment & Mechanical Rejection", () => {
  let engine: MechanicalContainmentEngine;

  beforeEach(() => {
    resetDefaultContainmentEngine();
    engine = new MechanicalContainmentEngine();
    setDefaultContainmentEngine(engine);
  });

  afterEach(() => {
    resetDefaultContainmentEngine();
  });

  describe("Mechanical Rejection with ROLE_BOUNDARY_DEVIATION", () => {
    test("rejects write_to_file for coordinator, mind, and orchestrator", () => {
      const roles = ["coordinator", "mind", "orchestrator"];
      for (const role of roles) {
        try {
          assertSupervisorPreToolGuard(role, "write_to_file", `${role}-agent`);
          expect.unreachable(`should have thrown for ${role}`);
        } catch (error) {
          expect(error).toBeInstanceOf(HarnessError);
          const harnessErr = error as HarnessError;
          expect(harnessErr.code).toBe("ROLE_BOUNDARY_DEVIATION");
          expect(harnessErr.message).toContain("ROLE_BOUNDARY_DEVIATION");
          expect(harnessErr.message).toContain("invoke_subagent");
          expect(harnessErr.message).toContain("Tier 3 Implementer");
        }
      }
    });

    test("rejects replace_file_content for coordinator, mind, and orchestrator", () => {
      const roles = ["coordinator", "mind", "orchestrator"];
      for (const role of roles) {
        try {
          assertSupervisorPreToolGuard(role, "replace_file_content", `${role}-agent`);
          expect.unreachable(`should have thrown for ${role}`);
        } catch (error) {
          expect(error).toBeInstanceOf(HarnessError);
          const harnessErr = error as HarnessError;
          expect(harnessErr.code).toBe("ROLE_BOUNDARY_DEVIATION");
          expect(harnessErr.message).toContain("ROLE_BOUNDARY_DEVIATION");
          expect(harnessErr.message).toContain("invoke_subagent");
        }
      }
    });

    test("assertCoordinatorPreToolGuard rejects file edits for all supervisor roles", () => {
      expect(() => {
        assertCoordinatorPreToolGuard("coordinator", "write_to_file", "coord-1");
      }).toThrow(HarnessError);

      expect(() => {
        assertCoordinatorPreToolGuard("mind", "replace_file_content", "mind-1");
      }).toThrow(HarnessError);

      expect(() => {
        assertCoordinatorPreToolGuard("orchestrator", "write_to_file", "orch-1");
      }).toThrow(HarnessError);
    });

    test("rejects with ROLE_BOUNDARY_DEVIATION even when no engine is configured", () => {
      resetDefaultContainmentEngine();
      try {
        assertSupervisorPreToolGuard("coordinator", "write_to_file", "coord-no-engine");
        expect.unreachable("should have thrown without engine");
      } catch (error) {
        expect(error).toBeInstanceOf(HarnessError);
        const harnessErr = error as HarnessError;
        expect(harnessErr.code).toBe("ROLE_BOUNDARY_DEVIATION");
        expect(harnessErr.message).toContain("ROLE_BOUNDARY_DEVIATION");
        expect(harnessErr.message).toContain("invoke_subagent");
      }
    });
  });

  describe("Strike 1 Containment Triggering", () => {
    test("triggers Strike 1 containment forcing delegation to Tier 3 Implementers", () => {
      expect(engine.getAgentState("coord-strike-1").strikeCount).toBe(0);

      try {
        assertSupervisorPreToolGuard("coordinator", "write_to_file", "coord-strike-1");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HarnessError);
        const harnessErr = error as HarnessError;
        expect(harnessErr.code).toBe("ROLE_BOUNDARY_DEVIATION");
        expect(harnessErr.message).toContain("HALT_AND_DELEGATE");
        expect(harnessErr.message).toContain("invoke_subagent");
      }

      const stateAfter = engine.getAgentState("coord-strike-1");
      expect(stateAfter.strikeCount).toBe(1);
    });

    test("triggers Strike 1 containment for mind and orchestrator agents", () => {
      expect(engine.getAgentState("mind-agent").strikeCount).toBe(0);
      expect(() => {
        assertSupervisorPreToolGuard("mind", "replace_file_content", "mind-agent");
      }).toThrow(HarnessError);
      expect(engine.getAgentState("mind-agent").strikeCount).toBe(1);

      expect(engine.getAgentState("orch-agent").strikeCount).toBe(0);
      expect(() => {
        assertSupervisorPreToolGuard("orchestrator", "write_to_file", "orch-agent");
      }).toThrow(HarnessError);
      expect(engine.getAgentState("orch-agent").strikeCount).toBe(1);
    });

    test("escalates containment on repeated violations", () => {
      expect(() => {
        assertSupervisorPreToolGuard("coordinator", "write_to_file", "repeat-agent");
      }).toThrow(HarnessError);
      expect(engine.getAgentState("repeat-agent").strikeCount).toBe(1);

      expect(() => {
        assertSupervisorPreToolGuard("coordinator", "replace_file_content", "repeat-agent");
      }).toThrow(HarnessError);
      expect(engine.getAgentState("repeat-agent").strikeCount).toBe(2);

      expect(() => {
        assertSupervisorPreToolGuard("coordinator", "edit_file", "repeat-agent");
      }).toThrow(HarnessError);
      expect(engine.getAgentState("repeat-agent").strikeCount).toBe(3);
      expect(engine.getAgentState("repeat-agent").isTerminated).toBe(true);
    });

    test("progresses through full strike ladder to Strike 3 PERSONA_RESPAWN and strips capabilities", () => {
      const agentId = "ladder-agent";
      try {
        assertSupervisorPreToolGuard("coordinator", "write_to_file", agentId);
        expect.unreachable("should throw");
      } catch (e) {
        expect((e as HarnessError).message).toContain("STRIKE 1 - HALT_AND_DELEGATE");
      }
      let st = engine.getAgentState(agentId);
      expect(st.strikeCount).toBe(1);
      expect(st.isTerminated).toBe(false);

      try {
        assertSupervisorPreToolGuard("coordinator", "replace_file_content", agentId);
        expect.unreachable("should throw");
      } catch (e) {
        expect((e as HarnessError).message).toContain("STRIKE 2 - CAPABILITY_REVOCATION");
      }
      st = engine.getAgentState(agentId);
      expect(st.strikeCount).toBe(2);
      expect(st.isTerminated).toBe(false);

      try {
        assertSupervisorPreToolGuard("coordinator", "edit_file", agentId);
        expect.unreachable("should throw");
      } catch (e) {
        expect((e as HarnessError).message).toContain("STRIKE 3 - PERSONA_RESPAWN");
      }
      st = engine.getAgentState(agentId);
      expect(st.strikeCount).toBe(3);
      expect(st.isTerminated).toBe(true);
      expect(st.capabilitiesRevoked).toBe(true);
      expect(st.revokedTools.length).toBeGreaterThan(0);
    });
  });
});
