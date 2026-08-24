import { describe, expect, test } from "bun:test";
import {
  BRANCH_STATUSES,
  BRANCH_SUB_TASK_STATUSES,
  TERMINAL_SUB_TASK_STATUSES,
  isBranchLease,
  isBranchOpen,
  isBranchRecord,
  isBranchStatus,
  isBranchSubTask,
  isBranchSubTaskStatus,
  isSubTaskTerminal,
  type BranchLease,
  type BranchRecord,
  type BranchRepositoryObservation,
  type BranchStatus,
  type BranchSubTask,
  type BranchSubTaskStatus,
} from "../../../olt/scripts/src/core/contracts/branch.ts";

function subTask(overrides: Partial<BranchSubTask> = {}): BranchSubTask {
  return {
    id: "ST-1",
    label: "Sub task",
    write_scope: ["src/owned"],
    status: "open",
    ...overrides,
  };
}

function observation(
  overrides: Partial<BranchRepositoryObservation> = {},
): BranchRepositoryObservation {
  return {
    observed_at: "2026-08-19T00:00:00.000Z",
    git_available: true,
    head: "abc123",
    entries: [{ path: "src/a.ts", status_code: "M", sha256: "0".repeat(64) }],
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

describe("isBranchRecord — repository observations", () => {
  test("accepts a branch whose opened_observation and collected_observation are well-formed", () => {
    expect(
      isBranchRecord(
        branch({
          opened_observation: observation(),
          collected_observation: observation({ head: null, entries: [] }),
        }),
      ),
    ).toBeTrue();
  });

  test("refuses an observation missing observed_at or a non-boolean git_available", () => {
    expect(
      isBranchRecord(branch({ opened_observation: observation({ observed_at: "" }) })),
    ).toBeFalse();
    expect(
      isBranchRecord(
        branch({
          opened_observation: {
            ...observation(),
            git_available: "yes",
          } as unknown as BranchRepositoryObservation,
        }),
      ),
    ).toBeFalse();
  });

  test("refuses a head that is neither null nor a non-blank string", () => {
    expect(isBranchRecord(branch({ opened_observation: observation({ head: "" }) }))).toBeFalse();
  });

  test("refuses an entries list containing a malformed entry", () => {
    expect(
      isBranchRecord(
        branch({
          opened_observation: observation({
            entries: [{ path: "", status_code: "M", sha256: null }],
          }),
        }),
      ),
    ).toBeFalse();
    expect(
      isBranchRecord(
        branch({
          opened_observation: observation({
            entries: [{ path: "src/a.ts", status_code: 7 as unknown as string, sha256: null }],
          }),
        }),
      ),
    ).toBeFalse();
    expect(
      isBranchRecord(
        branch({
          opened_observation: observation({
            entries: [{ path: "src/a.ts", status_code: "M", sha256: "" }],
          }),
        }),
      ),
    ).toBeFalse();
  });

  test("refuses an entries value that is not an array at all", () => {
    expect(
      isBranchRecord(
        branch({
          opened_observation: {
            ...observation(),
            entries: "not-an-array" as unknown as BranchRepositoryObservation["entries"],
          },
        }),
      ),
    ).toBeFalse();
  });
});

describe("isBranchRecord — top-level field validation", () => {
  test("refuses a blank collected_at or abandoned_at", () => {
    expect(isBranchRecord(branch({ collected_at: "" }))).toBeFalse();
    expect(isBranchRecord(branch({ abandoned_at: "" }))).toBeFalse();
  });

  test("refuses a files_changed evidence envelope that is not a string array", () => {
    expect(
      isBranchRecord(
        branch({
          files_changed: { value: "src/a.ts", evidence_class: "harness_observed" } as never,
        }),
      ),
    ).toBeFalse();
  });

  test("accepts a well-formed files_changed evidence envelope", () => {
    expect(
      isBranchRecord(
        branch({ files_changed: { value: ["src/a.ts"], evidence_class: "harness_observed" } }),
      ),
    ).toBeTrue();
  });
});

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

  test("a branch's sub-task carrying a malformed lease fails isBranchRecord too", () => {
    expect(
      isBranchRecord(branch({ sub_tasks: [subTask({ lease: { agent_id: 7 } as never })] })),
    ).toBeFalse();
    expect(isBranchRecord(branch({ sub_tasks: [subTask({ lease: lease() })] }))).toBeTrue();
  });
});

describe("isSubTaskTerminal", () => {
  test("submitted and abandoned are terminal; open and claimed are not", () => {
    expect(isSubTaskTerminal(subTask({ status: "submitted" }))).toBeTrue();
    expect(isSubTaskTerminal(subTask({ status: "abandoned" }))).toBeTrue();
    expect(isSubTaskTerminal(subTask({ status: "open" }))).toBeFalse();
    expect(isSubTaskTerminal(subTask({ status: "claimed" }))).toBeFalse();
  });
});

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

describe("isBranchOpen", () => {
  test("returns true for open and collecting, false for collected and abandoned", () => {
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

describe("isBranchRecord comprehensive edge cases", () => {
  test("refuses non-object or invalid mandatory fields", () => {
    expect(isBranchRecord(null)).toBeFalse();
    expect(isBranchRecord(branch({ id: "" }))).toBeFalse();
    expect(isBranchRecord(branch({ parent_task_id: "" }))).toBeFalse();
    expect(isBranchRecord(branch({ parent_agent_id: "" }))).toBeFalse();
    expect(isBranchRecord(branch({ reason: "" }))).toBeFalse();
    expect(isBranchRecord(branch({ depth: 0 }))).toBeFalse();
    expect(isBranchRecord(branch({ depth: -1 }))).toBeFalse();
    expect(isBranchRecord(branch({ depth: 1.5 }))).toBeFalse();
    expect(isBranchRecord(branch({ status: "unknown" as unknown as BranchStatus }))).toBeFalse();
    expect(isBranchRecord(branch({ opened_at: "" }))).toBeFalse();
    expect(isBranchRecord(branch({ outcome_summary: "" }))).toBeFalse();
    expect(isBranchRecord(branch({ outcome_summary: "Valid summary" }))).toBeTrue();
    expect(
      isBranchRecord(branch({ sub_tasks: "not_array" as unknown as BranchSubTask[] })),
    ).toBeFalse();
    expect(isBranchRecord(branch({ sub_tasks: [subTask({ id: "" })] }))).toBeFalse();
  });
});
