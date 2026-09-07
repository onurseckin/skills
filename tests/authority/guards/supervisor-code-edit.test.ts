import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
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
      const nonSupervisory = ["implementer", "worker", "validator", "tester", "sub-implementer"];
      for (const role of nonSupervisory) {
        expect(isSupervisorRole(role)).toBe(false);
      }
    });

    test("handles case-insensitivity and surrounding whitespace in supervisor role checks", () => {
      expect(isSupervisorRole(" Coordinator ")).toBe(true);
      expect(isSupervisorRole("MIND-SUPERVISOR")).toBe(true);
      expect(isSupervisorRole(" Orch ")).toBe(true);
      expect(isSupervisorRole(" tier_1 ")).toBe(true);
      expect(isSupervisorRole("  FEATURE-COORDINATOR  ")).toBe(true);

      expect(() => {
        assertSupervisorPreToolGuard(" Coordinator ", "write_to_file", "ws-coord");
      }).toThrow(HarnessError);

      expect(() => {
        assertSupervisorPreToolGuard(" MIND ", "replace_file_content", "ws-mind");
      }).toThrow(HarnessError);
    });

    test("handles omitted or empty agentId with deterministic fallback", () => {
      expect(() => {
        assertSupervisorPreToolGuard("coordinator", "write_to_file", "");
      }).toThrow(HarnessError);
      expect(engine.getAgentState("coordinator-agent").strikeCount).toBe(1);

      expect(() => {
        assertSupervisorPreToolGuard("orchestrator", "replace_file_content", undefined);
      }).toThrow(HarnessError);
      expect(engine.getAgentState("orchestrator-agent").strikeCount).toBe(1);
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
        assertSupervisorPreToolGuard("sub-implementer", "write_to_file", "sub-implementer-1");
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
