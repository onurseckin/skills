import { describe, expect, test } from "bun:test";
import { loadRun } from "../../../olt/scripts/src/store/index.ts";
import { readBranchLedger } from "../../../olt/scripts/src/workflow/branch/ledger.ts";
import { openBranchIssues } from "../../../olt/scripts/src/workflow/branch/completion-blockers.ts";
import { legacyPreLedgerCapsule } from "../../support/legacy-capsule-fixture.ts";

describe("branch ledger compatibility", () => {
  test("a capsule written before branching existed still loads and reads as empty", () => {
    const loaded = loadRun(legacyPreLedgerCapsule(import.meta.path));
    expect(loaded.state.branches).toBeUndefined();
    expect(readBranchLedger(loaded.state)).toEqual([]);
    expect(openBranchIssues(loaded.state)).toEqual([]);
    expect(Object.keys(loaded.state.tasks ?? {}).length).toBeGreaterThan(0);
  });

  test("treats a malformed ledger as an integrity failure, not something to repair", () => {
    expect(() => readBranchLedger({ branches: "B-1" })).toThrow("must be an array");
    expect(() => readBranchLedger({ branches: [{ id: "B-1" }] })).toThrow("is not a branch record");
    expect(() =>
      readBranchLedger({
        branches: [
          {
            id: "B-1",
            parent_task_id: "task-1",
            parent_agent_id: "worker-1",
            reason: "why",
            depth: 1,
            status: "open",
            opened_at: "2026-08-19T00:00:00.000Z",
            sub_tasks: [{ id: "S-1", label: "One", write_scope: ["src/one"], status: "pending" }],
          },
        ],
      }),
    ).toThrow("is not a branch record");
  });
});
