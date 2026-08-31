import { describe, expect, test } from "bun:test";
import { formatDoctorBrief } from "../../../../olt/scripts/src/cli/commands/diagnostics-ops.ts";
import {
  agentListNextActions,
  agentRegisterNextActions,
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
  mindInitNextActions,
  mindObserveNextActions,
  mindRoundNextActions,
  mindWakeNextActions,
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
  taskRejectNextActions,
  taskReviewPassNextActions,
  taskSubmitNextActions,
  validationStartNextActions,
  whoamiNextActions,
} from "../../../../olt/scripts/src/cli/formatters/index.ts";

describe("Next Actions Formatter - Action Chains & Roles", () => {
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

  describe("doctorNextActions is derived from the report doctor just produced", () => {
    test("recommends plan:enhance instead of run:status/queue:wave when the run is unplanned", () => {
      const actions = doctorNextActions("run-1", { healthy: false, planVerified: false });
      expect(actions[0]!.command).toContain("plan:enhance --run run-1");
      expect(actions.some((a) => a.command.includes("run:status"))).toBeFalse();
      expect(actions.some((a) => a.command.includes("queue:wave"))).toBeFalse();
    });

    test("leads with a critical finding's own remediation as a task:release command", () => {
      const actions = doctorNextActions("run-1", {
        healthy: false,
        planVerified: true,
        criticalFindings: [
          {
            role: "coordinator",
            agentId: "coordinator",
            taskId: "task-core",
            remediation:
              "Coordinators must not claim or lease implementation tasks. Implementation leases are exclusively for Tier 3 Implementers.",
          },
        ],
      });
      expect(actions[0]!.command).toBe(
        "bun harness.ts task:release --run run-1 --task task-core --agent coordinator --token <TOKEN>",
      );
      expect(actions[0]!.role).toBe("coordinator");
      expect(actions[0]!.description).toBe(
        "Coordinators must not claim or lease implementation tasks. Implementation leases are exclusively for Tier 3 Implementers.",
      );
      expect(actions.some((a) => a.command.includes("run:status"))).toBeTrue();
    });

    test("falls back to run:status/queue:wave when healthy and no findings are present", () => {
      const actions = doctorNextActions("run-1", { healthy: true, planVerified: true });
      expect(actions[0]!.command).toContain("run:status --run run-1");
      expect(actions[1]!.command).toContain("queue:wave --run run-1");
    });

    test("formatDoctorBrief renders the finding's remediation as the top Next Action from a real report shape", () => {
      const brief = formatDoctorBrief("run-1", {
        healthy: false,
        bun_version: "1.3.0",
        bun_supported: true,
        gitignored: true,
        plan_verified: true,
        issues: ["tier-confinement [critical] (Tier 2 coordinator/coordinator): illegal lease"],
        tier_confinement_findings: [
          {
            agent_id: "coordinator",
            role: "coordinator",
            tier: 2,
            violation_type: "coordinator_code_writing",
            severity: "critical",
            observation: 'Tier 2 Coordinator agent "coordinator" holds direct implementation lease',
            remediation:
              "Coordinators must not claim or lease implementation tasks. Implementation leases are exclusively for Tier 3 Implementers.",
            evidence: { task_id: "task-core" },
          },
        ],
      });
      expect(brief).toContain(
        "1. `bun harness.ts task:release --run run-1 --task task-core --agent coordinator --token <TOKEN>` [coordinator] — Coordinators must not claim or lease implementation tasks. Implementation leases are exclusively for Tier 3 Implementers.",
      );
    });

    test("formatDoctorBrief recommends plan:enhance, not run:status, when plan_verified is false", () => {
      const brief = formatDoctorBrief("run-1", {
        healthy: true,
        bun_version: "1.3.0",
        bun_supported: true,
        gitignored: true,
        plan_verified: false,
        issues: [],
      });
      expect(brief).not.toContain("run:status --run run-1");
      expect(brief).not.toContain("queue:wave --run run-1");
      expect(brief).toContain("plan:enhance --run run-1");
    });
  });
});
