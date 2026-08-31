import { afterEach, describe, expect, test } from "bun:test";
import {
  isMicroCycleRecord,
  type MicroCycleRecord,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  formatMicroCycleFeedback,
  getLatestMicroCycle,
  getOpenMicroCycles,
  markMicroCycleAddressed,
  recordMicroCycleCritique,
} from "../../../olt/scripts/src/workflow/review/micro-cycle.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { taskRejectCommand } from "../../../olt/scripts/src/cli/commands/task-reject.ts";
import { taskReviewCommand } from "../../../olt/scripts/src/cli/commands/task-review.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import type { Clock, TaskRecord, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { cleanupRoots } from "../cli/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../cli/file-persistence-fixture.ts";
import { registerTaskPacket, TestPort, workflowState } from "./test-port.ts";

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

describe("1-Hop Micro-Cycles (recordMicroCycleCritique & markMicroCycleAddressed)", () => {
  test("recordMicroCycleCritique preserves implementer lease and sets status to leased", () => {
    const clock = new FakeClock(),
      { port } = leasedPort(clock);
    const before = taskIn(port.read()),
      original = structuredClone(before.lease);
    clock.tick(5_000);
    const after = recordMicroCycleCritique(port, "T-1", "val-1", "Edge case in parser", {
      remediation: "Add .trimEnd()",
      defect: "Trailing whitespace",
      clock,
    });
    const task = taskIn(after),
      cycle = (task.micro_cycles as MicroCycleRecord[])[0]!;
    expect(task.status).toBe("leased");
    expect(task.lease?.agent_id).toBe(original?.agent_id);
    expect(task.lease?.token_digest).toBe(original?.token_digest);
    expect(task.repair_round).toBe(0);
    expect(task.micro_cycle_round).toBe(1);
    expect(cycle.round).toBe(1);
    expect(cycle.validator_id).toBe("val-1");
    expect(cycle.critique).toBe("Edge case in parser");
    expect(cycle.suggested_remediation).toBe("Add .trimEnd()");
    expect(cycle.observed_defect).toBe("Trailing whitespace");
    expect(cycle.status).toBe("open");
    expect(cycle.created_at).toBe(clock.iso());
    expect(port.events.at(-1)?.kind).toBe("micro-cycle-critique-recorded");
  });

  test("recordMicroCycleCritique transitions task back to leased from validating or submitted", () => {
    const clock = new FakeClock(),
      { port } = leasedPort(clock);
    port.transact("test", "s", {}, (d) => {
      taskIn(d).status = "validating";
    });
    clock.tick(2_000);
    const after = recordMicroCycleCritique(port, "T-1", "val-1", "Need test", { clock });
    expect(taskIn(after).status).toBe("leased");
    expect(taskIn(after).micro_cycle_round).toBe(1);
  });

  test("multiple micro-cycle rounds increment counter sequentially", () => {
    const clock = new FakeClock(),
      { port } = leasedPort(clock);
    [1, 2, 3].forEach((r) => {
      clock.tick(1_000);
      recordMicroCycleCritique(port, "T-1", "val-1", `Round ${r}`, { clock });
      expect(taskIn(port.read()).micro_cycle_round).toBe(r);
    });
    expect(taskIn(port.read()).micro_cycles).toHaveLength(3);
  });

  test("exceeding max micro-cycle rounds throws MAX_MICRO_CYCLES_EXCEEDED error", () => {
    const clock = new FakeClock(),
      { port } = leasedPort(clock);
    for (let i = 1; i <= 3; i++) recordMicroCycleCritique(port, "T-1", "val-1", `R${i}`, { clock });
    expect(() => recordMicroCycleCritique(port, "T-1", "val-1", "R4", { clock })).toThrow(
      /MAX_MICRO_CYCLES_EXCEEDED/,
    );
    const { port: p2 } = leasedPort(clock);
    recordMicroCycleCritique(p2, "T-1", "val-1", "R1", { maxRounds: 1, clock });
    expect(() =>
      recordMicroCycleCritique(p2, "T-1", "val-1", "R2", { maxRounds: 1, clock }),
    ).toThrow(/MAX_MICRO_CYCLES_EXCEEDED/);
  });

  test("recordMicroCycleCritique validates task status and non-empty parameters", () => {
    const clock = new FakeClock(),
      port = new TestPort(workflowState());
    expect(() => recordMicroCycleCritique(port, "T-1", "val-1", "critique", { clock })).toThrow(
      /cannot record/,
    );
    expect(() => recordMicroCycleCritique(port, "none", "val-1", "critique", { clock })).toThrow(
      /unknown task/,
    );
    expect(() => recordMicroCycleCritique(port, "T-1", "val-1", "   ", { clock })).toThrow(
      /non-blank text/,
    );
    expect(() => recordMicroCycleCritique(port, "T-1", "", "critique", { clock })).toThrow(
      /non-blank text/,
    );
  });

  test("markMicroCycleAddressed marks all open micro-cycles as addressed", () => {
    const clock = new FakeClock(),
      { port } = leasedPort(clock);
    recordMicroCycleCritique(port, "T-1", "val-1", "Issue 1", { clock });
    recordMicroCycleCritique(port, "T-1", "val-1", "Issue 2", { clock });
    expect(getOpenMicroCycles(taskIn(port.read()))).toHaveLength(2);
    clock.tick(3_000);
    const task = taskIn(markMicroCycleAddressed(port, "T-1", "worker-1", clock));
    expect(getOpenMicroCycles(task)).toHaveLength(0);
    expect((task.micro_cycles as MicroCycleRecord[]).every((c) => c.status === "addressed")).toBe(
      true,
    );
  });

  test("getLatestMicroCycle returns the most recent micro-cycle", () => {
    const clock = new FakeClock(),
      { port } = leasedPort(clock);
    expect(getLatestMicroCycle(taskIn(port.read()))).toBeUndefined();
    recordMicroCycleCritique(port, "T-1", "val-1", "First", { clock });
    clock.tick(1_000);
    recordMicroCycleCritique(port, "T-1", "val-2", "Second", { clock });
    const latest = getLatestMicroCycle(taskIn(port.read()));
    expect(latest?.round).toBe(2);
    expect(latest?.validator_id).toBe("val-2");
    expect(latest?.critique).toBe("Second");
  });
});

