import { describe, expect, test } from "bun:test";
import {
  ContinuousDefectFeedbackLoop,
  type DomainExecutionContext,
  type DomainExecutionTask,
} from "../../olt/scripts/src/mind/defects/loop/index.ts";

describe("Multi-Domain Parallel Execution & Continuous Defect Feedback Loop", () => {
  test("executes tasks across multiple domains in parallel", async () => {
    const loop = new ContinuousDefectFeedbackLoop({
      maxParallelDomains: 4,
      maxConcurrentPerDomain: 2,
    });

    const tasks: Array<DomainExecutionTask<string>> = [
      {
        id: "task-auth-01",
        domain: "authority",
        name: "Verify authority constraints",
        execute: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return "auth_ok";
        },
      },
      {
        id: "task-mind-01",
        domain: "mind",
        name: "Cognitive pulse evaluation",
        execute: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return "mind_ok";
        },
      },
      {
        id: "task-plan-01",
        domain: "planning",
        name: "DAG topology verification",
        execute: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return "plan_ok";
        },
      },
      {
        id: "task-test-01",
        domain: "testing",
        name: "Run scoped unit suite",
        execute: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return "test_ok";
        },
      },
    ];

    const results = await loop.submitBatch(tasks);

    expect(results.length).toBe(4);
    for (const res of results) {
      expect(res.status).toBe("succeeded");
      expect(res.defectsCaptured.length).toBe(0);
      expect(typeof res.result).toBe("string");
    }

    const loopMetrics = loop.getLoopMetrics();
    expect(loopMetrics.totalTasksExecuted).toBe(4);
    expect(loopMetrics.successfulTasks).toBe(4);
    expect(loopMetrics.failedTasks).toBe(0);

    const domainMetrics = loop.getDomainMetrics();
    expect(domainMetrics["authority"]?.successfulTasks).toBe(1);
    expect(domainMetrics["mind"]?.successfulTasks).toBe(1);
    expect(domainMetrics["planning"]?.successfulTasks).toBe(1);
    expect(domainMetrics["testing"]?.successfulTasks).toBe(1);
  });

  test("captures explicit defects emitted during domain execution and deduplicates them", async () => {
    const captured: Array<{ defectId: string; domain: string }> = [];
    const loop = new ContinuousDefectFeedbackLoop({
      onDefectCaptured: (defect, domain) => {
        captured.push({ defectId: defect.id, domain });
      },
    });

    const task: DomainExecutionTask<string> = {
      id: "task-boundary-01",
      domain: "validation",
      name: "Boundary inspection",
      execute: async (ctx: DomainExecutionContext) => {
        ctx.emitDefect({
          id: "defect-leak-1",
          type: "boundary_violation",
          severity: "critical",
          observation: "Unauthorized write attempt outside assigned write scope",
          remediation: "Constrain file modifications to declared write scope",
        });

        // Emit duplicate defect
        ctx.emitDefect({
          id: "defect-leak-2",
          type: "boundary_violation",
          severity: "critical",
          observation: "Unauthorized write attempt outside assigned write scope",
          remediation: "Constrain file modifications to declared write scope",
        });

        return "validated";
      },
    };

    const res = await loop.submitTask(task);
    expect(res.status).toBe("succeeded");
    expect(res.result).toBe("validated");
    expect(res.defectsCaptured.length).toBe(2);

    const dedup = loop.getDeduplicator();
    expect(dedup.size).toBe(1);
    const storedDefect = dedup.getAll()[0];
    expect(storedDefect).toBeDefined();
    expect(storedDefect?.count).toBe(2);
    expect(storedDefect?.category).toBe("boundary_violation");
    expect(captured.length).toBe(2);
  });

  test("handles task failure, automatically logs defect, and tracks retry counts", async () => {
    const loop = new ContinuousDefectFeedbackLoop();

    let attempts = 0;
    const failingTask: DomainExecutionTask<string> = {
      id: "task-flake-01",
      domain: "scheduler",
      name: "Flaky DAG scheduler operation",
      retryLimit: 2,
      execute: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(`Transient failure attempt ${attempts}`);
        }
        return "recovered";
      },
    };

    const res = await loop.submitTask(failingTask);
    expect(res.status).toBe("succeeded");
    expect(res.result).toBe("recovered");
    expect(attempts).toBe(3);
    expect(res.retryCount).toBe(2);

    // Two transient defects were recorded during the failed attempts
    const dedup = loop.getDeduplicator();
    expect(dedup.getAll().length).toBeGreaterThanOrEqual(1);
  });

  test("handles task execution timeout with cancellation signal and records timeout defect", async () => {
    const loop = new ContinuousDefectFeedbackLoop({
      defaultTimeoutMs: 50,
    });

    const hangingTask: DomainExecutionTask<void> = {
      id: "task-hang-01",
      domain: "worktree",
      name: "Long running git lock operation",
      timeoutMs: 40,
      execute: async (ctx: DomainExecutionContext) => {
        return new Promise<void>((_, reject) => {
          ctx.signal.addEventListener("abort", () => {
            reject(new Error("Operation aborted"));
          });
        });
      },
    };

    const res = await loop.submitTask(hangingTask);
    expect(res.status).toBe("timed_out");
    expect(res.defectsCaptured.length).toBeGreaterThan(0);
    expect(res.defectsCaptured[0]?.type).toBe("domain_task_timeout");

    const metrics = loop.getLoopMetrics();
    expect(metrics.timedOutTasks).toBe(1);
  });

  test("triggers continuous defect feedback cycle with hypothesis generation and auto-remediation", async () => {
    let proposedCount = 0;
    let cycleCompletedCount = 0;

    const loop = new ContinuousDefectFeedbackLoop({
      autoRemediate: true,
      onRemediationProposed: () => {
        proposedCount += 1;
      },
      onFeedbackCycleCompleted: () => {
        cycleCompletedCount += 1;
      },
    });

    // Record open defects
    loop.recordDefect(
      {
        id: "defect-type-01",
        type: "type_incompatibility",
        category: "code_defect",
        observation: "Implicit type mismatch detected in scheduler context",
        remediation: "Add strict TypeScript type annotations",
      },
      "scheduler",
    );

    loop.recordDefect(
      {
        id: "defect-reasoning-01",
        type: "hallucination_drift",
        category: "model_reasoning_error",
        observation: "Agent assumed non-existent tool command",
        remediation: "Ground agent with manifest capability parser",
      },
      "mind",
    );

    const openBefore = loop.getDeduplicator().getOpenDefects();
    expect(openBefore.length).toBe(2);

    const cycle = await loop.triggerFeedbackCycle();

    expect(cycle.openDefectsCount).toBe(2);
    expect(cycle.hypothesesGenerated.length).toBe(2);
    expect(cycle.remediationsProposed.length).toBe(2);
    expect(cycle.remediationsExecuted.length).toBe(2);
    expect(cycle.resolvedDefectIds.length).toBe(2);
    expect(proposedCount).toBe(2);
    expect(cycleCompletedCount).toBe(1);

    const openAfter = loop.getDeduplicator().getOpenDefects();
    expect(openAfter.length).toBe(0);

    const resolvedAfter = loop.getDeduplicator().getResolvedDefects();
    expect(resolvedAfter.length).toBe(2);
  });

  test("manages pause, resume, and drain lifecycle transitions cleanly", async () => {
    const loop = new ContinuousDefectFeedbackLoop({
      maxConcurrentPerDomain: 1,
    });

    expect(loop.getStatus()).toBe("idle");

    loop.pause();
    expect(loop.getStatus()).toBe("paused");

    let executed = false;
    const taskPromise = loop.submitTask({
      id: "task-paused-01",
      domain: "platform",
      name: "Deferred background check",
      execute: async () => {
        executed = true;
        return "done";
      },
    });

    // Should still be false while paused
    await new Promise((r) => setTimeout(r, 30));
    expect(executed).toBeFalse();

    loop.resume();
    const result = await taskPromise;
    expect(result.status).toBe("succeeded");
    expect(executed).toBeTrue();

    const drained = await loop.drain(1000);
    expect(drained).toBeTrue();

    loop.stop();
    expect(loop.getStatus()).toBe("stopped");

    let stoppedError = false;
    try {
      await loop.submitTask({
        id: "task-stopped-01",
        domain: "platform",
        name: "Rejected task",
        execute: async () => "fail",
      });
    } catch {
      stoppedError = true;
    }
    expect(stoppedError).toBeTrue();
  });
});
