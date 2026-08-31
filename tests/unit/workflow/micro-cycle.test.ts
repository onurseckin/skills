import { afterEach, describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  isMicroCycleRecord,
  type MicroCycleRecord,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  DEFAULT_MAX_MICRO_CYCLES,
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
import type { TaskRecord, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { cleanupRoots } from "../cli/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../cli/file-persistence-fixture.ts";
import { at, registerTaskPacket, TestPort, workflowState } from "./test-port.ts";

const clock = at("2026-08-22T12:00:00.000Z");
const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function requireTask(state: WorkflowState, taskId: string): TaskRecord {
  const task = state.tasks[taskId];
  if (!task) {
    throw new Error(`expected task ${taskId} to exist`);
  }
  return task;
}

function leasedPort(): { port: TestPort; token: string } {
  const state = workflowState();
  const port = new TestPort(state);
  registerTaskPacket(port, "implementer", "worker-1", 1, "T-1");
  const { token } = claimTask(port, "T-1", "worker-1", "implementer", { clock });
  return { port, token };
}

describe("1-Hop Micro-Cycles (recordMicroCycleCritique & markMicroCycleAddressed)", () => {
  test("recordMicroCycleCritique preserves implementer lease and sets status to leased", () => {
    const { port } = leasedPort();
    const beforeTask = requireTask(port.read(), "T-1");
    expect(beforeTask.status).toBe("leased");
    expect(beforeTask.lease).toBeDefined();
    const originalLease = structuredClone(beforeTask.lease);

    const afterState = recordMicroCycleCritique(
      port,
      "T-1",
      "val-1",
      "Edge case in parser when input has trailing whitespace",
      {
        remediation: "Add .trimEnd() before splitting lines",
        defect: "Trailing whitespace causes extra empty item",
        clock,
      },
    );

    const task = requireTask(afterState, "T-1");
    expect(task.status).toBe("leased");
    expect(task.lease).toBeDefined();
    expect(task.lease?.agent_id).toBe(originalLease?.agent_id);
    expect(task.lease?.token_digest).toBe(originalLease?.token_digest);
    expect(task.repair_round).toBe(0);

    expect(task.micro_cycle_round).toBe(1);
    expect(task.micro_cycles).toHaveLength(1);
    const cycles = task.micro_cycles as MicroCycleRecord[];
    const cycle = cycles[0];
    if (!cycle) {
      throw new Error("expected micro cycle at index 0");
    }
    expect(cycle.round).toBe(1);
    expect(cycle.validator_id).toBe("val-1");
    expect(cycle.critique).toBe("Edge case in parser when input has trailing whitespace");
    expect(cycle.suggested_remediation).toBe("Add .trimEnd() before splitting lines");
    expect(cycle.observed_defect).toBe("Trailing whitespace causes extra empty item");
    expect(cycle.status).toBe("open");
    expect(cycle.created_at).toBe("2026-08-22T12:00:00.000Z");

    expect(task.lease?.micro_cycle_round).toBe(1);
    expect(task.lease?.micro_cycles).toHaveLength(1);

    expect(port.events.at(-1)?.kind).toBe("micro-cycle-critique-recorded");
  });

  test("recordMicroCycleCritique transitions task back to leased from validating or submitted", () => {
    const { port } = leasedPort();
    port.transact("test", "status-change", {}, (draft) => {
      const task = requireTask(draft, "T-1");
      task.status = "validating";
    });
    expect(requireTask(port.read(), "T-1").status).toBe("validating");

    const afterState = recordMicroCycleCritique(
      port,
      "T-1",
      "val-1",
      "Need unit test for error branch",
      { clock },
    );

    expect(requireTask(afterState, "T-1").status).toBe("leased");
    expect(requireTask(afterState, "T-1").micro_cycle_round).toBe(1);
  });

  test("multiple micro-cycle rounds increment counter sequentially", () => {
    const { port } = leasedPort();

    recordMicroCycleCritique(port, "T-1", "val-1", "Round 1 feedback", { clock });
    let task = requireTask(port.read(), "T-1");
    expect(task.micro_cycle_round).toBe(1);
    expect(task.micro_cycles).toHaveLength(1);

    recordMicroCycleCritique(port, "T-1", "val-1", "Round 2 feedback", { clock });
    task = requireTask(port.read(), "T-1");
    expect(task.micro_cycle_round).toBe(2);
    expect(task.micro_cycles).toHaveLength(2);

    recordMicroCycleCritique(port, "T-1", "val-1", "Round 3 feedback", { clock });
    task = requireTask(port.read(), "T-1");
    expect(task.micro_cycle_round).toBe(3);
    expect(task.micro_cycles).toHaveLength(3);
  });

  test("exceeding max micro-cycle rounds throws MAX_MICRO_CYCLES_EXCEEDED error", () => {
    const { port } = leasedPort();

    // Default is 3 max rounds
    recordMicroCycleCritique(port, "T-1", "val-1", "Round 1", { clock });
    recordMicroCycleCritique(port, "T-1", "val-1", "Round 2", { clock });
    recordMicroCycleCritique(port, "T-1", "val-1", "Round 3", { clock });

    expect(() => {
      recordMicroCycleCritique(port, "T-1", "val-1", "Round 4 (exceeds default 3)", { clock });
    }).toThrow(/MAX_MICRO_CYCLES_EXCEEDED/);

    // Custom maxRounds parameter
    const { port: customPort } = leasedPort();
    recordMicroCycleCritique(customPort, "T-1", "val-1", "Round 1", { maxRounds: 1, clock });
    expect(() => {
      recordMicroCycleCritique(customPort, "T-1", "val-1", "Round 2", { maxRounds: 1, clock });
    }).toThrow(/MAX_MICRO_CYCLES_EXCEEDED/);
  });

  test("recordMicroCycleCritique validates task status and non-empty parameters", () => {
    const state = workflowState();
    const port = new TestPort(state);
    // Task is in 'ready' status (not leased/validating/submitted)
    expect(() => {
      recordMicroCycleCritique(port, "T-1", "val-1", "Some critique", { clock });
    }).toThrow(/cannot record micro-cycle critique/);

    // Unknown task
    expect(() => {
      recordMicroCycleCritique(port, "nonexistent-task", "val-1", "Some critique", { clock });
    }).toThrow(/unknown task/);

    // Empty critique
    expect(() => {
      recordMicroCycleCritique(port, "T-1", "val-1", "   ", { clock });
    }).toThrow(/critique must be non-blank text/);

    // Empty validator
    expect(() => {
      recordMicroCycleCritique(port, "T-1", "", "Critique text", { clock });
    }).toThrow(/validator_id must be non-blank text/);
  });

  test("markMicroCycleAddressed marks all open micro-cycles as addressed", () => {
    const { port } = leasedPort();
    recordMicroCycleCritique(port, "T-1", "val-1", "Issue 1", { clock });
    recordMicroCycleCritique(port, "T-1", "val-1", "Issue 2", { clock });

    let task = requireTask(port.read(), "T-1");
    expect(getOpenMicroCycles(task)).toHaveLength(2);

    const updatedState = markMicroCycleAddressed(port, "T-1", "worker-1", clock);
    task = requireTask(updatedState, "T-1");
    expect(getOpenMicroCycles(task)).toHaveLength(0);
    const cycles = task.micro_cycles as MicroCycleRecord[];
    expect(cycles.every((c) => c.status === "addressed")).toBe(true);

    if (task.lease?.micro_cycles) {
      expect(task.lease.micro_cycles.every((c) => c.status === "addressed")).toBe(true);
    }
  });

  test("getLatestMicroCycle returns the most recent micro-cycle", () => {
    const { port } = leasedPort();
    expect(getLatestMicroCycle(requireTask(port.read(), "T-1"))).toBeUndefined();

    recordMicroCycleCritique(port, "T-1", "val-1", "First issue", { clock });
    recordMicroCycleCritique(port, "T-1", "val-2", "Second issue", { clock });

    const latest = getLatestMicroCycle(requireTask(port.read(), "T-1"));
    expect(latest?.round).toBe(2);
    expect(latest?.validator_id).toBe("val-2");
    expect(latest?.critique).toBe("Second issue");
  });
});

describe("formatMicroCycleFeedback", () => {
  test("generates markdown with all structured fields and guidance", () => {
    const record: MicroCycleRecord = {
      round: 2,
      validator_id: "validator-security",
      critique: "API key is logged in cleartext in debug logs",
      suggested_remediation: "Sanitize headers before logging via sanitizeHeaders()",
      observed_defect: "Cleartext credentials in stdout",
      created_at: "2026-08-22T12:00:00.000Z",
      status: "open",
    };

    const markdown = formatMicroCycleFeedback("task-auth", record, 3);
    expect(markdown).toContain("### 🔄 Micro-Cycle Feedback (Round 2/3)");
    expect(markdown).toContain("- **Task**: `task-auth`");
    expect(markdown).toContain("- **Validator**: `validator-security`");
    expect(markdown).toContain("- **Observed Defect**: Cleartext credentials in stdout");
    expect(markdown).toContain("#### 📋 Critique & Issues Identified");
    expect(markdown).toContain("API key is logged in cleartext in debug logs");
    expect(markdown).toContain("#### 💡 Suggested Remediation");
    expect(markdown).toContain("Sanitize headers before logging via sanitizeHeaders()");
    expect(markdown).toContain("Action Required");
  });

  test("generates markdown cleanly when optional fields are omitted", () => {
    const record: MicroCycleRecord = {
      round: 1,
      validator_id: "val-code",
      critique: "Function exceeds complexity budget",
      created_at: "2026-08-22T12:00:00.000Z",
      status: "open",
    };

    const markdown = formatMicroCycleFeedback("task-simple", record);
    expect(markdown).toContain("### 🔄 Micro-Cycle Feedback (Round 1/3)");
    expect(markdown).toContain("Function exceeds complexity budget");
    expect(markdown).not.toContain("Observed Defect");
    expect(markdown).not.toContain("Suggested Remediation");
  });
});

describe("isMicroCycleRecord type guard", () => {
  test("validates valid micro-cycle records", () => {
    const valid: MicroCycleRecord = {
      round: 1,
      validator_id: "val-1",
      critique: "Looks slightly off",
      suggested_remediation: "Fix the alignment",
      created_at: "2026-08-22T12:00:00.000Z",
      status: "open",
    };
    expect(isMicroCycleRecord(valid)).toBe(true);

    const validAddressed: MicroCycleRecord = {
      round: 2,
      validator_id: "val-2",
      critique: "Needs more tests",
      created_at: "2026-08-22T12:00:00.000Z",
      status: "addressed",
    };
    expect(isMicroCycleRecord(validAddressed)).toBe(true);
  });

  test("rejects invalid structures", () => {
    expect(isMicroCycleRecord(null)).toBe(false);
    expect(isMicroCycleRecord(undefined)).toBe(false);
    expect(isMicroCycleRecord("string")).toBe(false);
    expect(isMicroCycleRecord({})).toBe(false);
    expect(
      isMicroCycleRecord({
        round: 0,
        validator_id: "v",
        critique: "c",
        status: "open",
        created_at: "t",
      }),
    ).toBe(false);
    expect(
      isMicroCycleRecord({
        round: 1,
        validator_id: "",
        critique: "c",
        status: "open",
        created_at: "t",
      }),
    ).toBe(false);
    expect(
      isMicroCycleRecord({
        round: 1,
        validator_id: "v",
        critique: "",
        status: "open",
        created_at: "t",
      }),
    ).toBe(false);
    expect(
      isMicroCycleRecord({
        round: 1,
        validator_id: "v",
        critique: "c",
        status: "closed",
        created_at: "t",
      }),
    ).toBe(false);
  });
});

describe("CLI commands integration: task:reject and task:review with micro-cycles", () => {
  test("taskRejectCommand with --micro-cycle records critique and keeps implementer lease active", async () => {
    const { repo, run } = await setupCompiledRun("micro-cycle-reject-test", roots);

    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
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
      "worker-1",
      "--role",
      "implementer",
    ]);
    expect(claim.token).toBeDefined();

    // Validator sends micro-cycle feedback while implementer is working
    const rejectResult = await taskRejectCommand({
      run,
      task: "task-core",
      validator: "val-inline",
      reason: "Missing edge-case check for empty input array",
      remediation: "Add if (arr.length === 0) return null;",
      "micro-cycle": true,
    });

    expect(rejectResult.micro_cycle).toBe(true);
    expect(rejectResult.round).toBe(1);
    expect(rejectResult.markdown).toContain("### 🔄 Micro-Cycle Feedback (Round 1/3)");
    expect(rejectResult.markdown).toContain("Missing edge-case check for empty input array");

    const task = rejectResult.task as {
      status: string;
      lease?: { agent_id: string; token_digest: string };
      micro_cycles?: MicroCycleRecord[];
    };
    expect(task.status).toBe("leased");
    expect(task.lease?.agent_id).toBe("worker-1");
    expect(task.micro_cycles).toHaveLength(1);
    expect(task.micro_cycles?.[0]?.status).toBe("open");

    // Second micro-cycle feedback using --in-lease alias
    const secondResult = await taskRejectCommand({
      run,
      task: "task-core",
      validator: "val-inline",
      reason: "Ensure return type matches undefined or null consistently",
      "in-lease": true,
    });

    expect(secondResult.micro_cycle).toBe(true);
    expect(secondResult.round).toBe(2);
    const task2 = secondResult.task as {
      micro_cycles?: MicroCycleRecord[];
      status: string;
      lease?: { agent_id: string };
    };
    expect(task2.status).toBe("leased");
    expect(task2.lease?.agent_id).toBe("worker-1");
    expect(task2.micro_cycles).toHaveLength(2);
  });

  test("taskReviewCommand with --micro-cycle and --status fail records in-lease critique", async () => {
    const { repo, run } = await setupCompiledRun("micro-cycle-review-fail-test", roots);

    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
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
      "worker-1",
      "--role",
      "implementer",
    ]);

    const reviewResult = await taskReviewCommand({
      run,
      task: "task-core",
      validator: "val-1",
      token: "dummy-token",
      status: "fail",
      summary: "Found formatting inconsistencies in generated tests",
      remediation: "Run prettier before submitting",
      severity: "minor",
      "micro-cycle": true,
    });

    expect(reviewResult.micro_cycle).toBe(true);
    expect(reviewResult.round).toBe(1);
    expect(reviewResult.markdown).toContain("### 🔄 Micro-Cycle Feedback (Round 1/3)");
    const task = reviewResult.task as { status: string; micro_cycles?: MicroCycleRecord[] };
    expect(task.status).toBe("leased");
    expect(task.micro_cycles).toHaveLength(1);
  });

  test("markMicroCycleAddressed integrates with review workflow to clear open micro-cycles", () => {
    const { port } = leasedPort();
    recordMicroCycleCritique(port, "T-1", "val-1", "Minor syntax improvement needed", { clock });
    expect(getOpenMicroCycles(requireTask(port.read(), "T-1"))).toHaveLength(1);

    const updatedState = markMicroCycleAddressed(port, "T-1", "val-1", clock);
    const task = requireTask(updatedState, "T-1");
    expect(task.micro_cycles).toBeDefined();
    expect(getOpenMicroCycles(task)).toHaveLength(0);
    const rawCycles = task.micro_cycles as MicroCycleRecord[] | undefined;
    const cycles = rawCycles === undefined ? [] : rawCycles;
    expect(cycles.length > 0).toBe(true);
    expect(cycles.every((c: MicroCycleRecord) => c.status === "addressed")).toBe(true);
  });

  test("recordMicroCycleCritique rejects concurrent status change during transaction", () => {
    const { port } = leasedPort();
    const originalTransact = port.transact.bind(port);
    port.transact = (actor, kind, payload, mutate) => {
      return originalTransact(actor, kind, payload, (draft) => {
        const task = requireTask(draft, "T-1");
        task.status = "cancelled";
        mutate(draft);
      });
    };

    expect(() => recordMicroCycleCritique(port, "T-1", "val-1", "critique", { clock })).toThrow(
      /changed status to cancelled during transaction/,
    );
  });

  test("recordMicroCycleCritique rejects concurrent round advance exceeding limit during transaction", () => {
    const { port } = leasedPort();
    const originalTransact = port.transact.bind(port);
    port.transact = (actor, kind, payload, mutate) => {
      return originalTransact(actor, kind, payload, (draft) => {
        const task = requireTask(draft, "T-1");
        task.micro_cycle_round = 3;
        mutate(draft);
      });
    };

    expect(() =>
      recordMicroCycleCritique(port, "T-1", "val-1", "critique", { maxRounds: 3, clock }),
    ).toThrow(/MAX_MICRO_CYCLES_EXCEEDED/);
  });

  test("recordMicroCycleCritique throws INVALID_STATE when original_implementer is blank string", () => {
    const { port } = leasedPort();
    port.transact("test", "set-blank-impl", {}, (draft) => {
      const task = requireTask(draft, "T-1");
      task.status = "validating";
      task.lease = undefined;
      task.original_implementer = "   ";
    });

    expect(() => recordMicroCycleCritique(port, "T-1", "val-1", "critique", { clock })).toThrow(
      /has a blank original_implementer/,
    );
  });

  test("formatMicroCycleFeedback includes repair lease token when provided", () => {
    const record: MicroCycleRecord = {
      round: 1,
      validator_id: "val-1",
      critique: "Needs fix",
      status: "open",
      created_at: "2026-08-22T12:00:00.000Z",
    };

    const formatted = formatMicroCycleFeedback("T-1", record, 3, "tok_repair_123");
    expect(formatted).toContain("#### 🔑 Repair Lease Token");
    expect(formatted).toContain("`tok_repair_123`");
  });
});
