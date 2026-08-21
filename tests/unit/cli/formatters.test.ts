import { describe, expect, test } from "bun:test";
import {
  enforceLineLimit,
  formatCapsuleInitBrief,
  formatCriticReviewBrief,
  formatCriticStartBrief,
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
} from "../../../orchestrating-long-tasks/scripts/src/cli/formatters/index.ts";

describe("Markdown Formatters", () => {
  test("enforceLineLimit clamps markdown to max lines", () => {
    const longText = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`).join("\n");
    const clamped = enforceLineLimit(longText, 30);
    const lines = clamped.split("\n");
    expect(lines.length).toBeLessThanOrEqual(30);
    expect(clamped).toContain("truncated");
  });

  test("formatTable generates markdown tables", () => {
    const rows = formatTable(
      ["A", "B"],
      [
        ["1", "2"],
        ["3", "4"],
      ],
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toBe("| A | B |");
    expect(rows[1]).toBe("| :--- | :--- |");
  });

  test("all brief formatters produce valid markdown <= 30 lines", () => {
    const initBrief = formatCapsuleInitBrief({
      runId: "run-1",
      runRoot: ".capsules/run-1",
      promptSha256: "abc123sha",
      promptBytes: 1200,
      assurance: "source-verified",
    });
    expect(initBrief.split("\n").length).toBeLessThanOrEqual(30);
    expect(initBrief).toContain("### Capsule Initialized: run-1");

    const taskRegBrief = formatTaskRegisteredBrief({
      taskId: "task-1",
      label: "Task One",
      writeScope: ["src/a", "tests/a"],
      gateCmd: "bun test tests/a",
      deps: [],
      totalTasks: 1,
    });
    expect(taskRegBrief.split("\n").length).toBeLessThanOrEqual(30);

    const compileBrief = formatPlanCompileBrief({
      revision: 1,
      totalTasks: 3,
      topology: {
        revision: 1,
        maxParallel: 3,
        waves: [
          { wave: 1, taskIds: ["t1", "t2"] },
          { wave: 2, taskIds: ["t3"] },
        ],
      },
      topologyDeclaration: { independentRoots: 2, edgeCount: 1 },
      collisions: 0,
      requirementsCount: 3,
      runId: "run-1",
      advisories: ["Advisory 1"],
    });
    expect(compileBrief.split("\n").length).toBeLessThanOrEqual(30);

    const planStatus = formatPlanStatusBrief("run-1", [
      { id: "t1", label: "T1", writeScope: ["a"], gate: "g", deps: [] },
    ]);
    expect(planStatus.split("\n").length).toBeLessThanOrEqual(30);

    const queueNext = formatQueueNextBrief({
      taskId: "task-1",
      label: "Task 1",
      priority: 80,
      writeScope: ["src/a"],
      gates: ["bun test"],
      packetPath: ".capsules/packet.md",
      runId: "run-1",
    });
    expect(queueNext.split("\n").length).toBeLessThanOrEqual(30);

    const queueEmpty = formatQueueEmptyBrief("run-1");
    expect(queueEmpty.split("\n").length).toBeLessThanOrEqual(30);

    const queueList = formatQueueListBrief({
      ready: ["t1"],
      leased: [{ id: "t2", agent: "w1" }],
      validating: ["t3"],
      blocked: [{ id: "t4", waitingOn: ["t2"] }],
      satisfied: ["t0"],
    });
    expect(queueList.split("\n").length).toBeLessThanOrEqual(30);

    const queuePop = formatQueuePopBrief({
      taskId: "task-1",
      agent: "worker-1",
      token: "tok_123",
      deadlineMinutes: 30,
      expiresAt: "20:00:00",
      writeScope: ["src/a"],
      gates: ["bun test"],
      packetPath: ".capsules/packet.md",
    });
    expect(queuePop.split("\n").length).toBeLessThanOrEqual(30);

    const taskClaim = formatTaskClaimBrief({
      taskId: "task-1",
      agent: "w1",
      token: "tok_1",
      durationMinutes: 30,
      writeScope: ["src/a"],
      packetPath: "packet.md",
    });
    expect(taskClaim.split("\n").length).toBeLessThanOrEqual(30);

    const taskHb = formatTaskHeartbeatBrief({
      taskId: "task-1",
      agent: "w1",
      extendedMinutes: 30,
      newDeadline: "21:00:00",
    });
    expect(taskHb.split("\n").length).toBeLessThanOrEqual(30);

    const taskSub = formatTaskSubmitBrief({
      taskId: "task-1",
      agent: "w1",
      filesTouchedCount: 3,
      writeScope: ["src/a"],
      reportPath: "report.json",
    });
    expect(taskSub.split("\n").length).toBeLessThanOrEqual(30);

    const valStart = formatValidationStartBrief({
      taskId: "task-1",
      validator: "val-1",
      token: "tok_v",
      gates: ["bun test"],
      packetPath: "val.md",
    });
    expect(valStart.split("\n").length).toBeLessThanOrEqual(30);

    const reviewPass = formatTaskReviewPassBrief({
      taskId: "task-1",
      validator: "val-1",
      gateSummary: "all tests passed",
      reportPath: "review.json",
      taskStatus: "validated",
    });
    expect(reviewPass.split("\n").length).toBeLessThanOrEqual(30);

    const taskRej = formatTaskRejectBrief({
      taskId: "task-1",
      validator: "val-1",
      findingId: "f-1",
      issue: "timeout",
      status: "changes_requested",
    });
    expect(taskRej.split("\n").length).toBeLessThanOrEqual(30);

    const critStart = formatCriticStartBrief({
      critic: "c-1",
      token: "tok_c",
      tasksSatisfied: 3,
      totalTasks: 3,
      reqsEvidenced: 3,
      totalReqs: 3,
      finalGates: ["bun test"],
      packetPath: "critic.md",
    });
    expect(critStart.split("\n").length).toBeLessThanOrEqual(30);

    const critRevApprove = formatCriticReviewBrief({
      critic: "c-1",
      decision: "approve",
      summary: "all good",
      token: "tok_c",
      runId: "run-1",
    });
    expect(critRevApprove.split("\n").length).toBeLessThanOrEqual(30);

    const critRevReq = formatCriticReviewBrief({
      critic: "c-1",
      decision: "request_changes",
      summary: "missing test",
      token: "tok_c",
      runId: "run-1",
      findingId: "f-c-1",
    });
    expect(critRevReq.split("\n").length).toBeLessThanOrEqual(30);

    const runComp = formatRunCompleteBrief({
      runId: "run-1",
      capsulePath: ".capsules/run-1",
      tasksCount: 3,
      validationsCount: 3,
      gatesPassed: 3,
      totalGates: 3,
    });
    expect(runComp.split("\n").length).toBeLessThanOrEqual(30);
    // Nothing measured token usage, so the brief claims no efficiency figure at all.
    expect(runComp).not.toContain("Token Efficiency");
    expect(runComp).toContain("**Run Duration**: unknown");

    const runStat = formatRunStatusBrief("run-1", "Executing", [], "0/0");
    expect(runStat.split("\n").length).toBeLessThanOrEqual(30);

    const runExec = formatRunExecBrief({
      commandStr: "bun test",
      exitCode: 0,
      durationSeconds: 1.2,
      outputSummary: "pass",
    });
    expect(runExec.split("\n").length).toBeLessThanOrEqual(30);
  });
});
