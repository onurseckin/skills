import { describe, it, expect } from "bun:test";
import {
  ContinuousDefectFeedbackLoop,
  type DomainExecutionTask,
} from "../../../olt/scripts/src/mind/defects/loop/index.ts";
import type { DefectResolutionProof } from "../../../olt/scripts/src/mind/defects/core/index.ts";

describe("mind/defects/defect-loop", () => {
  it("initializes with idle status and provides deduplicator and metrics", () => {
    const loop = new ContinuousDefectFeedbackLoop();
    expect(loop.getStatus()).toBe("idle");
    expect(loop.getDeduplicator()).toBeDefined();

    const metrics = loop.getLoopMetrics();
    expect(metrics.loopStatus).toBe("idle");
    expect(metrics.totalTasksExecuted).toBe(0);
    expect(metrics.activeDomains).toEqual([]);
  });

  it("records defects into domain stats with hooks", () => {
    let captured = false;
    const loop = new ContinuousDefectFeedbackLoop({
      onDefectCaptured: (_def, domain, taskId) => {
        captured = true;
        expect(domain).toBe("test-domain");
        expect(taskId).toBe("task-01");
      },
    });

    const recorded = loop.recordDefect(
      {
        type: "syntax_error",
        observation: "Missing semicolon",
      },
      "test-domain",
      "task-01",
    );

    expect(recorded.type).toBe("syntax_error");
    expect(captured).toBe(true);

    const domainMetrics = loop.getDomainMetrics();
    expect(domainMetrics["test-domain"]?.defectsCount).toBe(1);
  });

  it("executes successful task and updates metrics", async () => {
    let completedHookCalled = false;
    const loop = new ContinuousDefectFeedbackLoop({
      onTaskCompleted: (result) => {
        completedHookCalled = true;
        expect(result.status).toBe("succeeded");
      },
    });

    const task: DomainExecutionTask<string> = {
      id: "task-1",
      domain: "core",
      name: "test task",
      execute: async (ctx) => {
        ctx.log("running task");
        ctx.emitDefect({
          type: "warning_notice",
          observation: "minor issue",
        });
        return "success-result";
      },
    };

    const res = await loop.submitTask(task);
    expect(res.status).toBe("succeeded");
    expect(res.result).toBe("success-result");
    expect(res.defectsCaptured.length).toBe(1);
    expect(completedHookCalled).toBe(true);

    const loopMetrics = loop.getLoopMetrics();
    expect(loopMetrics.successfulTasks).toBe(1);
    expect(loopMetrics.totalTasksExecuted).toBe(1);
  });

  it("handles task execution failures and retries", async () => {
    const loop = new ContinuousDefectFeedbackLoop();
    let attempts = 0;

    const failingTask: DomainExecutionTask<void> = {
      id: "failing-task",
      domain: "worker",
      name: "failing step",
      retryLimit: 2,
      execute: async () => {
        attempts += 1;
        throw new Error("Intentional failure");
      },
    };

    const res = await loop.submitTask(failingTask);
    expect(res.status).toBe("failed");
    expect(attempts).toBe(3); // Initial attempt + 2 retries
    expect(res.retryCount).toBe(2);
    expect(res.defectsCaptured.length).toBe(3);

    const loopMetrics = loop.getLoopMetrics();
    expect(loopMetrics.failedTasks).toBe(1);
  });

  it("handles task timeouts", async () => {
    const loop = new ContinuousDefectFeedbackLoop();

    const slowTask: DomainExecutionTask<void> = {
      id: "slow-task",
      domain: "slow",
      name: "slow step",
      timeoutMs: 50,
      execute: async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (ctx.signal.aborted) {
          throw new Error("Aborted");
        }
      },
    };

    const res = await loop.submitTask(slowTask);
    expect(res.status).toBe("timed_out");

    const loopMetrics = loop.getLoopMetrics();
    expect(loopMetrics.timedOutTasks).toBe(1);
  });

  it("queues tasks when domain concurrency is reached and pumps on completion", async () => {
    const loop = new ContinuousDefectFeedbackLoop({
      maxConcurrentPerDomain: 1,
    });

    let task1Running = true;
    const task1: DomainExecutionTask<string> = {
      id: "t1",
      domain: "serial",
      name: "first",
      execute: async () => {
        while (task1Running) {
          await new Promise((r) => setTimeout(r, 20));
        }
        return "t1-done";
      },
    };

    const task2: DomainExecutionTask<string> = {
      id: "t2",
      domain: "serial",
      name: "second",
      execute: async () => "t2-done",
    };

    const p1 = loop.submitTask(task1);
    const p2 = loop.submitTask(task2);

    await new Promise((r) => setTimeout(r, 40));
    task1Running = false;

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.result).toBe("t1-done");
    expect(res2.result).toBe("t2-done");
  });

  it("submits batches of tasks", async () => {
    const loop = new ContinuousDefectFeedbackLoop();
    const tasks: DomainExecutionTask<number>[] = [
      { id: "b1", domain: "d1", name: "n1", execute: async () => 1 },
      { id: "b2", domain: "d2", name: "n2", execute: async () => 2 },
    ];

    const results = await loop.submitBatch(tasks);
    expect(results.length).toBe(2);
    expect(results[0]?.result).toBe(1);
    expect(results[1]?.result).toBe(2);
  });

  it("triggers feedback cycles with remediation and autoRemediate", async () => {
    let proposed = 0;
    let completedCycle = false;

    const loop = new ContinuousDefectFeedbackLoop({
      autoRemediate: true,
      onRemediationProposed: () => {
        proposed += 1;
      },
      onFeedbackCycleCompleted: () => {
        completedCycle = true;
      },
    });

    loop.recordDefect({
      id: "def-bv",
      category: "boundary_violation",
      type: "scope_breach",
      observation: "Breached workspace boundary",
    });

    loop.recordDefect({
      id: "def-mre",
      category: "model_reasoning_error",
      type: "hallucination",
      observation: "Non-existent tool referenced",
    });

    loop.recordDefect({
      id: "def-cd",
      category: "code_defect",
      type: "syntax",
      observation: "Parse error",
    });

    const cycle = await loop.triggerFeedbackCycle();
    expect(cycle.openDefectsCount).toBe(3);
    expect(cycle.hypothesesGenerated.length).toBe(3);
    expect(cycle.remediationsProposed.length).toBe(3);
    expect(cycle.remediationsExecuted.length).toBe(3);
    expect(cycle.resolvedDefectIds.length).toBe(3);
    expect(proposed).toBe(3);
    expect(completedCycle).toBe(true);
  });

  it("supports manual defect resolution", () => {
    const loop = new ContinuousDefectFeedbackLoop();
    loop.recordDefect({ id: "d-manual", type: "manual_defect", observation: "manual" });

    const proof: DefectResolutionProof = {
      task_id: "t1",
      test_assertion: "passes",
      resolved_at: new Date().toISOString(),
      remediation_notes: "manually fixed",
      verified_by: "dev",
    };

    const resolved = loop.resolveDefect("d-manual", proof);
    expect(resolved).toBe(true);

    const nonExistent = loop.resolveDefect("missing", proof);
    expect(nonExistent).toBe(false);
  });

  it("handles pause, resume, drain, and stop lifecycle", async () => {
    const loop = new ContinuousDefectFeedbackLoop({
      maxConcurrentPerDomain: 1,
    });

    loop.pause();
    expect(loop.getStatus()).toBe("paused");

    const task: DomainExecutionTask<string> = {
      id: "paused-task",
      domain: "paused-domain",
      name: "name",
      execute: async () => "done",
    };

    const promise = loop.submitTask(task);
    loop.resume();
    const res = await promise;
    expect(res.result).toBe("done");

    await loop.drain(1000);
    expect(loop.getStatus()).toBe("idle");

    loop.stop();
    expect(loop.getStatus()).toBe("stopped");

    expect(loop.submitTask(task)).rejects.toThrow("stopped");
  });
});
