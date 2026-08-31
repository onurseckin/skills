import { describe, it, expect } from "bun:test";
import { MindConcurrentLookaheadPipeline } from "../../olt/scripts/src/mind/tasks/index.ts";

describe("MindConcurrentLookaheadPipeline", () => {
  it("can be instantiated", () => {
    const pipeline = new MindConcurrentLookaheadPipeline();
    expect(pipeline).toBeInstanceOf(MindConcurrentLookaheadPipeline);
  });

  it("mandates concurrent pre-planning when active runs < limit and defects exist", () => {
    const directive = MindConcurrentLookaheadPipeline.computeNextActions({
      activeRunCount: 1,
      defectCount: 3,
      concurrencyLimit: 4,
    });

    expect(directive.allowConcurrentPlanning).toBe(true);
    expect(directive.action).toBe("PRE_PLAN_NEXT_CAPSULE");
    expect(directive.message).toContain("Concurrent bandwidth available");
  });

  it("triggers mode A autonomous discovery when active runs is 0 and queue is empty", () => {
    const directive = MindConcurrentLookaheadPipeline.computeNextActions({
      activeRunCount: 0,
      defectCount: 0,
      concurrencyLimit: 4,
    });

    expect(directive.allowConcurrentPlanning).toBe(false);
    expect(directive.action).toBe("TRIGGER_MODE_A_DISCOVERY");
    expect(directive.message).toContain("Mode A Autonomous Discovery");
  });

  it("awaits convergence when concurrency limit is reached or active runs > 0 with 0 defects", () => {
    const directive = MindConcurrentLookaheadPipeline.computeNextActions({
      activeRunCount: 4,
      defectCount: 2,
      concurrencyLimit: 4,
    });

    expect(directive.allowConcurrentPlanning).toBe(false);
    expect(directive.action).toBe("AWAIT_CONVERGENCE");
    expect(directive.message).toContain("Concurrency limit reached");
  });
});
