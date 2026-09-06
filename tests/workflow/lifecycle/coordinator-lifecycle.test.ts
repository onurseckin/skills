import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  CoordinatorLifecycleGuard,
  assertCoordinatorCanIdle,
  assertCoordinatorCanRelease,
  assertReactiveMailboxPolling,
  getActiveChildTasks,
  hasActiveChildTasks,
  isTaskInProgress,
  isTaskTerminal,
  isWaveTerminal,
  validateCoordinatorLifecycleTransition,
  type TaskLifecycleInfo,
} from "../../../olt/scripts/src/workflow/lifecycle/index.ts";

describe("Coordinator Active Lifecycle Guard (DEFECT-COORDINATOR-PREMATURE-IDLE)", () => {
  const coordinatorId = "coord-alpha";

  describe("Task state inspection helpers", () => {
    test("correctly identifies terminal task states", () => {
      expect(isTaskTerminal({ id: "t1", status: "done" })).toBe(true);
      expect(isTaskTerminal({ id: "t2", status: "cancelled" })).toBe(true);
      expect(isTaskTerminal({ id: "t3", status: "escalated" })).toBe(true);
      expect(isTaskTerminal({ id: "t4", status: "leased" })).toBe(false);
      expect(isTaskTerminal({ id: "t5", status: "validating" })).toBe(false);
    });

    test("correctly identifies in-progress child tasks with active lease or validation", () => {
      const leasedTask: TaskLifecycleInfo = {
        id: "t1",
        status: "leased",
        lease: { agent_id: "worker-1", expires_at: "2026-09-06T10:00:00Z" },
      };
      const validatingTask: TaskLifecycleInfo = {
        id: "t2",
        status: "validating",
        validations: [{ validator_id: "val-1", domain: "code" }],
      };
      const doneTask: TaskLifecycleInfo = { id: "t3", status: "done" };

      expect(isTaskInProgress(leasedTask)).toBe(true);
      expect(isTaskInProgress(validatingTask)).toBe(true);
      expect(isTaskInProgress(doneTask)).toBe(false);
      expect(hasActiveChildTasks([leasedTask, doneTask], coordinatorId)).toBe(true);
      expect(getActiveChildTasks([leasedTask, doneTask], coordinatorId)).toHaveLength(1);
    });
  });

  describe("Forbidding coordinator idle during active child tasks", () => {
    test("throws ROLE_BOUNDARY_DEVIATION if coordinator idles while child task has active lease", () => {
      const tasks: TaskLifecycleInfo[] = [
        {
          id: "task-child-1",
          status: "leased",
          lease: { agent_id: "impl-1", expires_at: "2026-09-06T10:00:00Z" },
        },
      ];

      expect(() => assertCoordinatorCanIdle({ coordinatorId, tasks })).toThrow(HarnessError);
      try {
        assertCoordinatorCanIdle({ coordinatorId, tasks });
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("ROLE_BOUNDARY_DEVIATION");
        expect(harnessErr.message).toContain("cannot transition to idle");
      }
    });

    test("throws ROLE_BOUNDARY_DEVIATION if coordinator idles while child task is validating", () => {
      const tasks: TaskLifecycleInfo[] = [
        {
          id: "task-child-2",
          status: "validating",
          validations: [{ validator_id: "val-1", verdict: undefined }],
        },
      ];

      try {
        assertCoordinatorCanIdle({ coordinatorId, tasks });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("ROLE_BOUNDARY_DEVIATION");
      }
    });

    test("allows idle when all child tasks are terminal", () => {
      const tasks: TaskLifecycleInfo[] = [
        { id: "task-1", status: "done" },
        { id: "task-2", status: "cancelled" },
      ];
      expect(() => assertCoordinatorCanIdle({ coordinatorId, tasks })).not.toThrow();
    });
  });

  describe("Forbidding release during active child task leases and validations", () => {
    test("throws INVALID_STATE if coordinator calls agent:release while child task is leased", () => {
      const tasks: TaskLifecycleInfo[] = [
        {
          id: "task-active",
          status: "leased",
          lease: { agent_id: "impl-2", expires_at: "2026-09-06T12:00:00Z" },
        },
      ];

      try {
        assertCoordinatorCanRelease({ coordinatorId, tasks });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain(
          "cannot release grant while child tasks have active leases",
        );
      }
    });

    test("throws INVALID_STATE if coordinator calls agent:release while child task is validating", () => {
      const tasks: TaskLifecycleInfo[] = [
        {
          id: "task-val",
          status: "validating",
          validations: [{ validator_id: "val-2" }],
        },
      ];

      try {
        assertCoordinatorCanRelease({ coordinatorId, tasks });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("INVALID_STATE");
      }
    });

    test("throws INVALID_STATE if coordinator calls release when tasks are ready or non-terminal", () => {
      const tasks: TaskLifecycleInfo[] = [
        { id: "task-ready", status: "ready" },
        { id: "task-done", status: "done" },
      ];

      try {
        assertCoordinatorCanRelease({ coordinatorId, tasks });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain("before all wave tasks reach terminal state");
      }
    });

    test("permits release only after all wave tasks reach terminal state", () => {
      const tasks: TaskLifecycleInfo[] = [
        { id: "task-1", status: "done" },
        { id: "task-2", status: "done" },
        { id: "task-3", status: "cancelled" },
      ];

      expect(isWaveTerminal(tasks)).toBe(true);
      expect(() => assertCoordinatorCanRelease({ coordinatorId, tasks })).not.toThrow();
    });

    test("accepts record dictionary of tasks", () => {
      const tasksRecord: Record<string, TaskLifecycleInfo> = {
        "task-1": { id: "task-1", status: "done" },
        "task-2": { id: "task-2", status: "done" },
      };
      expect(() =>
        assertCoordinatorCanRelease({ coordinatorId, tasks: tasksRecord }),
      ).not.toThrow();
    });
  });

  describe("Mandating reactive mailbox polling (msg:poll)", () => {
    test("throws ROLE_BOUNDARY_DEVIATION when attempting non-polling actions while wave is active", () => {
      const tasks: TaskLifecycleInfo[] = [
        { id: "task-active", status: "running", lease: { agent_id: "impl-1" } },
      ];

      try {
        assertReactiveMailboxPolling({ coordinatorId, tasks, action: "idle" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("ROLE_BOUNDARY_DEVIATION");
        expect(harnessErr.message).toContain("reactive mailbox polling (msg:poll)");
      }
    });

    test("throws ROLE_BOUNDARY_DEVIATION when hasPolledMailbox is false during active wave", () => {
      const tasks: TaskLifecycleInfo[] = [
        { id: "task-active", status: "leased", lease: { agent_id: "impl-1" } },
      ];
      expect(() =>
        assertReactiveMailboxPolling({ coordinatorId, tasks, hasPolledMailbox: false }),
      ).toThrow(HarnessError);
    });

    test("permits msg:poll and permitted supervision actions while wave is active", () => {
      const tasks: TaskLifecycleInfo[] = [
        { id: "task-active", status: "running", lease: { agent_id: "impl-1" } },
      ];
      expect(() =>
        assertReactiveMailboxPolling({ coordinatorId, tasks, action: "msg:poll" }),
      ).not.toThrow();
      expect(() =>
        assertReactiveMailboxPolling({ coordinatorId, tasks, action: "msg:recv" }),
      ).not.toThrow();
    });

    test("does not mandate mailbox polling once wave reaches terminal state", () => {
      const tasks: TaskLifecycleInfo[] = [{ id: "task-1", status: "done" }];
      expect(() =>
        assertReactiveMailboxPolling({ coordinatorId, tasks, action: "idle" }),
      ).not.toThrow();
    });
  });

  describe("CoordinatorLifecycleGuard facade class", () => {
    test("guard methods operate consistently across lifecycle transitions", () => {
      const guard = new CoordinatorLifecycleGuard(coordinatorId);
      const activeTasks: TaskLifecycleInfo[] = [
        { id: "t-1", status: "leased", lease: { agent_id: "worker-1" } },
      ];
      const terminalTasks: TaskLifecycleInfo[] = [{ id: "t-1", status: "done" }];

      expect(guard.isWaveTerminal(activeTasks)).toBe(false);
      expect(guard.isWaveTerminal(terminalTasks)).toBe(true);

      expect(() => guard.assertCanIdle(activeTasks)).toThrow("ROLE_BOUNDARY_DEVIATION");
      expect(() => guard.assertCanRelease(activeTasks)).toThrow("INVALID_STATE");

      expect(() => guard.assertCanIdle(terminalTasks)).not.toThrow();
      expect(() => guard.assertCanRelease(terminalTasks)).not.toThrow();

      expect(() => guard.validateTransition("idle", activeTasks)).toThrow();
      expect(() => guard.validateTransition("release", activeTasks)).toThrow();
      expect(() => guard.validateTransition("msg:poll", activeTasks)).not.toThrow();
      expect(() => guard.validateTransition("release", terminalTasks)).not.toThrow();
    });
  });
});
