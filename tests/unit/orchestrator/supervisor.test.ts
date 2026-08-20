import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { workflowPort } from "../../../orchestrating-long-tasks/scripts/src/integration/store-ports.ts";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import {
  RunSupervisor,
  type TaskDispatchInput,
  type TaskDispatchResult,
  type TaskDispatcher,
} from "../../../orchestrating-long-tasks/scripts/src/orchestrator/supervisor.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A run with `count` independent, dependency-free, non-conflicting tasks, ready immediately. */
async function compiledRun(name: string, count: number): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Supervise this");

  const init = await execute(["plan:init", "--repo", repo, "--run", `${name}-run`, "--prompt-file", promptPath]);
  const run = init.run_root as string;

  for (let index = 0; index < count; index++) {
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      `t-${index}`,
      "--label",
      `Task ${index}`,
      "--scope",
      `src/task-${index}`,
      "--gate",
      `bun test src/task-${index}`,
      "--actor",
      "planner",
    ]);
  }
  await execute(["plan:compile", "--run", run, "--actor", "planner", "--completion-gate", "bun test tests"]);
  return run;
}

/** A clock/sleep pair where sleeping actually advances the fake clock, so a wall-clock budget check
 * converges deterministically without the test waiting in real time. */
function fakeTime(startIso: string) {
  let now = new Date(startIso).valueOf();
  return {
    clock: { now: () => new Date(now) },
    sleep: async (ms: number) => {
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function alwaysDispatches(calls: TaskDispatchInput[]): TaskDispatcher {
  return {
    async dispatch(input) {
      calls.push(input);
      return { status: "dispatched", agentId: `agent-for-${input.taskId}` };
    },
  };
}

describe("RunSupervisor (B28)", () => {
  test("without a dispatcher it performs exactly one tick and returns", async () => {
    const run = await compiledRun("single-tick", 1);
    const supervisor = new RunSupervisor({ runRoot: run, actor: "supervisor", maxParallel: 4 });
    const result = await supervisor.run();
    expect(result.stopReason).toBe("single_tick");
    expect(result.ticks).toBe(1);
    expect(result.lastTick.dispatchable.map((entry) => entry.task_id)).toEqual(["t-0"]);
  });

  test("B28.2: detects a dead agent without being told and reports it in the same tick", async () => {
    const run = await compiledRun("dead-agent", 1);
    const { clock, advance } = fakeTime("2026-08-19T00:00:00.000Z");
    claimTask(workflowPort(run), "t-0", "agent-dead", "implementer", { leaseSeconds: 5, clock });
    advance(60_000);
    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      graceSeconds: 0,
      clock,
    });
    const result = await supervisor.run();
    expect(result.lastTick.reclaimed).toEqual([
      { kind: "task-lease", taskId: "t-0", agentId: "agent-dead", reason: "expired_lease_no_submission", newStatus: "retry_ready" },
    ]);
    expect(result.report.deadAgentsReclaimed).toBe(1);
  });

  test("with a dispatcher it keeps dispatching ready work until the wall-clock budget runs out", async () => {
    const run = await compiledRun("continuous-dispatch", 1);
    const calls: TaskDispatchInput[] = [];
    const { clock, sleep } = fakeTime("2026-08-19T00:00:00.000Z");
    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      dispatcher: alwaysDispatches(calls),
      pollIntervalMs: 1_000,
      maxTotalElapsedMs: 3_000,
      clock,
      sleep,
    });
    const result = await supervisor.run();
    expect(result.stopReason).toBe("elapsed_budget_exhausted");
    // A dispatcher that reports "dispatched" leaves the task's own status untouched — dispatching a
    // fresh agent is not the same as that agent finishing — so the same ready task is offered again
    // on the next tick. What matters here is that the loop DID tick more than once (B24: continuous
    // dispatch, not a one-shot).
    expect(result.ticks).toBeGreaterThan(1);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((call) => call.taskId === "t-0")).toBeTrue();
  });

  test("B28.3: a transient dispatch failure backs off instead of escalating, and is retried once its clock passes", async () => {
    const run = await compiledRun("transient-retry", 1);
    let attempts = 0;
    const dispatcher: TaskDispatcher = {
      async dispatch(): Promise<TaskDispatchResult> {
        attempts += 1;
        if (attempts === 1) return { status: "failed", failure: { signal: "rate_limit", detail: "429" } };
        return { status: "dispatched", agentId: "agent-2" };
      },
    };
    const { clock, sleep } = fakeTime("2026-08-19T00:00:00.000Z");
    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      dispatcher,
      pollIntervalMs: 60_000,
      maxTotalElapsedMs: 10 * 60_000,
      backoff: { initialDelayMs: 1_000, maxDelayMs: 5_000, random: () => 0.5 },
      clock,
      sleep,
    });
    const result = await supervisor.run();
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(result.report.retries).toEqual([{ taskId: "t-0", transientRetries: 1, deterministicStops: 0 }]);
  });

  test("B28.3: a deterministic dispatch failure escalates the task and the run moves on to other eligible work", async () => {
    const run = await compiledRun("deterministic-escalate", 2);
    const dispatcher: TaskDispatcher = {
      async dispatch(input): Promise<TaskDispatchResult> {
        if (input.taskId === "t-0") {
          return { status: "failed", failure: { signal: "gate_failure", detail: "bun run typecheck exited 2" } };
        }
        return { status: "dispatched", agentId: "agent-for-t-1" };
      },
    };
    const { clock, sleep } = fakeTime("2026-08-19T00:00:00.000Z");
    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      dispatcher,
      pollIntervalMs: 1_000,
      maxTotalElapsedMs: 3_000,
      clock,
      sleep,
    });
    const result = await supervisor.run();
    const escalatedIds = result.report.escalated.map((task) => task.taskId);
    expect(escalatedIds).toEqual(["t-0"]);
    expect(result.report.escalated[0]?.reason).toBe("deterministic_failure");
    // t-1 kept being offered to the dispatcher every tick — the run never blocked on t-0's failure.
    expect(result.report.retries.find((entry) => entry.taskId === "t-1")).toBeUndefined();
  });

  test("B28.5: recovery is on by default; --no-recover's programmatic equivalent turns it off", async () => {
    const run = await compiledRun("opt-out", 1);
    const { clock, advance } = fakeTime("2026-08-19T00:00:00.000Z");
    claimTask(workflowPort(run), "t-0", "agent-dead", "implementer", { leaseSeconds: 5, clock });
    advance(60_000);
    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      recoveryEnabled: false,
      graceSeconds: 0,
      clock,
    });
    const result = await supervisor.run();
    expect(result.lastTick.reclaimed).toEqual([]);
    expect(result.report.deadAgentsReclaimed).toBe(0);
  });
});
