import { describe, expect, test } from "bun:test";
import type { WorkflowState } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { formatSummaryMarkdown } from "../../../orchestrating-long-tasks/scripts/src/summary/markdown-formatter.ts";
import type { RollupMetrics, TimelineEventRecord } from "../../../orchestrating-long-tasks/scripts/src/summary/types.ts";

describe("markdown formatter", () => {
  test("formats executive summary correctly", () => {
    const metrics: RollupMetrics = {
      run_id: "test-run",
      total_tasks: 2,
      satisfied_tasks: 2,
      failed_tasks: 0,
      repair_rounds_total: 0,
      wall_duration_ms: 45_000,
      active_command_duration_ms: 5_000,
      total_commands_executed: 4,
      total_gates_passed: 4,
      estimated_tokens: { tokens_in: 1000, tokens_out: 500, total_tokens: 1500 },
      files_touched: [{ path: "src/index.ts", additions: 100, deletions: 20 }],
    };

    const timeline: TimelineEventRecord[] = [
      { sequence: 1, timestamp: "2026-08-14T20:00:00.000Z", actor: "coord", event: "plan-init", phase: "planning", summary: "Init" },
      { sequence: 2, timestamp: "2026-08-14T20:00:45.000Z", actor: "coord", event: "run-completed", phase: "completion", summary: "Done" },
    ];

    const state: WorkflowState = {
      tasks: {
        "T-1": {
          id: "T-1",
          label: "First Task",
          status: "done",
          requirement_ids: [],
          write_scope: ["src/index.ts"],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
        },
      },
      requirements: [],
      gates: [],
      commands: {},
      orphan_evidence: [],
      graph_revision: 1,
    };

    const markdown = formatSummaryMarkdown({
      runId: "test-run",
      metrics,
      timeline,
      state,
    });

    expect(markdown).toContain("# Execution Run Summary: `test-run`");
    expect(markdown).toContain("45.0s");
    expect(markdown).toContain("First Task");
    expect(markdown).toContain("src/index.ts");
    expect(markdown).toContain("Executive Metrics");
    expect(markdown).toContain("Timeline Milestones");
  });
});
