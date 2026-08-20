import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { workflowPort } from "../../../orchestrating-long-tasks/scripts/src/integration/store-ports.ts";
import type { TransactionPort, Clock } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { heartbeat } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/heartbeat.ts";
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

/**
 * A faithful stand-in for a real host adapter: dispatching a task means a fresh agent actually
 * claims its lease, exactly as `task:claim` requires. If `RunSupervisor` ever asked this to dispatch
 * a task that is ALREADY leased — the literal definition of double-dispatching — `claimTask` itself
 * throws `INVALID_STATE`, so the test fails on that alone without needing its own duplicate-detection
 * logic.
 */
function claimingDispatcher(
  port: TransactionPort,
  clock: Clock,
  calls: TaskDispatchInput[],
  // Distinguishes agents claimed by one "process" from another in a restart test — two independent
  // dispatchers each counting from zero would otherwise mint the identical id for the identical
  // task and mask a real double-dispatch behind a coincidental string match.
  label = "agent",
): TaskDispatcher {
  let n = 0;
  return {
    async dispatch(input) {
      calls.push(input);
      n += 1;
      const agentId = `${label}-${n}-for-${input.taskId}`;
      claimTask(port, input.taskId, agentId, "implementer", { leaseSeconds: 300, clock });
      return { status: "dispatched", agentId };
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

  test("B28.2: a grant whose heartbeat lapsed is exactly \"returned without its required summary\" — reclaimed with no explicit crash signal", async () => {
    const run = await compiledRun("heartbeat-lapse", 1);
    const port = workflowPort(run);
    const { clock, advance } = fakeTime("2026-08-19T00:00:00.000Z");
    const { token } = claimTask(port, "t-0", "agent-live-then-silent", "implementer", {
      leaseSeconds: 30,
      clock,
    });
    // A heartbeat is genuine proof of life, extending the deadline another 30s from t=20s.
    advance(20_000);
    heartbeat(port, "t-0", "agent-live-then-silent", token, clock);
    // The agent's last observable signal was that heartbeat — it never called task:submit and
    // never sent another one. That silence past the extended deadline IS "returned without its
    // required summary" (B21): the supervisor needs no separate "I crashed" signal to notice.
    advance(45_000);
    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      graceSeconds: 0,
      clock,
    });
    const result = await supervisor.run();
    expect(result.lastTick.reclaimed).toEqual([
      {
        kind: "task-lease",
        taskId: "t-0",
        agentId: "agent-live-then-silent",
        reason: "expired_lease_no_submission",
        newStatus: "retry_ready",
      },
    ]);
    expect(result.report.deadAgentsReclaimed).toBe(1);
  });

  test("B28.2/B28.4: survives its own death — a second RunSupervisor instance rebuilds from the capsule alone, reclaims what the first left stranded, redeploys it, and never double-dispatches", async () => {
    const run = await compiledRun("crash-restart", 3);
    const port = workflowPort(run);
    const { clock, sleep, advance } = fakeTime("2026-08-19T00:00:00.000Z");

    // "Process #1": a real RunSupervisor dispatches into a capacity of 2, so t-0 and t-1 get real
    // agents (via claimTask, exactly what a host adapter does) while t-2 is left untouched — its 2
    // slots are already full. A tiny elapsed budget stops it almost immediately, which is where
    // this "process" dies, mid-run, with work outstanding and never coming back.
    const instance1Calls: TaskDispatchInput[] = [];
    const instance1 = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 2,
      dispatcher: claimingDispatcher(port, clock, instance1Calls, "dead-process"),
      pollIntervalMs: 1_000,
      maxTotalElapsedMs: 1,
      clock,
      sleep,
    });
    await instance1.run();
    expect(instance1Calls.map((c) => c.taskId).sort()).toEqual(["t-0", "t-1"]);
    expect(port.read().tasks["t-0"]!.status).toBe("leased");
    expect(port.read().tasks["t-1"]!.status).toBe("leased");
    const deadAgentT0 = port.read().tasks["t-0"]!.lease!.agent_id;
    const deadAgentT1 = port.read().tasks["t-1"]!.lease!.agent_id;

    // `instance1` is discarded here, unreferenced, never ticked again — there is no "process" left.
    // Nothing survives this line but whatever is durable on disk.

    // Neither agent instance #1 dispatched ever comes back — instance #1 died with them.
    advance(600_000);

    // "Process #2": a brand new instance, constructed fresh against the same capsule, knowing
    // NOTHING instance #1 knew in memory. If it "started over" it would have no idea t-0/t-1 were
    // ever claimed; if it "double-dispatched" it would hand a leased task to a second agent while
    // the first still (nominally) held it — `claimTask` inside `claimingDispatcher` would throw and
    // fail this test outright.
    const instance2Calls: TaskDispatchInput[] = [];
    const instance2 = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      dispatcher: claimingDispatcher(port, clock, instance2Calls, "restarted-process"),
      graceSeconds: 0,
      pollIntervalMs: 1_000,
      maxTotalElapsedMs: 2_000,
      clock,
      sleep,
    });
    const result = await instance2.run();

    // Rebuilt from the event chain, not started over: instance #1's two stranded leases are found
    // and reclaimed on instance #2's very first breath, with nobody telling it what happened.
    expect(result.report.deadAgentsReclaimed).toBe(2);
    // Continues rather than starting over: the reclaimed pair is redeployed AND the work instance
    // #1 never got to (t-2) is picked up in the same run — nothing from before the crash is lost,
    // nothing is repeated twice.
    expect(instance2Calls.map((c) => c.taskId).sort()).toEqual(["t-0", "t-1", "t-2"]);
    const finalState = port.read();
    expect(finalState.tasks["t-0"]!.status).toBe("leased");
    expect(finalState.tasks["t-1"]!.status).toBe("leased");
    expect(finalState.tasks["t-2"]!.status).toBe("leased");
    // Each now belongs to a freshly-claimed instance-#2 agent, never to one of instance #1's dead
    // ones — a genuinely new attempt, not the old lease somehow still on record.
    expect(finalState.tasks["t-0"]!.lease?.agent_id).not.toBe(deadAgentT0);
    expect(finalState.tasks["t-1"]!.lease?.agent_id).not.toBe(deadAgentT1);
  });

  test("B28.3: unbounded in count — a transient failure keeps retrying well past the old repeat-3 cap, stopped only by the elapsed-time budget", async () => {
    const run = await compiledRun("unbounded-transient", 1);
    let attempts = 0;
    const dispatcher: TaskDispatcher = {
      async dispatch(): Promise<TaskDispatchResult> {
        attempts += 1;
        // Identical every time on purpose: proving that REPEATING the same rate limit never stops
        // the retries on its own is the whole point of this test.
        return { status: "failed", failure: { signal: "rate_limit", detail: "429 from provider" } };
      },
    };
    const { clock, sleep } = fakeTime("2026-08-19T00:00:00.000Z");
    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      dispatcher,
      pollIntervalMs: 2_000,
      maxTotalElapsedMs: 20_000, // >> old repeat-3 cap's worth of ticks, well short of maxElapsedMsPerTask
      maxElapsedMsPerTask: 60 * 60_000, // task-level retry budget, deliberately far above the run's own
      backoff: { initialDelayMs: 0, maxDelayMs: 0, random: () => 0 }, // no real backoff wait — this test is about count, not timing
      clock,
      sleep,
    });
    const result = await supervisor.run();
    // Retried many times past the classifier's default repeat-3 threshold, and never escalated for
    // it — only the elapsed-time budget (not exhausted here) may ever stop these four signals.
    expect(attempts).toBeGreaterThan(5);
    expect(result.report.escalated).toEqual([]);
    expect(result.report.retries).toEqual([
      { taskId: "t-0", transientRetries: attempts, deterministicStops: 0 },
    ]);
  });
});
