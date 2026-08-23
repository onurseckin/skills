import { describe, expect, test } from "bun:test";
import { formatDoctorBrief } from "../../../olt/scripts/src/cli/commands/diagnostics-ops.ts";
import {
  agentListNextActions,
  agentRegisterNextActions,
  autoPartitionNextActions,
  branchClaimNextActions,
  branchCollectNextActions,
  branchOpenNextActions,
  branchStatusNextActions,
  branchSubmitNextActions,
  criticRejectNextActions,
  criticReviewNextActions,
  criticStartNextActions,
  doctorNextActions,
  evidenceGetNextActions,
  findingGetNextActions,
  formatAgentListBrief,
  formatAgentRegisterBrief,
  formatAutoPartitionBrief,
  formatBranchOpenBrief,
  formatCapsuleInitBrief,
  formatCriticReviewBrief,
  formatCriticStartBrief,
  formatFindingBrief,
  formatNextActions,
  formatOrchestrateBrief,
  formatPlanApplyBrief,
  formatPlanAuditBrief,
  formatPlanClaimBrief,
  formatPlanCompileBrief,
  formatPlanEnhanceBrief,
  formatPlanReplanBrief,
  formatPlanReviewBrief,
  formatPlanStatusBrief,
  formatPlanValidateStartBrief,
  formatQueueEmptyBrief,
  formatQueueListBrief,
  formatQueueNextBrief,
  formatQueuePopBrief,
  formatQueueWaveBrief,
  formatReportBrief,
  formatRunCompleteBrief,
  formatRunExecBrief,
  formatRunStatusBrief,
  formatTaskAssignRepairerBrief,
  formatTaskClaimBrief,
  formatTaskHeartbeatBrief,
  formatTaskProbeBrief,
  formatTaskRegisteredBrief,
  formatTaskRejectBrief,
  formatTaskReviewPassBrief,
  formatTaskSubmitBrief,
  formatValidationStartBrief,
  mindInitNextActions,
  mindObserveNextActions,
  mindRoundNextActions,
  mindWakeNextActions,
  nextActionsBlock,
  orchestrateNextActions,
  planApplyNextActions,
  planAuditNextActions,
  planClaimNextActions,
  planCompileNextActions,
  planEnhanceNextActions,
  planInitNextActions,
  planReplanNextActions,
  planReviewNextActions,
  planStatusNextActions,
  planValidateStartNextActions,
  queueEmptyNextActions,
  queueListNextActions,
  queueNextNextActions,
  queueWaveNextActions,
  recoverNextActions,
  reportGetNextActions,
  runCompleteNextActions,
  runExecNextActions,
  runStatusNextActions,
  taskAssignRepairerNextActions,
  taskClaimNextActions,
  taskHeartbeatNextActions,
  taskProbeNextActions,
  taskRegisteredNextActions,
  taskRejectNextActions,
  taskReviewPassNextActions,
  taskSubmitNextActions,
  validationStartNextActions,
  whoamiNextActions,
  type NextActionItem,
} from "../../../olt/scripts/src/cli/formatters/index.ts";

describe("Next Actions Formatter", () => {
  test("nextActionsBlock returns empty array for no actions", () => {
    expect(nextActionsBlock([])).toEqual([]);
    expect(formatNextActions([])).toBe("");
  });

  test("nextActionsBlock formats string actions", () => {
    const lines = nextActionsBlock(["bun harness.ts run:status", "bun harness.ts queue:next"]);
    expect(lines).toEqual([
      "",
      "⚡ Next Actions:",
      "1. `bun harness.ts run:status`",
      "2. `bun harness.ts queue:next`",
    ]);
    expect(formatNextActions(["bun harness.ts run:status"])).toBe(
      "⚡ Next Actions:\n1. `bun harness.ts run:status`",
    );
  });

  test("nextActionsBlock formats role-aware action objects", () => {
    const actions: NextActionItem[] = [
      {
        command: "bun harness.ts queue:wave --run run-1",
        role: "Coordinator",
        description: "Dispatch Wave 1 tasks",
      },
      {
        command: "bun harness.ts run:status --run run-1",
        role: "Orchestrator",
        description: "Monitor active lanes",
      },
      {
        command: "bun harness.ts doctor",
      },
    ];
    const lines = nextActionsBlock(actions);
    expect(lines).toContain("⚡ Next Actions:");
    expect(lines).toContain(
      "1. `bun harness.ts queue:wave --run run-1` [Coordinator] — Dispatch Wave 1 tasks",
    );
    expect(lines).toContain(
      "2. `bun harness.ts run:status --run run-1` [Orchestrator] — Monitor active lanes",
    );
    expect(lines).toContain("3. `bun harness.ts doctor`");
  });
});

