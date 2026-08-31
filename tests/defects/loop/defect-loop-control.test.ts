import { describe, expect, test } from "bun:test";
import { ContinuousDefectFeedbackLoop } from "../../../olt/scripts/src/mind/defects/loop/index.ts";

export const defectLoopControlSuiteName = "Defect Feedback Loop Lifecycle & Flow Control";

describe(defectLoopControlSuiteName, () => {
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
