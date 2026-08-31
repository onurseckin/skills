import { describe, expect, test } from "bun:test";
import { formatMorningReportMarkdown } from "../../../olt/scripts/src/orchestrator/morning-report.ts";
import { RunSupervisor } from "../../../olt/scripts/src/orchestrator/supervisor.ts";
import { runSupervisionWatch } from "../../../olt/scripts/src/orchestrator/supervision-watch.ts";
import { orchestratorSuperviseCommand } from "../../../olt/scripts/src/cli/commands/orchestrator-ops.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { workflowPort } from "../../../olt/scripts/src/integration/store-ports.ts";
import type { TransactionPort } from "../../../olt/scripts/src/workflow/types.ts";
import { supervisedRun } from "./index.ts";

function forceExpireLease(
  port: TransactionPort,
  actor: string,
  taskId: string,
  expiresAt: string,
): void {
  port.transact(actor, "test-force-expire", {}, (draft) => {
    const task = draft.tasks[taskId];
    if (task === undefined) {
      throw new Error(`expected task ${taskId} to exist to force-expire its lease`);
    }
    if (task.lease === undefined) {
      throw new Error(`expected an active lease on ${taskId} to force-expire`);
    }
    task.lease.expires_at = expiresAt;
  });
}

describe("RunSupervisor session reporting — scoped by actor and time window", () => {
  test("a later, idle pass by the same actor does not inherit a reclaim from hours earlier", async () => {
    const run = supervisedRun("supervisor-time-scope", 1);
    const port = workflowPort(run);
    const claimedAt = new Date("2020-01-01T00:00:00.000Z");
    claimTask(port, "t-1", "agent-a", "implementer", {
      leaseSeconds: 5,
      clock: { now: () => claimedAt },
    });

    const oldPass = await new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      clock: { now: () => new Date("2020-01-01T00:05:00.000Z") },
    }).run();
    expect(oldPass.lastTick.reclaimed).toHaveLength(1);
    expect(oldPass.report.deadAgentsReclaimed).toBe(1);

    const laterPass = await new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      clock: { now: () => new Date("2020-01-01T05:00:00.000Z") },
    }).run();
    expect(laterPass.lastTick.reclaimed).toHaveLength(0);
    expect(laterPass.report.deadAgentsReclaimed).toBe(0);
    expect(formatMorningReportMarkdown(laterPass.report, run)).toContain(
      "Dead agents reclaimed**: 0",
    );
  });

  test("a different orchestrator actor's reclaim from moments earlier is not counted as mine", async () => {
    const run = supervisedRun("supervisor-actor-scope", 1);
    const port = workflowPort(run);
    const claimedAt = new Date("2020-01-01T00:00:00.000Z");
    claimTask(port, "t-1", "agent-a", "implementer", {
      leaseSeconds: 5,
      clock: { now: () => claimedAt },
    });

    const reclaimAt = new Date("2020-01-01T00:05:00.000Z");
    const foreignPass = await new RunSupervisor({
      runRoot: run,
      actor: "orchestrator-foreign",
      maxParallel: 4,
      clock: { now: () => reclaimAt },
    }).run();
    expect(foreignPass.report.deadAgentsReclaimed).toBe(1);

    const minePass = await new RunSupervisor({
      runRoot: run,
      actor: "supervisor-mine",
      maxParallel: 4,
      clock: { now: () => new Date(reclaimAt.valueOf() + 1) },
    }).run();
    expect(minePass.lastTick.reclaimed).toHaveLength(0);
    expect(minePass.report.deadAgentsReclaimed).toBe(0);
  });

  test("a pass that genuinely reclaims two dead agents reports exactly 2, never a hard-coded 0", async () => {
    const run = supervisedRun("supervisor-positive-count", 2);
    const port = workflowPort(run);
    const claimedAt = new Date("2020-01-01T00:00:00.000Z");
    claimTask(port, "t-1", "agent-a", "implementer", {
      leaseSeconds: 5,
      clock: { now: () => claimedAt },
    });
    claimTask(port, "t-2", "agent-b", "implementer", {
      leaseSeconds: 5,
      clock: { now: () => claimedAt },
    });

    const result = await new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      clock: { now: () => new Date("2020-01-01T00:05:00.000Z") },
    }).run();

    expect(result.lastTick.reclaimed).toHaveLength(2);
    expect(result.report.deadAgentsReclaimed).toBe(2);
    expect(formatMorningReportMarkdown(result.report, run)).toContain("Dead agents reclaimed**: 2");
  });
});

