import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  assertCoordinatorPreToolGuard,
  assertSupervisorPreToolGuard,
  isCoordinatorFileEditForbidden,
  isCoordinatorRole,
  isMindRole,
  isOrchestratorRole,
  isSupervisorRole,
  resetDefaultContainmentEngine,
  setDefaultContainmentEngine,
} from "../../../olt/scripts/src/authority/guards/index.ts";
import { MechanicalContainmentEngine } from "../../../olt/scripts/src/mind/containment/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Supervisor Pre-Tool Guard (DEFECT-COORDINATOR-CODE-EDIT)", () => {
  let engine: MechanicalContainmentEngine;

  beforeEach(() => {
    resetDefaultContainmentEngine();
    engine = new MechanicalContainmentEngine();
    setDefaultContainmentEngine(engine);
  });

  afterEach(() => {
    resetDefaultContainmentEngine();
  });

  describe("Role Identification", () => {
    test("identifies supervisory roles correctly across tiers", () => {
      const supervisoryRoles = [
        "coordinator",
        "feature-coordinator",
        "domain-coordinator",
        "coordinator-1",
        "mind",
        "mind-supervisor",
        "mind-auditor",
        "mind-1",
        "orchestrator",
        "domain-orchestrator",
        "orch",
        "orchestrator-alpha",
        "tier-0",
        "tier-1",
        "tier-2",
      ];
      for (const role of supervisoryRoles) {
        expect(isSupervisorRole(role)).toBe(true);
      }
    });

    test("distinguishes specific supervisory roles", () => {
      expect(isCoordinatorRole("coordinator")).toBe(true);
      expect(isCoordinatorRole("feature-coordinator")).toBe(true);
      expect(isCoordinatorRole("mind")).toBe(false);
      expect(isCoordinatorRole("orchestrator")).toBe(false);

      expect(isMindRole("mind")).toBe(true);
      expect(isMindRole("mind-supervisor")).toBe(true);
      expect(isMindRole("coordinator")).toBe(false);

      expect(isOrchestratorRole("orchestrator")).toBe(true);
      expect(isOrchestratorRole("orch")).toBe(true);
      expect(isOrchestratorRole("coordinator")).toBe(false);
    });

    test("identifies non-supervisory roles correctly", () => {
      const nonSupervisory = ["implementer", "worker", "validator", "tester", "repairer"];
      for (const role of nonSupervisory) {
        expect(isSupervisorRole(role)).toBe(false);
      }
    });
  });

  describe("Forbidden File Edit Detection", () => {
    test("detects forbidden mutation tools and categories", () => {
      const forbidden = [
        "write_to_file",
        "replace_file_content",
        "edit_file",
        "notebook_edit",
        "generate_image",
        "write",
        "edit",
        "mutation",
        "file-write",
        "code-edit",
        "apply_patch",
      ];
      for (const tool of forbidden) {
        expect(isCoordinatorFileEditForbidden(tool)).toBe(true);
      }
    });

    test("allows read, navigation, and orchestration tools", () => {
      const allowed = [
        "view_file",
        "list_dir",
        "grep_search",
        "find_by_name",
        "invoke_subagent",
        "send_message",
        "schedule",
        "manage_task",
      ];
      for (const tool of allowed) {
        expect(isCoordinatorFileEditForbidden(tool)).toBe(false);
      }
    });
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
  });

  describe("Non-Supervisory Roles Permitted", () => {
    test("permits write_to_file and replace_file_content for implementer and worker", () => {
      expect(() => {
        assertSupervisorPreToolGuard("implementer", "write_to_file", "impl-1");
      }).not.toThrow();

      expect(() => {
        assertSupervisorPreToolGuard("implementer", "replace_file_content", "impl-1");
      }).not.toThrow();

      expect(() => {
        assertSupervisorPreToolGuard("worker", "write_to_file", "worker-1");
      }).not.toThrow();

      expect(() => {
        assertSupervisorPreToolGuard("worker", "replace_file_content", "worker-1");
      }).not.toThrow();

      expect(() => {
        assertSupervisorPreToolGuard("repairer", "write_to_file", "repairer-1");
      }).not.toThrow();

      expect(engine.getAgentState("impl-1").strikeCount).toBe(0);
      expect(engine.getAgentState("worker-1").strikeCount).toBe(0);
    });

    test("permits allowed tools for supervisory roles", () => {
      expect(() => {
        assertSupervisorPreToolGuard("coordinator", "view_file", "coord-allowed");
      }).not.toThrow();

      expect(() => {
        assertSupervisorPreToolGuard("coordinator", "invoke_subagent", "coord-allowed");
      }).not.toThrow();

      expect(() => {
        assertSupervisorPreToolGuard("mind", "send_message", "mind-allowed");
      }).not.toThrow();

      expect(() => {
        assertSupervisorPreToolGuard("orchestrator", "schedule", "orch-allowed");
      }).not.toThrow();
    });
  });
});
