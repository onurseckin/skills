import { describe, expect, test } from "bun:test";
import type { CommandRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import type { TaskRecord, WorkflowState } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";

describe("graph generator", () => {
  test("generates full GVUI compliant GraphDataset", () => {
    const task1: TaskRecord = {
      id: "T-1",
      label: "Task One",
      status: "done",
      requirement_ids: ["R-1"],
      write_scope: ["src/a.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 1,
      report: { summary: "Implemented A", files_changed: ["src/a.ts"] },
      findings: [
        {
          id: "F-1",
          requirement_id: "R-1",
          severity: "important",
          observation: "Issue found",
          remediation: "Fixed",
          revalidation: "Check test",
          status: "resolved",
        },
      ],
    };

    const task2: TaskRecord = {
      id: "T-2",
      label: "Task Two",
      status: "running",
      requirement_ids: ["R-2"],
      write_scope: ["src/b.ts"],
      dependencies: ["T-1"],
      attempts: [],
      history: [],
      repair_round: 0,
    };

    const state: WorkflowState = {
      tasks: { "T-1": task1, "T-2": task2 },
      requirements: [],
      gates: [],
      commands: {},
      orphan_evidence: [],
      graph_revision: 1,
      completion_result: {
        status: "complete",
        actor: "coord",
        completed_at: "2026-08-14T20:00:00.000Z",
        graph_revision: 1,
        readiness_sha256: "r1",
        repository_binding: {
          schema: "harness.repository-binding",
          version: 1,
          inspection_sha256: "i1",
          git_identity_sha256: "g1",
          content_sha256: "c1",
          file_count: 1,
          total_bytes: 10,
        },
        critic_review_sha256: "cr1",
        artifact_verification_sha256: "av1",
        mandatory_run_gate_commands: [],
      },
    };

    const cmd1: CommandRecord = {
      id: "C-1",
      argv: ["bun", "test"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      status: "succeeded",
      task_id: "T-1",
      started_at: "2026-08-14T20:00:00.000Z",
      finished_at: "2026-08-14T20:00:01.000Z",
      exit_code: 0,
      signal: null,
      fingerprint: "fp1",
      attempt_signing_public_key: "pk1",
      record_path: "commands/C-1/record.json",
      actor: "val",
    };

    const dataset = generateGraphDataset({
      runId: "test-run",
      state,
      promptText: "Implement feature X",
      commands: { "C-1": cmd1 },
    });

    expect(dataset.id).toBe("test-run");
    expect(dataset.directed).toBe(true);
    expect(dataset.entry).toBe("node-input-prompt");
    expect(dataset.exits).toEqual(["node-terminal-complete"]);

    // Nodes
    const nodeIds = dataset.nodes.map((n) => n.id);
    expect(nodeIds).toContain("node-input-prompt");
    expect(nodeIds).toContain("node-orchestrator-plan");
    expect(nodeIds).toContain("node-task-T-1");
    expect(nodeIds).toContain("node-gate-T-1");
    expect(nodeIds).toContain("node-task-T-2");
    expect(nodeIds).toContain("node-gate-T-2");
    expect(nodeIds).toContain("node-critic-authority");
    expect(nodeIds).toContain("node-terminal-complete");

    // Sections
    expect(dataset.sections).toHaveLength(4);
    expect(dataset.sections?.map((s) => s.id)).toEqual([
      "sec-planning",
      "sec-execution",
      "sec-validation",
      "sec-review",
    ]);

    // Metadata
    const t1Node = dataset.nodes.find((n) => n.id === "node-task-T-1");
    expect(t1Node?.status).toBe("success");
    expect(t1Node?.metadata?.repairRounds).toBe(1);
    expect(t1Node?.metadata?.commands).toHaveLength(1);
    expect(t1Node?.metadata?.findings).toHaveLength(1);

    // Repair cycle edge
    const repairEdge = dataset.edges.find((e) => e.kind === "loop");
    expect(repairEdge).toBeDefined();
    expect(repairEdge?.isCycle).toBe(true);
  });
});
