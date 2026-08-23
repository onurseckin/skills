import { describe, expect, test } from "bun:test";
import {
  isBranchLease,
  isBranchRecord,
  isSubTaskTerminal,
  type BranchLease,
  type BranchRecord,
  type BranchRepositoryObservation,
  type BranchSubTask,
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
