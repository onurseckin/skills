import { describe, expect, test } from "bun:test";
import {
  formatCriticRejectBrief,
  formatRunCompleteBrief,
  formatRunStatusBrief,
} from "../../../orchestrating-long-tasks/scripts/src/cli/formatters/run-formatter.ts";

describe("formatRunStatusBrief", () => {
  test("renders a row per task and the optional occupancy and catalogue summaries", () => {
    const brief = formatRunStatusBrief(
      "run-1",
      "Executing",
      [
        {
          id: "task-1",
          label: "Fix parser",
          writeScope: ["src/a", "src/b"],
          status: "leased",
          agentOrLock: "worker-1",
        },
      ],
      "1/3 tasks done",
      "12 blobs, 4KB",
      "2/4 lanes active",
    );

    expect(brief).toContain("| `task-1` | Fix parser | `src/a`, `src/b` | leased | worker-1 |");
    expect(brief).toContain("**Progress**: 1/3 tasks done");
    expect(brief).toContain("**Occupancy**: 2/4 lanes active");
    expect(brief).toContain("**Capsule**: 12 blobs, 4KB");
  });

  test("omits occupancy and catalogue lines entirely when neither is given", () => {
    const brief = formatRunStatusBrief("run-1", "Executing", [], "0/0");
    expect(brief).not.toContain("Occupancy");
    expect(brief).not.toContain("Capsule");
  });
});

describe("formatCriticRejectBrief", () => {
  test("names every finding id and directs the coordinator to replan", () => {
    const brief = formatCriticRejectBrief({
      critic: "critic-1",
      token: "tok_c",
      runId: "run-1",
      summary: "coverage gap in the auth module",
      findingsCount: 2,
      findingIds: ["F-1", "F-2"],
    });

    expect(brief).toContain("CHANGES REQUESTED (Findings Recorded)");
    expect(brief).toContain("**Findings Count**: 2 (`F-1`, `F-2`)");
    expect(brief).toContain("plan:replan");
    expect(brief).toContain("Read-Only Auditor Invariant enforced");
  });

  test("no finding ids reads None rather than an empty string", () => {
    const brief = formatCriticRejectBrief({
      critic: "critic-1",
      token: "tok_c",
      runId: "run-1",
      summary: "unclear",
      findingsCount: 0,
      findingIds: [],
    });
    expect(brief).toContain("**Findings Count**: 0 (None)");
  });
});

describe("formatRunCompleteBrief worktree consolidation", () => {
  function base() {
    return {
      runId: "run-1",
      capsulePath: ".capsules/run-1",
      tasksCount: 3,
      validationsCount: 3,
      gatesPassed: 3,
      totalGates: 3,
    };
  }

  test("a conflicted consolidation stops and leaves worktrees intact for inspection", () => {
    const brief = formatRunCompleteBrief({
      ...base(),
      worktreeConsolidation: {
        branch: "feature/run-1",
        commitCount: 4,
        rebased: false,
        diffstat: "3 files changed",
        conflicted: true,
      },
    });

    expect(brief).toContain("consolidation STOPPED on a conflict");
    expect(brief).toContain("nothing force-resolved");
    expect(brief).not.toContain("sub-phase commits");
  });

  test("a clean, rebased consolidation reports commit count and diffstat", () => {
    const brief = formatRunCompleteBrief({
      ...base(),
      worktreeConsolidation: {
        branch: "feature/run-1",
        commitCount: 4,
        rebased: true,
        diffstat: "3 files changed, 20 insertions(+)",
        conflicted: false,
      },
    });

    expect(brief).toContain(
      "`feature/run-1` (4 sub-phase commits, 3 files changed, 20 insertions(+), rebased onto the base branch)",
    );
    expect(brief).toContain("local only, never pushed");
  });

  test("a clean, unrebased consolidation omits the rebase clause", () => {
    const brief = formatRunCompleteBrief({
      ...base(),
      worktreeConsolidation: {
        branch: "feature/run-1",
        commitCount: 1,
        rebased: false,
        diffstat: "1 file changed",
        conflicted: false,
      },
    });
    expect(brief).toContain("(1 sub-phase commits, 1 file changed)");
    expect(brief).not.toContain("rebased onto the base branch");
  });

  test("no worktree consolidation at all omits the section entirely", () => {
    const brief = formatRunCompleteBrief(base());
    expect(brief).not.toContain("Worktree Branch");
  });
});
