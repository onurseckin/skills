import { describe, expect, it } from "bun:test";
import {
  checkCoordinator,
  checkOrchestrator,
  checkTestRunning,
} from "../../../olt/scripts/src/mind/auditing/roles/rules/supervisory-checks.ts";
import type { RoleBoundaryAction } from "../../../olt/scripts/src/mind/auditing/roles/rules/matrix.ts";

describe("Mind Supervisory Boundary Checks Suite", () => {
  const ts = "2026-09-01T12:00:00.000Z";

  describe("checkCoordinator", () => {
    it("returns null for non-coordinator roles and tiers", () => {
      expect(
        checkCoordinator({ agentId: "a1", role: "implementer", actionType: "file_write" }, 3, ts),
      ).toBeNull();
    });

    it("flags coordinator task lease, file_write, and tool edit violations", () => {
      const vLease = checkCoordinator(
        { agentId: "c1", role: "coordinator", actionType: "task_lease", taskId: "t1" },
        2,
        ts,
      );
      expect(vLease?.violationType).toBe("coordinator_task_lease");
      expect(vLease?.severity).toBe("CRITICAL");

      const vWrite = checkCoordinator(
        { agentId: "c2", role: "coord-core", actionType: "file_write", targetFile: "src/index.ts" },
        2,
        ts,
      );
      expect(vWrite?.violationType).toBe("coordinator_code_writing");

      const vTool = checkCoordinator(
        {
          agentId: "c3",
          role: "coordinator",
          actionType: "tool_use",
          toolName: "replace_file_content",
        },
        2,
        ts,
      );
      expect(vTool?.violationType).toBe("coordinator_code_writing");

      const vTool2 = checkCoordinator(
        { agentId: "c3b", role: "coordinator", actionType: "tool_use", toolName: "custom_write" },
        2,
        ts,
      );
      expect(vTool2?.violationType).toBe("coordinator_code_writing");

      expect(
        checkCoordinator(
          { agentId: "c4", role: "coordinator", actionType: "tool_use", toolName: "read_file" },
          2,
          ts,
        ),
      ).toBeNull();
      expect(
        checkCoordinator({ agentId: "c5", role: "coordinator", actionType: "tool_use" }, 2, ts),
      ).toBeNull();
    });
  });

  describe("checkOrchestrator", () => {
    it("returns null for non-orchestrator roles and tiers", () => {
      expect(
        checkOrchestrator(
          { agentId: "a1", role: "implementer", actionType: "graph_mutation" },
          3,
          ts,
        ),
      ).toBeNull();
    });

    it("flags graph mutations, commands, task claims, and direct execution", () => {
      const vMut = checkOrchestrator(
        { agentId: "o1", role: "orchestrator", actionType: "graph_mutation" },
        1,
        ts,
      );
      expect(vMut?.violationType).toBe("orchestrator_graph_mutation");

      const vCmd = checkOrchestrator(
        { agentId: "o2", role: "orch-primary", actionType: "command_exec", argv: ["plan:init"] },
        1,
        ts,
      );
      expect(vCmd?.violationType).toBe("orchestrator_graph_mutation");

      const vClaim = checkOrchestrator(
        {
          agentId: "o3",
          role: "orchestrator",
          actionType: "command_exec",
          argv: ["task:claim", "--id=1"],
        },
        1,
        ts,
      );
      expect(vClaim?.violationType).toBe("orchestrator_task_implementation");

      const vExec = checkOrchestrator(
        { agentId: "o4", role: "orchestrator", actionType: "task_execution" },
        1,
        ts,
      );
      expect(vExec?.violationType).toBe("orchestrator_task_implementation");

      expect(
        checkOrchestrator(
          {
            agentId: "o5",
            role: "orchestrator",
            actionType: "command_exec",
            argv: ["git", "status"],
          },
          1,
          ts,
        ),
      ).toBeNull();
      expect(
        checkOrchestrator(
          { agentId: "o6", role: "orchestrator", actionType: "command_exec" },
          1,
          ts,
        ),
      ).toBeNull();
    });
  });

  describe("checkTestRunning", () => {
    it("returns null when action is not a test run", () => {
      expect(
        checkTestRunning(
          { agentId: "a1", role: "mind", actionType: "tool_use", toolName: "read_file" },
          0,
          ts,
        ),
      ).toBeNull();
    });

    it("flags test execution by supervisory tiers or roles", () => {
      expect(
        checkTestRunning(
          { agentId: "m1", role: "mind", actionType: "test_run", argv: ["bun", "test"] },
          0,
          ts,
        )?.violationType,
      ).toBe("supervisory_test_execution");
      expect(
        checkTestRunning(
          {
            agentId: "o1",
            role: "orchestrator",
            actionType: "test_execution",
            argv: ["bun", "test"],
          },
          1,
          ts,
        )?.violationType,
      ).toBe("supervisory_test_execution");
      expect(
        checkTestRunning(
          {
            agentId: "c1",
            role: "coordinator",
            actionType: "tool_use",
            toolName: "run_command",
            argv: ["bun", "test"],
          },
          2,
          ts,
        )?.violationType,
      ).toBe("supervisory_test_execution");
      expect(
        checkTestRunning({ agentId: "c3", role: "coord-wave", actionType: "test_run" }, 3, ts)
          ?.violationType,
      ).toBe("supervisory_test_execution");
    });

    it("flags implementer full test suite and unassigned test runs, allowing assigned files", () => {
      const vFull = checkTestRunning(
        { agentId: "i1", role: "implementer", actionType: "test_run", argv: ["bun", "test"] },
        3,
        ts,
      );
      expect(vFull?.violationType).toBe("unassigned_test_running");

      const vUnassigned = checkTestRunning(
        {
          agentId: "i2",
          role: "implementer",
          actionType: "test_run",
          argv: ["bun", "test", "other.test.ts"],
          assignedTestFiles: ["f.test.ts"],
        },
        3,
        ts,
      );
      expect(vUnassigned?.violationType).toBe("unassigned_test_running");

      expect(
        checkTestRunning(
          {
            agentId: "i3",
            role: "implementer",
            actionType: "test_run",
            argv: ["bun", "test", "f.test.ts"],
            assignedTestFiles: ["f.test.ts"],
          },
          3,
          ts,
        ),
      ).toBeNull();

      expect(
        checkTestRunning(
          {
            agentId: "i4",
            role: "implementer",
            actionType: "test_run",
            argv: ["bun", "run", "s.ts"],
            assignedTestFiles: ["f.test.ts"],
          },
          3,
          ts,
        ),
      ).toBeNull();

      expect(
        checkTestRunning(
          {
            agentId: "v1",
            role: "validator",
            actionType: "test_run",
            argv: ["bun", "test", "t.test.ts"],
          },
          3,
          ts,
        ),
      ).toBeNull();
      expect(
        checkTestRunning(
          {
            agentId: "w1",
            role: "worker",
            actionType: "test_run",
            argv: ["bun", "test", "t.test.ts"],
            assignedTestFiles: [],
          },
          3,
          ts,
        ),
      ).toBeNull();
    });
  });
});
