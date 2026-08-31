import { describe, expect, test } from "bun:test";
import {
  BRANCH_STATUSES,
  BRANCH_SUB_TASK_STATUSES,
  TERMINAL_SUB_TASK_STATUSES,
  isBranchLease,
  isBranchOpen,
  isBranchStatus,
  isBranchSubTask,
  isBranchSubTaskStatus,
  isSubTaskTerminal,
  type BranchLease,
  type BranchRecord,
  type BranchSubTask,
  type BranchSubTaskStatus,
} from "../../../olt/scripts/src/core/contracts/index.ts";

export const branchCoreSuiteName = "isBranchStatus, isBranchSubTask, isBranchLease & status predicates";

function subTask(overrides: Partial<BranchSubTask> = {}): BranchSubTask {
  return {
    id: "ST-1",
    label: "Sub task",
    write_scope: ["src/owned"],
    status: "open",
    ...overrides,
  };
}

function lease(overrides: Partial<BranchLease> = {}): BranchLease {
  return {
    agent_id: "agent-1",
    token_digest: "d".repeat(64),
    issued_at: "2026-08-19T00:00:00.000Z",
    expires_at: "2026-08-19T01:00:00.000Z",
    duration_seconds: 3600,
    ...overrides,
  };
}

function branch(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    id: "B-1",
    parent_task_id: "T-1",
    parent_agent_id: "agent-1",
    reason: "widening scope",
    depth: 1,
    sub_tasks: [subTask()],
    status: "open",
    opened_at: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

describe(branchCoreSuiteName, () => {
  describe("isBranchStatus and isBranchSubTaskStatus", () => {
    test("isBranchStatus validates known branch statuses and rejects non-strings and invalid values", () => {
      for (const status of BRANCH_STATUSES) {
        expect(isBranchStatus(status)).toBeTrue();
      }
      expect(isBranchStatus("invalid_status")).toBeFalse();
      expect(isBranchStatus(123)).toBeFalse();
      expect(isBranchStatus(null)).toBeFalse();
      expect(isBranchStatus(undefined)).toBeFalse();
      expect(isBranchStatus({})).toBeFalse();
    });

    test("isBranchSubTaskStatus validates known sub-task statuses and rejects invalid values", () => {
      for (const status of BRANCH_SUB_TASK_STATUSES) {
        expect(isBranchSubTaskStatus(status)).toBeTrue();
      }
      expect(isBranchSubTaskStatus("pending")).toBeFalse();
      expect(isBranchSubTaskStatus(null)).toBeFalse();
      expect(isBranchSubTaskStatus(42)).toBeFalse();
    });

    test("TERMINAL_SUB_TASK_STATUSES contains submitted and abandoned", () => {
      expect(TERMINAL_SUB_TASK_STATUSES).toEqual(["submitted", "abandoned"]);
    });
  });

  describe("isSubTaskTerminal and isBranchOpen", () => {
    test("submitted and abandoned are terminal; open and claimed are not", () => {
      expect(isSubTaskTerminal(subTask({ status: "submitted" }))).toBeTrue();
      expect(isSubTaskTerminal(subTask({ status: "abandoned" }))).toBeTrue();
      expect(isSubTaskTerminal(subTask({ status: "open" }))).toBeFalse();
      expect(isSubTaskTerminal(subTask({ status: "claimed" }))).toBeFalse();
    });

    test("isBranchOpen returns true for open and collecting, false for collected and abandoned", () => {
      expect(isBranchOpen(branch({ status: "open" }))).toBeTrue();
      expect(isBranchOpen(branch({ status: "collecting" }))).toBeTrue();
      expect(isBranchOpen(branch({ status: "collected" }))).toBeFalse();
      expect(isBranchOpen(branch({ status: "abandoned" }))).toBeFalse();
    });
  });

  describe("isBranchSubTask", () => {
    test("accepts well-formed sub task with required and optional fields", () => {
      const valid = subTask({
        gate: "G-1",
        agent_id: "agent-1",
        claimed_at: "2026-08-19T00:00:00.000Z",
        submitted_at: "2026-08-19T00:10:00.000Z",
        abandoned_at: undefined,
        summary: "Done",
        lease: lease(),
      });
      expect(isBranchSubTask(valid)).toBeTrue();
    });

    test("refuses non-object or missing id / label", () => {
      expect(isBranchSubTask(null)).toBeFalse();
      expect(isBranchSubTask(subTask({ id: "" }))).toBeFalse();
      expect(isBranchSubTask(subTask({ label: "" }))).toBeFalse();
      expect(isBranchSubTask(subTask({ id: 123 as unknown as string }))).toBeFalse();
    });

    test("refuses invalid write_scope", () => {
      expect(isBranchSubTask(subTask({ write_scope: [] }))).toBeFalse();
      expect(isBranchSubTask(subTask({ write_scope: "src/a" as unknown as string[] }))).toBeFalse();
      expect(isBranchSubTask(subTask({ write_scope: [123 as unknown as string] }))).toBeFalse();
    });

    test("refuses invalid status", () => {
      expect(
        isBranchSubTask(subTask({ status: "not_a_status" as unknown as BranchSubTaskStatus })),
      ).toBeFalse();
    });

    test("refuses malformed optional fields", () => {
      expect(isBranchSubTask(subTask({ gate: "" }))).toBeFalse();
      expect(isBranchSubTask(subTask({ agent_id: "" }))).toBeFalse();
      expect(isBranchSubTask(subTask({ claimed_at: "" }))).toBeFalse();
      expect(isBranchSubTask(subTask({ submitted_at: "" }))).toBeFalse();
      expect(isBranchSubTask(subTask({ abandoned_at: "" }))).toBeFalse();
      expect(isBranchSubTask(subTask({ summary: "" }))).toBeFalse();
      expect(
        isBranchSubTask(subTask({ lease: { agent_id: 123 } as unknown as BranchLease })),
      ).toBeFalse();
    });
  });

  describe("isBranchLease", () => {
    test("accepts a well-formed lease, with and without the optional suspended_at", () => {
      expect(isBranchLease(lease())).toBeTrue();
      expect(isBranchLease(lease({ suspended_at: "2026-08-19T00:30:00.000Z" }))).toBeTrue();
    });

    test("refuses a lease with any single required field wrong, or a blank suspended_at", () => {
      expect(isBranchLease(null)).toBeFalse();
      expect(isBranchLease(lease({ agent_id: 7 as never }))).toBeFalse();
      expect(isBranchLease(lease({ token_digest: 7 as never }))).toBeFalse();
      expect(isBranchLease(lease({ issued_at: 7 as never }))).toBeFalse();
      expect(isBranchLease(lease({ expires_at: 7 as never }))).toBeFalse();
      expect(isBranchLease(lease({ duration_seconds: 1.5 as never }))).toBeFalse();
      expect(isBranchLease(lease({ suspended_at: "" }))).toBeFalse();
    });
  });
});