describe("runSupervisionWatch session reporting — the same scoping applied to --watch", () => {
  function stoppedController(): AbortController {
    const controller = new AbortController();
    controller.abort();
    return controller;
  }

  test("a later, idle watch pass does not inherit an earlier reclaim from hours before", async () => {
    const run = supervisedRun("watch-time-scope", 1);
    const port = workflowPort(run);
    const claimedAt = new Date("2020-01-01T00:00:00.000Z");
    claimTask(port, "t-1", "agent-a", "implementer", {
      leaseSeconds: 5,
      clock: { now: () => claimedAt },
    });

    const oldPass = await runSupervisionWatch({
      runRoot: run,
      actor: "supervisor",
      intervalMs: 1,
      maxParallel: 4,
      clock: { now: () => new Date("2020-01-01T00:05:00.000Z") },
      signal: stoppedController().signal,
    });
    expect(oldPass.lastTick.reclaimed).toHaveLength(1);
    expect(oldPass.report.deadAgentsReclaimed).toBe(1);

    const laterPass = await runSupervisionWatch({
      runRoot: run,
      actor: "supervisor",
      intervalMs: 1,
      maxParallel: 4,
      clock: { now: () => new Date("2020-01-01T05:00:00.000Z") },
      signal: stoppedController().signal,
    });
    expect(laterPass.lastTick.reclaimed).toHaveLength(0);
    expect(laterPass.report.deadAgentsReclaimed).toBe(0);
  });

  test("a watch pass that genuinely reclaims two dead agents reports exactly 2", async () => {
    const run = supervisedRun("watch-positive-count", 2);
    const port = workflowPort(run);
    const claimedAt = new Date("2020-01-01T00:00:00.000Z");
    claimTask(port, "t-1", "agent-a", "implementer", {
      leaseSeconds: 5,
      clock: { now: () => claimedAt },
    });
    claimTask(port, "t-2", "agent-b", "implementer", {
      leaseSeconds: 5,
      clock: { now: () => claimedAt },
    });

    const result = await runSupervisionWatch({
      runRoot: run,
      actor: "supervisor",
      intervalMs: 1,
      maxParallel: 4,
      clock: { now: () => new Date("2020-01-01T00:05:00.000Z") },
      signal: stoppedController().signal,
    });
    expect(result.lastTick.reclaimed).toHaveLength(2);
    expect(result.report.deadAgentsReclaimed).toBe(2);
  });
});

describe('orchestrator:supervise (CLI) — the printed "Dead agents reclaimed" line', () => {
  test("reports 0 after a foreign actor's earlier reclaim, then exactly 1 for its own", async () => {
    const run = supervisedRun("cli-end-to-end", 2);
    const port = workflowPort(run);

    claimTask(port, "t-1", "agent-old", "implementer", { leaseSeconds: 5 });
    forceExpireLease(port, "test-setup", "t-1", "2000-01-01T00:00:00.000Z");
    const foreign = await orchestratorSuperviseCommand({ run, actor: "orchestrator-foreign" });
    expect(String(foreign.markdown)).toContain("Dead agents reclaimed**: 1");

    const idle = await orchestratorSuperviseCommand({ run, actor: "coordinator" });
    expect(String(idle.markdown)).toContain("Dead agents reclaimed**: 0");

    claimTask(port, "t-2", "agent-new", "implementer", { leaseSeconds: 5 });
    forceExpireLease(port, "test-setup", "t-2", "2000-01-01T00:00:00.000Z");
    const positive = await orchestratorSuperviseCommand({ run, actor: "coordinator" });
    expect(String(positive.markdown)).toContain("Dead agents reclaimed**: 1");
  });
});
