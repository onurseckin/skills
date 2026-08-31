import { describe, expect, test } from "bun:test";
import {
  formatTaskAssignRepairerBrief,
  formatTaskClaimBrief,
  formatTaskProbeBrief,
  formatTaskReviewPassBrief,
  formatValidationStartBrief,
} from "../../olt/scripts/src/cli/formatters/task-formatter.ts";

describe("formatTaskClaimBrief", () => {
  test("names the isolated worktree when the task was assigned one", () => {
    const brief = formatTaskClaimBrief({
      taskId: "task-1",
      agent: "worker-1",
      token: "tok_1",
      durationMinutes: 30,
      writeScope: ["src/a"],
      worktreePath: ".worktrees/task-1",
    });

    expect(brief).toContain("**Isolated Worktree**: `.worktrees/task-1`");
    expect(brief).toContain("not in the shared repo checkout");
  });

  test("omits the worktree line entirely when none was assigned", () => {
    const brief = formatTaskClaimBrief({
      taskId: "task-1",
      agent: "worker-1",
      token: "tok_1",
      durationMinutes: 30,
      writeScope: ["src/a"],
    });
    expect(brief).not.toContain("Isolated Worktree");
  });
});

describe("formatValidationStartBrief", () => {
  test("demands a minimum probe count before sign-off when one is configured", () => {
    const brief = formatValidationStartBrief({
      taskId: "task-1",
      validator: "val-1",
      token: "tok_v",
      gates: ["bun test"],
      minProbes: 2,
    });

    expect(brief).toContain("record 2 adversarial probe(s)");
    expect(brief).toContain("a pass is refused without them");
  });

  test("a zero probe minimum is treated the same as none configured", () => {
    const brief = formatValidationStartBrief({
      taskId: "task-1",
      validator: "val-1",
      token: "tok_v",
      gates: [],
      minProbes: 0,
    });
    expect(brief).not.toContain("adversarial probe");
    expect(brief).toContain("none recorded for this task");
  });
});

describe("formatTaskReviewPassBrief", () => {
  test("names every task this pass unblocked in the queue", () => {
    const brief = formatTaskReviewPassBrief({
      taskId: "task-1",
      validator: "val-1",
      gateSummary: "all green",
      reportPath: "review.json",
      taskStatus: "validated",
      unblockedTasks: ["task-2", "task-3"],
    });
    expect(brief).toContain("Unblocked `task-2`, `task-3` in queue");
  });

  test("names outstanding domains when the task is not yet fully satisfied", () => {
    const brief = formatTaskReviewPassBrief({
      taskId: "task-1",
      validator: "val-1",
      gateSummary: "unit tests passed",
      reportPath: "review.json",
      taskStatus: "validating",
      outstandingDomains: ["security", "performance"],
    });

    expect(brief).toContain("### Domain Passed, Task Still validating: task-1");
    expect(brief).toContain(
      "**Outstanding Domains**: security, performance still need an independent pass before task-1 is validated",
    );
  });

  test("a satisfied task omits outstanding domains even if some were passed in", () => {
    const brief = formatTaskReviewPassBrief({
      taskId: "task-1",
      validator: "val-1",
      gateSummary: "all green",
      reportPath: "review.json",
      taskStatus: "validated",
      outstandingDomains: ["security"],
    });
    expect(brief).toContain("### Task Validated & Satisfied: task-1");
    expect(brief).not.toContain("Outstanding Domains");
  });
});

describe("formatTaskProbeBrief", () => {
  test("lists every demand and includes a config warning when present", () => {
    const brief = formatTaskProbeBrief({
      taskId: "task-1",
      validator: "val-1",
      round: 2,
      demands: [
        { id: "D-1", demand: "prove the cache is invalidated" },
        { id: "D-2", demand: "show the failing test before the fix" },
      ],
      repairRound: 1,
      warning: "gate command changed since round 1",
    });

    expect(brief).toContain("### Adversarial Probe Recorded: task-1");
    expect(brief).toContain("Verdict: 🔎 PROBE (Round 2)");
    expect(brief).toContain("Repair round stays 1");
    expect(brief).toContain("`D-1`: prove the cache is invalidated");
    expect(brief).toContain("`D-2`: show the failing test before the fix");
    expect(brief).toContain("**Config Warning**: gate command changed since round 1");
  });

  test("omits the config warning line when none is given", () => {
    const brief = formatTaskProbeBrief({
      taskId: "task-1",
      validator: "val-1",
      round: 1,
      demands: [{ id: "D-1", demand: "prove it" }],
      repairRound: 0,
    });
    expect(brief).not.toContain("Config Warning");
  });
});

describe("formatTaskAssignRepairerBrief", () => {
  test("names the replacement agent, the reason, and the evidence for reassignment", () => {
    const brief = formatTaskAssignRepairerBrief({
      taskId: "task-1",
      replacementId: "repairer-2",
      reason: "original agent's lease expired mid-fix",
      evidence: "heartbeat gap exceeded grace period",
    });

    expect(brief).toContain("### Repairer Reassigned: task-1");
    expect(brief).toContain("**Replacement**: `repairer-2`");
    expect(brief).toContain("original agent's lease expired mid-fix");
    expect(brief).toContain("heartbeat gap exceeded grace period");
    expect(brief).toContain("task:claim --role repairer");
  });
});