describe("Next Actions Helper Generators", () => {
  test("plan and orchestration helpers generate exact role-bound commands", () => {
    const initActions = planInitNextActions(".olt/capsules/run-1");
    expect(initActions.length).toBe(2);
    expect(initActions[0]!.command).toContain("plan:enhance --run .capsules/run-1");
    expect(initActions[0]!.role).toBe("Planner");
    expect(initActions[1]!.command).toContain("plan:add --run .capsules/run-1");

    const orchActions = orchestrateNextActions(".olt/capsules/run-1");
    expect(orchActions.length).toBe(3);
    expect(orchActions[0]!.role).toBe("Orchestrator");
    expect(orchActions[1]!.role).toBe("Planner");
    expect(orchActions[2]!.role).toBe("Coordinator");

    const regActions = taskRegisteredNextActions(".olt/capsules/run-1");
    expect(regActions[0]!.command).toContain("plan:add --run .capsules/run-1");
    expect(regActions[1]!.command).toContain("plan:compile --run .capsules/run-1");

    const enhanceActions = planEnhanceNextActions(".olt/capsules/run-1");
    expect(enhanceActions[0]!.command).toContain("plan:add --run .capsules/run-1");
    expect(enhanceActions[1]!.command).toContain("plan:compile --run .capsules/run-1");

    const compileActions = planCompileNextActions(".olt/capsules/run-1", true);
    expect(compileActions[0]!.role).toBe("Plan-Validator");
    expect(compileActions[1]!.role).toBe("Coordinator");

    const compileEmptyActions = planCompileNextActions(".olt/capsules/run-1", false);
    expect(compileEmptyActions[0]!.description).toContain("unblock scheduler");

    const statusCompiled = planStatusNextActions("run-1", true);
    expect(statusCompiled[0]!.role).toBe("Implementer");

    const statusUncompiled = planStatusNextActions("run-1", false);
    expect(statusUncompiled[0]!.role).toBe("Planner");

    const replanActions = planReplanNextActions("run-1", "repair-task-1");
    expect(replanActions[0]!.role).toBe("Coordinator");
    expect(replanActions[1]!.command).toContain("repair-task-1");

    const claimActions = planClaimNextActions("run-1", 2);
    expect(claimActions[0]!.command).toContain("--expected-revision 2");

    const applyActions = planApplyNextActions("run-1");
    expect(applyActions[0]!.role).toBe("Plan-Validator");

    const auditClean = planAuditNextActions("run-1", false);
    expect(auditClean.length).toBe(1);

    const auditBlocking = planAuditNextActions("run-1", true, "A1-granularity");
    expect(auditBlocking[0]!.command).toContain("--accept-audit A1-granularity");

    const validateStart = planValidateStartNextActions("run-1", "val-1", "tok-123");
    expect(validateStart[0]!.command).toContain("--status approved");
    expect(validateStart[1]!.command).toContain("--status changes_requested");

    const reviewApproved = planReviewNextActions("run-1", true);
    expect(reviewApproved[0]!.role).toBe("Coordinator");

    const reviewRejected = planReviewNextActions("run-1", false);
    expect(reviewRejected[0]!.command).toContain("plan:replan");

    const autoPart = autoPartitionNextActions("run-1");
    expect(autoPart[0]!.command).toContain("plan:compile");
  });

  test("task lifecycle helpers generate exact commands", () => {
    const claim = taskClaimNextActions("run-1", "task-1", "agent-1", "tok-1");
    expect(claim[0]!.command).toContain("task:heartbeat");
    expect(claim[1]!.command).toContain("task:submit");

    const hb = taskHeartbeatNextActions("run-1", "task-1", "agent-1", "tok-1");
    expect(hb[0]!.command).toContain("task:submit");

    const sub = taskSubmitNextActions("run-1", "task-1");
    expect(sub[0]!.command).toContain("task:validate-start");

    const valStartWithProbes = validationStartNextActions("run-1", "task-1", "val-1", "tok-v", 1);
    expect(valStartWithProbes[0]!.command).toContain("task:probe");
    expect(valStartWithProbes[1]!.command).toContain("task:review");

    const valStartNoProbes = validationStartNextActions("run-1", "task-1", "val-1", "tok-v", 0);
    expect(valStartNoProbes[0]!.command).toContain("task:review");

    const revPass = taskReviewPassNextActions("run-1", "task-2");
    expect(revPass[0]!.command).toContain("--task task-2");

    const rej = taskRejectNextActions("run-1", "task-1");
    expect(rej[0]!.role).toBe("Repairer");
    expect(rej[1]!.role).toBe("Coordinator");

    const probe = taskProbeNextActions("run-1", "task-1", "val-1", "tok-v");
    expect(probe[0]!.command).toContain("run:exec");
    expect(probe[1]!.command).toContain("task:review");

    const repAssign = taskAssignRepairerNextActions("run-1", "task-1", "rep-2");
    expect(repAssign[0]!.command).toContain("--agent rep-2");
  });

  test("queue, critic, and run helpers generate exact guidance", () => {
    const qNext = queueNextNextActions("run-1", "task-1");
    expect(qNext[0]!.command).toContain("task:claim --run run-1 --task task-1");

    const qEmpty = queueEmptyNextActions("run-1");
    expect(qEmpty[0]!.command).toContain("run:status");

    const qWave = queueWaveNextActions("run-1", "task-1");
    expect(qWave[0]!.command).toContain("task:claim");

    const qList = queueListNextActions("run-1");
    expect(qList[0]!.command).toContain("queue:wave");

    const critStart = criticStartNextActions("run-1", "c-1", "tok-c");
    expect(critStart[0]!.command).toContain("critic:review");
    expect(critStart[0]!.command).toContain("--decision approve");

    const critRevApprove = criticReviewNextActions("run-1", true, "tok-auth");
    expect(critRevApprove[0]!.command).toContain("run:complete --run run-1 --auth-token tok-auth");

    const critRevReq = criticReviewNextActions("run-1", false, undefined, "f-123");
    expect(critRevReq[0]!.command).toContain("plan:replan --run run-1 --findings f-123");
    expect(critRevReq[1]!.command).toContain("critic:remediate --run run-1 --finding f-123");

    const critRej = criticRejectNextActions("run-1", "f-123");
    expect(critRej[0]!.command).toContain("plan:replan");

    const runComp = runCompleteNextActions("run-1");
    expect(runComp[0]!.command).toContain("report:unified");

    const runStatExec = runStatusNextActions("run-1", "Executing", false);
    expect(runStatExec[0]!.command).toContain("queue:wave");

    const runStatSat = runStatusNextActions("run-1", "Executing", true);
    expect(runStatSat[0]!.command).toContain("critic:start");

    const runExec = runExecNextActions("run-1", "cmd-1");
    expect(runExec[0]!.command).toContain("evidence:get");
  });

  test("agent, branch, authority, and mind helpers generate exact commands", () => {
    const agReg = agentRegisterNextActions("run-1", "ag-1");
    expect(agReg[0]!.command).toContain("queue:next");
    expect(agReg[1]!.command).toContain("agent:release");

    const agList = agentListNextActions("run-1");
    expect(agList[0]!.command).toContain("agent:register");

    const brOpen = branchOpenNextActions("run-1", "br-1", "sub-1", "p-1");
    expect(brOpen[0]!.command).toContain("branch:claim");
    expect(brOpen[1]!.command).toContain("branch:collect");

    const brClaim = branchClaimNextActions("run-1", "br-1", "sub-1", "sub-ag", "tok-sub");
    expect(brClaim[0]!.command).toContain("branch:submit");

    const brSub = branchSubmitNextActions("run-1", "br-1", "p-1");
    expect(brSub[0]!.command).toContain("branch:collect");

    const brCol = branchCollectNextActions("run-1", "parent-task", "p-1");
    expect(brCol[0]!.command).toContain("task:submit");

    const brStat = branchStatusNextActions("run-1");
    expect(brStat[0]!.command).toContain("branch:open");

    const whoamiMain = whoamiNextActions(null, true);
    expect(whoamiMain[0]!.role).toBe("Main-Thread");
    expect(whoamiMain[0]!.command).toContain("orchestrate");

    const whoamiRun = whoamiNextActions("run-1", false);
    expect(whoamiRun[0]!.command).toContain("run:status --run run-1");

    const doc = doctorNextActions("run-1");
    expect(doc[0]!.command).toContain("run:status");

    const rec = recoverNextActions("run-1");
    expect(rec[0]!.command).toContain("queue:wave");

    const findGet = findingGetNextActions("run-1", "f-1");
    expect(findGet[0]!.command).toContain("plan:replan");

    const repGet = reportGetNextActions("run-1");
    expect(repGet[0]!.command).toContain("report:get");

    const evGet = evidenceGetNextActions("run-1");
    expect(evGet[0]!.command).toContain("evidence:get");

    const mInit = mindInitNextActions("run-1");
    expect(mInit[0]!.command).toContain("mind:wake");

    const mWake = mindWakeNextActions("run-1");
    expect(mWake[0]!.command).toContain("mind:round");

    const mObs = mindObserveNextActions("run-1");
    expect(mObs[0]!.command).toContain("mind:round");

    const mRnd = mindRoundNextActions("run-1");
    expect(mRnd[0]!.command).toContain("mind:observe");
  });
});

