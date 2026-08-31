import { describe, expect, test } from "bun:test";
import type { BranchRecord } from "../../olt/scripts/src/core/contracts/index.ts";
import {
  formatBranchCollectBrief,
  formatBranchStatusBrief,
} from "../../olt/scripts/src/cli/formatters/branch-formatter.ts";

function branch(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    id: "B-1",
    parent_task_id: "task-1",
    parent_agent_id: "worker-1",
    reason: "the parser blocks the API change",
    depth: 1,
    status: "collected",
    opened_at: "2026-08-19T10:00:00.000Z",
    sub_tasks: [
      {
        id: "S-1",
        label: "Fix the parser",
        write_scope: ["src/one/parser"],
        status: "submitted",
        agent_id: "sub-1",
      },
    ],
    ...overrides,
  };
}

describe("branch briefs", () => {
  test("renders an unmeasured repository as unknown, never as an empty change set", () => {
    const brief = formatBranchCollectBrief(branch(), "running");
    expect(brief).toContain("**Files Changed**: unknown (no repository observation)");
  });

  test("distinguishes a measured empty change set from an unmeasured one", () => {
    const empty = formatBranchCollectBrief(
      branch({ files_changed: { value: [], evidence_class: "harness_observed" } }),
      "running",
    );
    expect(empty).toContain("no file changed (harness_observed)");
    const measured = formatBranchCollectBrief(
      branch({
        files_changed: { value: ["src/one/parser/a.ts"], evidence_class: "harness_observed" },
      }),
      "running",
    );
    expect(measured).toContain("1 files (harness_observed)");
    expect(measured).toContain("`src/one/parser/a.ts`");
  });

  test("shows why every open branch exists", () => {
    const brief = formatBranchStatusBrief([branch({ status: "open" })], "run-1");
    expect(brief).toContain("the parser blocks the API change");
    expect(brief).toContain("| `B-1` | `task-1` | 1 | open | 1/1 |");
  });

  test("says so plainly when nothing has branched", () => {
    expect(formatBranchStatusBrief([], "run-1")).toContain("none opened in this run");
  });
});
