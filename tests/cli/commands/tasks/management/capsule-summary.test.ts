import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  capsuleSummaryCommand,
  formatCapsuleSummaryMarkdown,
  projectCapsuleSummary,
} from "../../../../../olt/scripts/src/cli/commands/task-check.ts";
import { type VirtualMemoryFS } from "../../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
let vfs: VirtualMemoryFS;

function createVirtualDir(prefix: string): string {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  vfs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createMockCapsule(prefix: string, stateData: Record<string, unknown>): string {
  const runDir = createVirtualDir(prefix);
  vfs.writeFileSync(join(runDir, "state.json"), JSON.stringify(stateData, null, 2));
  vfs.writeFileSync(
    join(runDir, "manifest.json"),
    JSON.stringify(
      {
        schema: "capsule-manifest-v1",
        version: 1,
        run_id: typeof stateData.run_id === "string" ? stateData.run_id : "test-run",
        capsule_id: "cap123",
      },
      null,
      2,
    ),
  );
  vfs.writeFileSync(join(runDir, "prompt.md"), "test prompt");
  return runDir;
}

describe("capsule:summary - Wave-level Summary Projections", () => {
  beforeEach(() => {
    vfs = setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("projectCapsuleSummary and capsuleSummaryCommand project wave-level summary without raw events", async () => {
    const stateData = {
      run_id: "capsule-summary-run",
      tasks: {
        "task-w1-a": {
          id: "task-w1-a",
          label: "Wave 1 Task A",
          status: "COMPLETED",
          dependencies: [],
          write_scope: ["src/a.ts"],
        },
        "task-w1-b": {
          id: "task-w1-b",
          label: "Wave 1 Task B",
          status: "FAILED",
          dependencies: [],
          write_scope: ["src/b.ts"],
        },
        "task-w2": {
          id: "task-w2",
          label: "Wave 2 Task",
          status: "READY",
          dependencies: ["task-w1-a"],
          write_scope: ["src/c.ts", "src/d.ts"],
        },
      },
      topology: {
        waves: [
          { wave: 1, task_ids: ["task-w1-a", "task-w1-b"] },
          { wave: 2, task_ids: ["task-w2"] },
        ],
      },
    };

    const runDir = createMockCapsule("capsule-summary", stateData);

    const summary = projectCapsuleSummary(runDir);
    expect(summary.runId).toBe("capsule-summary-run");
    expect(summary.totalTasks).toBe(3);
    expect(summary.statusCounts.COMPLETED).toBe(1);
    expect(summary.statusCounts.FAILED).toBe(1);
    expect(summary.statusCounts.READY).toBe(1);
    expect(summary.waves.length).toBe(2);
    expect(summary.waves[0]?.wave).toBe(1);
    expect(summary.waves[0]?.tasks.length).toBe(2);
    expect(summary.waves[1]?.wave).toBe(2);
    expect(summary.waves[1]?.tasks.length).toBe(1);

    const markdown = formatCapsuleSummaryMarkdown(summary);
    expect(markdown).toContain("Capsule Wave Summary");
    expect(markdown).toContain("capsule-summary-run");
    expect(markdown).toContain("Wave 1 (2 tasks)");
    expect(markdown).toContain("Wave 2 (1 tasks)");
    expect(markdown).toContain("task-w1-a");
    expect(markdown).toContain("task-w2");

    // Command execution in markdown format
    const cmdResult = await capsuleSummaryCommand({
      run: runDir,
    });
    expect(cmdResult.format).toBe("markdown");
    expect(cmdResult.total_tasks).toBe(3);
    expect(typeof cmdResult.markdown).toBe("string");

    // Command execution in json format
    const jsonResult = await capsuleSummaryCommand({
      run: runDir,
      format: "json",
    });
    expect(jsonResult.format).toBe("json");
    expect(jsonResult.total_tasks).toBe(3);
    expect(Array.isArray(jsonResult.waves)).toBe(true);
  });

  test("projectCapsuleSummary falls back gracefully when topology waves are absent", () => {
    const stateData = {
      run_id: "fallback-waves-run",
      tasks: {
        "root-task": {
          id: "root-task",
          label: "Root Task",
          status: "COMPLETED",
          dependencies: [],
          write_scope: ["src/root.ts"],
        },
        "child-task": {
          id: "child-task",
          label: "Child Task",
          status: "PENDING",
          dependencies: ["root-task"],
          write_scope: ["src/child.ts"],
        },
      },
    };

    const runDir = createMockCapsule("capsule-fallback-waves", stateData);

    const summary = projectCapsuleSummary(runDir);
    expect(summary.totalTasks).toBe(2);
    expect(summary.waves.length).toBe(2);
    expect(summary.waves[0]?.tasks[0]?.taskId).toBe("root-task");
    expect(summary.waves[1]?.tasks[0]?.taskId).toBe("child-task");
  });

  test("projectCapsuleSummary throws error on invalid run path", () => {
    expect(() => projectCapsuleSummary("/non/existent/path")).toThrow();
  });
});
