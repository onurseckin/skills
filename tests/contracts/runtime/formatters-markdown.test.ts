import { describe, expect, test } from "bun:test";
import {
  enforceLineLimit,
  formatCapsuleInitBrief,
  formatPlanCompileBrief,
  formatPlanStatusBrief,
  formatQueueEmptyBrief,
  formatQueueListBrief,
  formatQueueNextBrief,
  formatQueuePopBrief,
  formatRunCompleteBrief,
  formatRunExecBrief,
  formatRunStatusBrief,
  formatTable,
  formatTaskClaimBrief,
  formatTaskHeartbeatBrief,
  formatTaskRegisteredBrief,
  formatTaskRejectBrief,
  formatTaskReviewPassBrief,
  formatTaskSubmitBrief,
  formatValidationStartBrief,
} from "../../../olt/scripts/src/cli/formatters/index.ts";

export const formattersMarkdownSuiteName = "core CLI formatters: markdown layout, plan, queue, task & run briefs";

describe(formattersMarkdownSuiteName, () => {
  test("enforceLineLimit clamps markdown to specified line ceiling", () => {
    const lines50 = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`).join("\n");
    const clamped = enforceLineLimit(lines50, 25);
    expect(clamped.split("\n").length).toBeLessThanOrEqual(25);
    expect(clamped).toContain("truncated");

    const short = "Line 1\nLine 2";
    expect(enforceLineLimit(short, 10)).toBe(short);
  });

  test("formatTable renders valid markdown table rows", () => {
    const table = formatTable(
      ["Col A", "Col B"],
      [
        ["1", "2"],
        ["3", "4"],
      ],
    );
    expect(table[0]).toBe("| Col A | Col B |");
    expect(table[1]).toBe("| :--- | :--- |");
    expect(table[2]).toBe("| 1 | 2 |");
    expect(table[3]).toBe("| 3 | 4 |");
  });

  test("formatCapsuleInitBrief and run formatters", () => {
    const init = formatCapsuleInitBrief({
      runId: "run-001",
      runRoot: "/tmp/run-001",
      promptSha256: "abc123sha",
      promptBytes: 500,
      assurance: "source-verified",
    });
    expect(init).toContain("Capsule Initialized: run-001");

    const runStatus = formatRunStatusBrief(
      "run-001",
      "Running",
      [{ id: "task-1", label: "T1", writeScope: ["src/"], status: "running", agent: "w1" }],
      "1/2",
    );
    expect(runStatus).toContain("run-001");

    const runExec = formatRunExecBrief({
      commandStr: "bun test",
      exitCode: 0,
      durationSeconds: 0.5,
      outputSummary: "All tests pass",
    });
    expect(runExec).toContain("bun test");

    const runComp = formatRunCompleteBrief({
      runId: "run-001",
      capsulePath: "/tmp/capsules/run-001",
      tasksCount: 2,
      validationsCount: 2,
      gatesPassed: 2,
      totalGates: 2,
    });
    expect(runComp).toContain("run-001");
  });

  test("formatPlanCompileBrief and plan formatters", () => {
    const planBrief = formatPlanCompileBrief({
      revision: 1,
      totalTasks: 2,
      topology: {
        revision: 1,
        maxParallel: 2,
        waves: [{ wave: 1, taskIds: ["t1", "t2"] }],
      },
      topologyDeclaration: { independentRoots: 2, edgeCount: 0 },
      collisions: 0,
      requirementsCount: 2,
      runId: "run-001",
      advisories: [],
    });
    expect(planBrief).toContain("Plan Compiled");

    const planStatus = formatPlanStatusBrief("run-001", [
      { id: "t1", label: "Task 1", writeScope: ["src/"], gate: "bun test", deps: [] },
    ]);
    expect(planStatus).toContain("t1");
  });

  test("formatQueueNextBrief, empty, list, and pop formatters", () => {
    const next = formatQueueNextBrief({
      taskId: "task-1",
      label: "Task 1",
      priority: 90,
      writeScope: ["src/a.ts"],
      gates: ["bun test"],
      packetPath: "packet.md",
      runId: "run-001",
    });
    expect(next).toContain("task-1");

    const empty = formatQueueEmptyBrief("run-001");
    expect(empty).toContain("Queue Status: run-001");

    const list = formatQueueListBrief({
      ready: ["task-1"],
      leased: [{ id: "task-2", agent: "w-1" }],
      validating: ["task-3"],
      blocked: [{ id: "task-4", waitingOn: ["task-2"] }],
      satisfied: ["task-0"],
    });
    expect(list).toContain("task-1");

    const pop = formatQueuePopBrief({
      taskId: "task-1",
      agent: "w-1",
      token: "tok_1",
      deadlineMinutes: 20,
      expiresAt: "21:00:00",
      writeScope: ["src/a.ts"],
      gates: ["bun test"],
      packetPath: "packet.md",
    });
    expect(pop).toContain("tok_1");
  });

  test("formatTaskClaimBrief, heartbeat, submit, reject, review pass, and validation start", () => {
    const claim = formatTaskClaimBrief({
      taskId: "task-1",
      agent: "w-1",
      token: "tok_1",
      durationMinutes: 15,
      writeScope: ["src/a.ts"],
      packetPath: "packet.md",
    });
    expect(claim).toContain("task-1");

    const hb = formatTaskHeartbeatBrief({
      taskId: "task-1",
      agent: "w-1",
      extendedMinutes: 15,
      newDeadline: "21:30:00",
    });
    expect(hb).toContain("Extended");

    const submit = formatTaskSubmitBrief({
      taskId: "task-1",
      agent: "w-1",
      filesTouchedCount: 1,
      writeScope: ["src/a.ts"],
      reportPath: "report.json",
    });
    expect(submit).toContain("task-1");

    const valStart = formatValidationStartBrief({
      taskId: "task-1",
      validator: "val-1",
      token: "tok_v",
      gates: ["bun test"],
      packetPath: "val.md",
    });
    expect(valStart).toContain("val-1");

    const reviewPass = formatTaskReviewPassBrief({
      taskId: "task-1",
      validator: "val-1",
      gateSummary: "ok",
      reportPath: "rev.json",
      taskStatus: "validated",
    });
    expect(reviewPass).toContain("Task Validated");

    const reject = formatTaskRejectBrief({
      taskId: "task-1",
      validator: "val-1",
      findingId: "f-1",
      issue: "Bug",
      status: "changes_requested",
    });
    expect(reject).toContain("f-1");

    const reg = formatTaskRegisteredBrief({
      taskId: "task-1",
      label: "Label 1",
      writeScope: ["src/a.ts"],
      gateCmd: "bun test",
      deps: [],
      totalTasks: 1,
    });
    expect(reg).toContain("task-1");
  });
});
