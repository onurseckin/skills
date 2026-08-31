import { afterEach, describe, expect, test } from "bun:test";
import {
  isMicroCycleRecord,
  type MicroCycleRecord,
} from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  formatMicroCycleFeedback,
  getLatestMicroCycle,
  getOpenMicroCycles,
  markMicroCycleAddressed,
  recordMicroCycleCritique,
} from "../../../../olt/scripts/src/workflow/review/micro-cycle.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { taskRejectCommand } from "../../../../olt/scripts/src/cli/commands/task-reject.ts";
import { taskReviewCommand } from "../../../../olt/scripts/src/cli/commands/task-review.ts";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import type { Clock, TaskRecord, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import { cleanupRoots } from "../../../cli/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../../cli/file-persistence-fixture.ts";
import { registerTaskPacket, TestPort, workflowState } from "../../shared/test-port.ts";

class FakeClock implements Clock {
  public constructor(private ms = new Date("2026-08-22T12:00:00.000Z").getTime()) {}
  public now(): Date {
    return new Date(this.ms);
  }
  public tick(deltaMs = 1_000): Date {
    this.ms += deltaMs;
    return this.now();
  }
  public iso(): string {
    return this.now().toISOString();
  }
}

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

const taskIn = (s: WorkflowState, id = "T-1"): TaskRecord => s.tasks[id]!;

function leasedPort(clock: FakeClock): { port: TestPort; token: string } {
  const port = new TestPort(workflowState());
  registerTaskPacket(port, "implementer", "worker-1", 1, "T-1");
  const { token } = claimTask(port, "T-1", "worker-1", "implementer", { clock });
  return { port, token };
}

describe("CLI commands integration: task:reject and task:review with micro-cycles", () => {
  test("taskRejectCommand with --micro-cycle records critique and keeps implementer lease active", async () => {
    const { run } = await setupCompiledRun("micro-cycle-reject-test", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "w-1",
      "--role",
      "implementer",
      "--host",
      "antigravity",
      "--parent-task",
      "task-core",
    ]);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "w-1",
      "--role",
      "implementer",
    ]);
    expect(claim.token).toBeDefined();

    const r1 = await taskRejectCommand({
      run,
      task: "task-core",
      validator: "val-inline",
      reason: "Missing check",
      remediation: "Add check",
      "micro-cycle": true,
    });
    expect(r1.micro_cycle).toBe(true);
    expect(r1.round).toBe(1);
    expect(r1.markdown).toContain("### 🔄 Micro-Cycle Feedback (Round 1/3)");
    const task = r1.task as {
      status: string;
      lease?: { agent_id: string };
      micro_cycles?: MicroCycleRecord[];
    };
    expect(task.status).toBe("leased");
    expect(task.lease?.agent_id).toBe("w-1");
    expect(task.micro_cycles?.[0]?.status).toBe("open");

    const r2 = await taskRejectCommand({
      run,
      task: "task-core",
      validator: "val-inline",
      reason: "Ensure return type",
      "in-lease": true,
    });
    expect(r2.micro_cycle).toBe(true);
    expect(r2.round).toBe(2);
  });

  test("taskReviewCommand with --micro-cycle and --status fail records in-lease critique", async () => {
    const { run } = await setupCompiledRun("micro-cycle-review-fail-test", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "w-1",
      "--role",
      "implementer",
      "--host",
      "antigravity",
      "--parent-task",
      "task-core",
    ]);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "w-1",
      "--role",
      "implementer",
    ]);

    const r = await taskReviewCommand({
      run,
      task: "task-core",
      validator: "val-1",
      token: "dummy",
      status: "fail",
      summary: "Issues",
      remediation: "Fix",
      severity: "minor",
      "micro-cycle": true,
    });
    expect(r.micro_cycle).toBe(true);
    expect(r.round).toBe(1);
    expect(r.markdown).toContain("### 🔄 Micro-Cycle Feedback (Round 1/3)");
    expect((r.task as { status: string }).status).toBe("leased");
    expect((r.task as { micro_cycles?: MicroCycleRecord[] }).micro_cycles).toHaveLength(1);
  });

  test("markMicroCycleAddressed integrates with review workflow to clear open micro-cycles", () => {
    const clock = new FakeClock(),
      { port } = leasedPort(clock);
    recordMicroCycleCritique(port, "T-1", "val-1", "Minor syntax", { clock });
    expect(getOpenMicroCycles(taskIn(port.read()))).toHaveLength(1);
    clock.tick(2_000);
    const task = taskIn(markMicroCycleAddressed(port, "T-1", "val-1", clock));
    expect(getOpenMicroCycles(task)).toHaveLength(0);
    const cycles = (task.micro_cycles as MicroCycleRecord[] | undefined) ?? [];
    expect(cycles.every((c) => c.status === "addressed")).toBe(true);
  });

  test("recordMicroCycleCritique rejects concurrent status change during transaction", () => {
    const clock = new FakeClock(),
      { port } = leasedPort(clock);
    const orig = port.transact.bind(port);
    port.transact = (a, k, p, m) =>
      orig(a, k, p, (d) => {
        taskIn(d).status = "cancelled";
        m(d);
      });
    expect(() => recordMicroCycleCritique(port, "T-1", "val-1", "critique", { clock })).toThrow(
      /changed status to cancelled/,
    );
  });

  test("recordMicroCycleCritique rejects concurrent round advance exceeding limit during transaction", () => {
    const clock = new FakeClock(),
      { port } = leasedPort(clock);
    const orig = port.transact.bind(port);
    port.transact = (a, k, p, m) =>
      orig(a, k, p, (d) => {
        taskIn(d).micro_cycle_round = 3;
        m(d);
      });
    expect(() =>
      recordMicroCycleCritique(port, "T-1", "val-1", "critique", { maxRounds: 3, clock }),
    ).toThrow(/MAX_MICRO_CYCLES_EXCEEDED/);
  });

  test("recordMicroCycleCritique throws INVALID_STATE when original_implementer is blank string", () => {
    const clock = new FakeClock(),
      { port } = leasedPort(clock);
    port.transact("test", "b", {}, (d) => {
      const t = taskIn(d);
      t.status = "validating";
      t.lease = undefined;
      t.original_implementer = "   ";
    });
    expect(() => recordMicroCycleCritique(port, "T-1", "val-1", "critique", { clock })).toThrow(
      /blank original_implementer/,
    );
  });
});
