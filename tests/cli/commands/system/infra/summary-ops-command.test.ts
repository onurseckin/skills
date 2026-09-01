import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  summaryExportCommand,
  summaryViewCommand,
} from "../../../../../olt/scripts/src/cli/commands/summary-ops.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { TASK_ID, setupRun } from "../../fixtures/probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("summary:export", () => {
  test("writes the suite to <run>/summary and reports the artifact paths in its brief", async () => {
    const { run } = await setupRun("summary-export", roots);

    const result = summaryExportCommand({ run });

    expect(result.run_root).toBe(run);
    expect(result.summary_dir).toBe(join(run, "summary"));
    expect(result.out_dir).toBeUndefined();
    expect(existsSync(join(run, "summary", "graph.json"))).toBe(true);
    expect(existsSync(join(run, "summary", "timeline.json"))).toBe(true);
    expect(existsSync(join(run, "summary", "metrics.json"))).toBe(true);
    expect(existsSync(join(run, "summary", "summary.md"))).toBe(true);

    const markdown = String(result.markdown);
    expect(markdown).toContain(`Summary Suite Exported: \`${run.split("/").pop()}\``);
    expect(markdown).toContain(`\`${join(run, "summary")}\``);
    expect(markdown).not.toContain("GVUI Registry Export");

    const suite = result.suite as { graph: { nodes: unknown[] }; metrics: { total_tasks: number } };
    expect(suite.metrics.total_tasks).toBeGreaterThanOrEqual(1);
  });

  test("also exports a GVUI registry entry under --out, named for the run id", async () => {
    const { run } = await setupRun("summary-export-out", roots);
    const out = join(run, "gvui-out");

    const result = summaryExportCommand({ run, out });

    const runId = run.split("/").pop()!;
    expect(result.out_dir).toBe(out);
    expect(existsSync(join(out, `${runId}.json`))).toBe(true);
    expect(String(result.markdown)).toContain(`GVUI Registry Export`);
    expect(String(result.markdown)).toContain(`\`${join(out, `${runId}.json`)}\``);
  });
});

describe("summary:view", () => {
  test("renders the same brief in memory without touching disk", async () => {
    const { run } = await setupRun("summary-view", roots);

    const result = summaryViewCommand({ run });

    expect(result.run_root).toBe(run);
    expect(existsSync(join(run, "summary"))).toBe(false);
    expect(String(result.markdown).length).toBeGreaterThan(0);
    const metrics = result.metrics as { total_tasks: number };
    expect(metrics.total_tasks).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.timeline)).toBe(true);
  });

  test("reflects a claimed task's write scope in the timeline once one exists", async () => {
    const { run } = await setupRun("summary-view-after-claim", roots);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);

    const result = summaryViewCommand({ run });
    const timeline = result.timeline as unknown[];
    expect(timeline.length).toBeGreaterThan(0);
  });
});