describe("Formatter Integration with ⚡ Next Actions GPS blocks", () => {
  test("every brief includes ⚡ Next Actions and satisfies <= 30 line limit", () => {
    const briefs = [
      formatOrchestrateBrief({
        runId: "run-1",
        runRoot: "/capsules/run-1",
        promptSha256: "abc",
        promptBytes: 100,
        runIdWasDerived: false,
      }),
      formatCapsuleInitBrief({
        runId: "run-1",
        runRoot: ".olt/capsules/run-1",
        promptSha256: "abc",
        assurance: "source-verified",
      }),
      formatTaskRegisteredBrief({
        taskId: "task-1",
        label: "T1",
        writeScope: ["src/"],
        gateCmd: "bun test",
        deps: [],
        totalTasks: 1,
      }),
      formatPlanEnhanceBrief({
        runId: "run-1",
        markdownPath: "plan.md",
        jsonPath: "plan.json",
        markdownSha256: "abc",
        promptSha256: "def",
        revision: 1,
        summaryPresent: true,
        counts: { observations: 1, todos: 1, risks: 0, openQuestions: 0, sources: 1 },
      }),
      formatPlanCompileBrief({
        revision: 1,
        totalTasks: 1,
        topology: { revision: 1, maxParallel: 1, waves: [{ wave: 1, taskIds: ["t1"] }] },
        topologyDeclaration: { independentRoots: 1, edgeCount: 0 },
        collisions: 0,
        requirementsCount: 1,
        runId: "run-1",
      }),
      formatPlanStatusBrief("run-1", [
        { id: "t1", label: "T1", writeScope: ["a"], gate: "g", deps: [] },
      ]),
      formatPlanReplanBrief({
        revision: 2,
        repairRound: 1,
        newTasksCount: 1,
        repairTasks: [
          { id: "R-1", writeScope: ["src/"], findingsCount: 1, gate: "g", gateSource: "finding" },
        ],
        runId: "run-1",
      }),
      formatPlanClaimBrief({ runId: "run-1", agent: "planner", packetId: "P-1" }),
      formatPlanApplyBrief({ runId: "run-1", revision: 2, totalTasks: 3 }),
      formatAutoPartitionBrief({
        glob: "src/**/*.ts",
        groupBy: "file",
        taskIds: ["t1", "t2"],
        totalTasks: 2,
        breadthWarnings: [],
      }),
      formatPlanAuditBrief({ runId: "run-1", revision: 1, findings: [], notEvaluated: [] }),
      formatPlanValidateStartBrief({
        runId: "run-1",
        validator: "val-1",
        token: "tok-v",
        graphRevision: 1,
        totalTasks: 2,
      }),
      formatPlanReviewBrief({
        runId: "run-1",
        validator: "val-1",
        status: "approved",
        graphRevision: 1,
        findingsCount: 0,
        summary: "looks good",
        dependencyEdgesReviewed: 1,
        gateIdsReviewed: 1,
      }),
      formatTaskClaimBrief({
        taskId: "task-1",
        agent: "w1",
        token: "tok-1",
        durationMinutes: 30,
        writeScope: ["src/"],
      }),
      formatTaskHeartbeatBrief({
        taskId: "task-1",
        agent: "w1",
        extendedMinutes: 30,
        newDeadline: "21:00",
      }),
      formatTaskSubmitBrief({
        taskId: "task-1",
        agent: "w1",
        filesTouchedCount: 1,
        writeScope: ["src/"],
        reportPath: "r.json",
      }),
      formatValidationStartBrief({
        taskId: "task-1",
        validator: "val-1",
        token: "tok-v",
        gates: ["bun test"],
      }),
      formatTaskReviewPassBrief({
        taskId: "task-1",
        validator: "val-1",
        gateSummary: "passed",
        reportPath: "r.json",
        taskStatus: "validated",
      }),
      formatTaskRejectBrief({
        taskId: "task-1",
        validator: "val-1",
        findingId: "f-1",
        issue: "failed",
        status: "changes_requested",
      }),
      formatTaskProbeBrief({
        taskId: "task-1",
        validator: "val-1",
        round: 1,
        demands: [{ id: "d1", demand: "show proof" }],
        repairRound: 0,
      }),
      formatTaskAssignRepairerBrief({
        taskId: "task-1",
        replacementId: "rep-2",
        reason: "stuck",
        evidence: "timeout",
      }),
      formatQueueNextBrief({
        taskId: "task-1",
        label: "T1",
        priority: 50,
        writeScope: ["src/"],
        gates: ["bun test"],
        runId: "run-1",
      }),
      formatQueueEmptyBrief("run-1"),
      formatQueueListBrief({
        ready: ["t1"],
        leased: [],
        validating: [],
        blocked: [],
        satisfied: [],
      }),
      formatQueueWaveBrief({
        runId: "run-1",
        entries: [
          { taskId: "t1", label: "T1", priority: 50, writeScope: ["src/"], recordedWave: 1 },
        ],
        maxParallel: 4,
        topologySource: "recorded",
        topologyRevision: 1,
      }),
      formatQueuePopBrief({
        taskId: "t1",
        agent: "w1",
        token: "tok-1",
        deadlineMinutes: 30,
        expiresAt: "22:00",
        writeScope: ["src/"],
        gates: ["bun test"],
      }),
      formatCriticStartBrief({
        critic: "c1",
        token: "tok-c",
        tasksSatisfied: 2,
        totalTasks: 2,
        reqsEvidenced: 2,
        totalReqs: 2,
        finalGates: [],
      }),
      formatCriticReviewBrief({
        critic: "c1",
        decision: "approve",
        summary: "all done",
        token: "tok-c",
        runId: "run-1",
      }),
      formatRunCompleteBrief({
        runId: "run-1",
        capsulePath: "/capsules/run-1",
        tasksCount: 2,
        validationsCount: 2,
        gatesPassed: 2,
        totalGates: 2,
      }),
      formatRunStatusBrief("run-1", "Executing", [], "1/1"),
      formatRunExecBrief({ commandStr: "bun test", exitCode: 0, outputSummary: "ok" }),
      formatAgentRegisterBrief(
        {
          id: "ag-1",
          role: "implementer",
          host: "local",
          provider: { value: "openai", evidence_class: "agent_reported" },
          model: { value: "gpt-4", evidence_class: "agent_reported" },
          model_tier: { value: "tier-3", evidence_class: "agent_reported" },
          thinking_level: { value: "high", evidence_class: "agent_reported" },
          context_window: { value: 128000, evidence_class: "agent_reported" },
          tools_granted: { value: [], evidence_class: "agent_reported" },
          parent_agent_id: null,
          parent_task_id: null,
          granted_at: "now",
          status: "active",
        },
        "run-1",
      ),
      formatAgentListBrief([], "run-1", false),
      formatBranchOpenBrief(
        {
          id: "br-1",
          parent_task_id: "t1",
          parent_agent_id: "ag-1",
          reason: "subdivide",
          depth: 1,
          status: "open",
          sub_tasks: [],
        },
        "run-1",
      ),
      formatFindingBrief({
        finding: { id: "f-1", severity: "blocking", message: "fail" },
        path: "f.json",
      }),
      formatReportBrief({
        report: { status: "pass", summary: "passed" },
        path: "rep.json",
        name: "review",
      }),
      formatDoctorBrief("run-1", {
        healthy: true,
        bun_version: "1.3.0",
        bun_supported: true,
        gitignored: true,
        issues: [],
      }),
    ];

    for (const brief of briefs) {
      expect(brief).toContain("⚡ Next Actions:");
      expect(brief.split("\n").length).toBeLessThanOrEqual(30);
    }
  });
});
