import { describe, expect, test } from "bun:test";
import {
  isBranchRecord,
  type BranchLease,
  type BranchRecord,
  type BranchRepositoryObservation,
  type BranchStatus,
  type BranchSubTask,
} from "../../../olt/scripts/src/core/contracts/index.ts";

export const branchIsolationSuiteName = "isBranchRecord repository observations & comprehensive structural invariants";

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

describe(branchIsolationSuiteName, () => {
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

    test("a branch sub-task carrying a malformed lease fails isBranchRecord", () => {
      expect(
        isBranchRecord(branch({ sub_tasks: [subTask({ lease: { agent_id: 7 } as never })] })),
      ).toBeFalse();
      expect(isBranchRecord(branch({ sub_tasks: [subTask({ lease: lease() })] }))).toBeTrue();
    });
  });

  describe("isBranchRecord — comprehensive edge cases", () => {
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
});
