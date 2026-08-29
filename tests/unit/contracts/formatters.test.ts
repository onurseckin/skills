import { describe, expect, test } from "bun:test";
import {
  enforceLineLimit,
  formatAgentBrief,
  formatAgentLineageBrief,
  formatAgentListBrief,
  formatAgentRegisterBrief,
  formatAgentReleaseBrief,
  formatAgentReportBrief,
  formatBranchAbandonBrief,
  formatBranchClaimBrief,
  formatBranchCollectBrief,
  formatBranchOpenBrief,
  formatBranchStatusBrief,
  formatBranchSubmitBrief,
  formatCapsuleInitBrief,
  formatEvidenceBrief,
  formatEvidenceListBrief,
  formatFindingBrief,
  formatFindingsListBrief,
  formatOrchestrateBrief,
  formatPlanCompileBrief,
  formatPlanStatusBrief,
  formatQueueEmptyBrief,
  formatQueueListBrief,
  formatQueueNextBrief,
  formatQueuePopBrief,
  formatReportBrief,
  formatReportsListBrief,
  formatRunCompleteBrief,
  formatRunExecBrief,
  formatRunStatusBrief,
  formatScreenshotsListBrief,
  formatTable,
  formatTaskClaimBrief,
  formatTaskHeartbeatBrief,
  formatTaskRegisteredBrief,
  formatTaskRejectBrief,
  formatTaskReviewPassBrief,
  formatTaskSubmitBrief,
  formatValidationStartBrief,
} from "../../../olt/scripts/src/cli/formatters/index.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { BranchRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import { evidenced } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TaskLineage } from "../../../olt/scripts/src/workflow/agents/lineage.ts";

describe("core CLI formatters & brief outputs", () => {
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

  test("agent, branch, inspection, and screenshot formatters", () => {
    const brief = formatAgentBrief({
      agentId: "agent-1",
      role: "implementer",
      parentAgentId: "coord-1",
      parentTaskId: "t1",
      model: "gemini-2.0",
      thinkingLevel: "high",
      tools: ["bun test"],
      writeScope: ["src/index.ts"],
      recommendedCommands: ["bun test tests/unit/index.test.ts"],
    });
    expect(brief).toContain("agent-1");

    const grant: AgentGrantRecord = {
      id: "agent-1",
      role: "implementer",
      parent_agent_id: null,
      parent_task_id: "t1",
      host: "darwin",
      granted_at: "2026-08-24T00:00:00.000Z",
      status: "active",
      provider: evidenced("google", "harness_observed"),
      model: evidenced("gemini-2.0", "harness_observed"),
      model_tier: evidenced("l", "harness_observed"),
      thinking_level: evidenced("high", "harness_observed"),
      context_window: evidenced(1000000, "harness_observed"),
      tools_granted: evidenced([{ name: "bun test" }], "harness_observed"),
      tokens_in: evidenced(100, "agent_reported"),
      tokens_out: evidenced(200, "agent_reported"),
    };

    expect(formatAgentRegisterBrief(grant, "run-001")).toContain("agent-1");
    expect(formatAgentReportBrief(grant, "run-001")).toContain("agent-1");
    expect(formatAgentReleaseBrief(grant, "run-001")).toContain("agent-1");
    expect(formatAgentListBrief([grant], "run-001")).toContain("agent-1");

    const lineage: TaskLineage = {
      task_id: "t1",
      agents: [
        {
          agent_id: "agent-1",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: "t1",
          status: "active",
          depth: 0,
          ancestors: [],
        },
      ],
    };
    expect(formatAgentLineageBrief(lineage)).toContain("agent-1");

    const branch: BranchRecord = {
      id: "b-1",
      parent_task_id: "t1",
      parent_agent_id: "agent-1",
      reason: "parallel decomposition",
      depth: 1,
      status: "open",
      opened_at: "2026-08-24T00:00:00.000Z",
      opened_observation: {
        observed_at: "2026-08-24T00:00:00.000Z",
        git_available: true,
        head: "sha1",
        entries: [],
      },
      sub_tasks: [
        {
          id: "st-1",
          label: "Subtask 1",
          write_scope: ["src/sub.ts"],
          status: "open",
        },
      ],
    };

    expect(formatBranchOpenBrief(branch, "run-001")).toContain("b-1");
    expect(formatBranchClaimBrief(branch, branch.sub_tasks[0]!, "tok-1", "run-001")).toContain(
      "b-1",
    );
    expect(formatBranchSubmitBrief(branch, "st-1")).toContain("b-1");
    expect(formatBranchCollectBrief(branch, "completed")).toContain("b-1");
    expect(formatBranchAbandonBrief(branch, "abandoned")).toContain("b-1");
    expect(formatBranchStatusBrief([branch], "run-001")).toContain("b-1");

    expect(
      formatFindingBrief({
        finding: { id: "f-1", severity: "critical", observation: "Crash bug" },
        path: "findings/f-1.json",
      }),
    ).toContain("f-1");

    expect(
      formatFindingsListBrief({
        findings: [{ id: "f-1", severity: "critical", observation: "Crash" }],
        count: 1,
      }),
    ).toContain("f-1");

    expect(
      formatReportBrief({
        report: { status: "passed", summary: "All checks passed" },
        path: "reports/rep-1.json",
        name: "Validation Report",
      }),
    ).toContain("Validation Report");

    expect(
      formatReportsListBrief({
        reports: [{ name: "Validation Report", path: "reports/rep-1.json" }],
        count: 1,
      }),
    ).toContain("Validation Report");

    expect(
      formatEvidenceBrief({
        evidence: { command_id: "ev-1", exit_code: 0, argv: ["bun", "test"] },
        path: "evidence/ev-1.json",
      }),
    ).toContain("ev-1");

    expect(
      formatEvidenceListBrief({
        evidence: [{ command_id: "ev-1", exit_code: 0, argv: ["bun", "test"] }],
        count: 1,
      }),
    ).toContain("ev-1");

    expect(
      formatScreenshotsListBrief({
        screenshots: [{ name: "shot-1", path: "/tmp/shot.png", task_id: "t1" }],
        count: 1,
        taskId: "t1",
      }),
    ).toContain("shot.png");

    expect(
      formatOrchestrateBrief({
        runId: "run-001",
        runRoot: "/tmp/capsules/run-001",
        promptSha256: "abc123sha",
        promptBytes: 500,
        runIdWasDerived: true,
      }),
    ).toContain("run-001");
  });
});