describe("formatMicroCycleFeedback", () => {
  test("generates markdown with all structured fields and guidance", () => {
    const rec: MicroCycleRecord = {
      round: 2,
      validator_id: "val-sec",
      critique: "API key logged",
      suggested_remediation: "Sanitize headers",
      observed_defect: "Cleartext credentials",
      created_at: "2026-08-22T12:00:00.000Z",
      status: "open",
    };
    const md = formatMicroCycleFeedback("task-auth", rec, 3);
    expect(md).toContain("### 🔄 Micro-Cycle Feedback (Round 2/3)");
    expect(md).toContain("- **Task**: `task-auth`");
    expect(md).toContain("- **Validator**: `val-sec`");
    expect(md).toContain("- **Observed Defect**: Cleartext credentials");
    expect(md).toContain("API key logged");
    expect(md).toContain("Sanitize headers");
    expect(md).toContain("Action Required");
  });

  test("generates markdown cleanly when optional fields are omitted", () => {
    const rec: MicroCycleRecord = {
      round: 1,
      validator_id: "val-code",
      critique: "Exceeds budget",
      created_at: "2026-08-22T12:00:00.000Z",
      status: "open",
    };
    const md = formatMicroCycleFeedback("task-simple", rec);
    expect(md).toContain("### 🔄 Micro-Cycle Feedback (Round 1/3)");
    expect(md).toContain("Exceeds budget");
    expect(md).not.toContain("Observed Defect");
  });

  test("formatMicroCycleFeedback includes repair lease token when provided", () => {
    const rec: MicroCycleRecord = {
      round: 1,
      validator_id: "val-1",
      critique: "Needs fix",
      status: "open",
      created_at: "2026-08-22T12:00:00.000Z",
    };
    const formatted = formatMicroCycleFeedback("T-1", rec, 3, "tok_repair_123");
    expect(formatted).toContain("#### 🔑 Repair Lease Token");
    expect(formatted).toContain("`tok_repair_123`");
  });
});

describe("isMicroCycleRecord type guard", () => {
  test("validates valid micro-cycle records", () => {
    const valid: MicroCycleRecord = {
      round: 1,
      validator_id: "val-1",
      critique: "off",
      suggested_remediation: "align",
      created_at: "2026-08-22T12:00:00.000Z",
      status: "open",
    };
    expect(isMicroCycleRecord(valid)).toBe(true);
    expect(isMicroCycleRecord({ ...valid, round: 2, status: "addressed" })).toBe(true);
  });

  test("rejects invalid structures", () => {
    const invalidList = [
      null,
      undefined,
      "string",
      {},
      { round: 0, validator_id: "v", critique: "c", status: "open", created_at: "t" },
      { round: 1, validator_id: "", critique: "c", status: "open", created_at: "t" },
      { round: 1, validator_id: "v", critique: "", status: "open", created_at: "t" },
      { round: 1, validator_id: "v", critique: "c", status: "closed", created_at: "t" },
    ];
    invalidList.forEach((invalid) => expect(isMicroCycleRecord(invalid)).toBe(false));
  });
});

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
