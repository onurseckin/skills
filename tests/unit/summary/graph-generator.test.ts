import { describe, expect, test } from "bun:test";
import type { CommandRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import type {
  TaskRecord,
  WorkflowState,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";

describe("graph generator", () => {
  test("generates full GVUI compliant GraphDataset with archetypes, steps and badges", () => {
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

    // Nodes presence and archetypes
    const promptNode = dataset.nodes.find((n) => n.id === "node-input-prompt");
    expect(promptNode?.kind).toBe("input");
    expect(promptNode?.step).toBe(1);
    expect(promptNode?.badge?.icon).toBe("IconTerminal2");
    expect(promptNode?.io?.outputs?.[0]?.kind).toBe("prompt");

    const orchNode = dataset.nodes.find((n) => n.id === "node-orchestrator-plan");
    expect(orchNode?.kind).toBe("orchestrator");
    expect(orchNode?.step).toBe(1);
    expect(orchNode?.badge?.icon).toBe("IconHierarchy2");

    const t1Node = dataset.nodes.find((n) => n.id === "node-task-T-1");
    expect(t1Node?.kind).toBe("agent");
    expect(t1Node?.step).toBe(2);
    expect(t1Node?.model).toBe("Gemini 3.7 Flash (High)");
    expect(t1Node?.tier).toBe("l");
    expect(t1Node?.badge?.icon).toBe("IconRobot");
    expect(t1Node?.metadata?.commands).toHaveLength(1);
    expect(t1Node?.metadata?.findings).toHaveLength(1);

    const g1Node = dataset.nodes.find((n) => n.id === "node-gate-T-1");
    expect(g1Node?.kind).toBe("gate");
    expect(g1Node?.step).toBe(3);
    expect(g1Node?.badge?.icon).toBe("IconShieldCheck");

    const t2Node = dataset.nodes.find((n) => n.id === "node-task-T-2");
    expect(t2Node?.kind).toBe("agent");
    expect(t2Node?.step).toBe(4);

    const criticNode = dataset.nodes.find((n) => n.id === "node-critic-authority");
    expect(criticNode?.kind).toBe("critic");
    expect(criticNode?.badge?.icon).toBe("IconScale");

    const terminalNode = dataset.nodes.find((n) => n.id === "node-terminal-complete");
    expect(terminalNode?.kind).toBe("terminal");
    expect(terminalNode?.badge?.icon).toBe("IconFlagCheck");

    // Sections are empty (no background phase overlays)
    expect(dataset.sections ?? []).toHaveLength(0);

    // Validator Media Assets and Playwright metadata assertions
    expect(t1Node?.metadata?.mediaAssets).toBeDefined();
    expect(g1Node?.metadata?.mediaAssets).toBeDefined();

    // Edge Traffic Detail and Exchanges
    const promptEdge = dataset.edges.find((e) => e.id === "edge-prompt-plan");
    expect(promptEdge?.traffic).toBeDefined();
    expect(promptEdge?.traffic?.messagesCount).toBeGreaterThanOrEqual(1);
    expect(promptEdge?.exchanges).toHaveLength(1);

    const criticEdge = dataset.edges.find((e) => e.id === "edge-critic-complete");
    expect(criticEdge?.traffic).toBeDefined();
    expect(criticEdge?.traffic?.tokens).toBe(450);
    expect(criticEdge?.traffic?.glowColor).toBe("#10b981");

    const spawnEdge = dataset.edges.find((e) => e.kind === "spawn");
    expect(spawnEdge?.badge?.icon).toBe("IconRocket");
    expect(spawnEdge?.container?.stepBadge).toBe("2");
    expect(spawnEdge?.container?.title).toBe("Dispatches Worker");
    expect(spawnEdge?.traffic).toBeDefined();
    expect(spawnEdge?.exchanges?.[0]?.kind).toBe("prompt");

    const loopEdge = dataset.edges.find((e) => e.kind === "loop");
    expect(loopEdge?.isCycle).toBe(true);
    expect(loopEdge?.badge?.icon).toBe("IconAlertCircle");
    expect(loopEdge?.container?.title).toContain("Validator Pushback");
    expect(loopEdge?.stepNumber).toBe("3 -> 2");
    expect(loopEdge?.traffic).toBeDefined();
    expect(loopEdge?.traffic?.status).toBe("congested");
    expect(loopEdge?.traffic?.glowColor).toBe("#f59e0b");
    expect(loopEdge?.isHighTraffic).toBe(true);

    const depEdge = dataset.edges.find((e) => e.kind === "dependency");
    expect(depEdge?.traffic).toBeDefined();
    expect(depEdge?.traffic?.glowColor).toBe("#06b6d4");
    expect(depEdge?.isHighTraffic).toBe(true);

    const joinEdge = dataset.edges.find((e) => e.kind === "join");
    expect(joinEdge?.badge?.icon).toBe("IconFileText");
    expect(joinEdge?.container?.title).toBe("Evidence Report");
  });
});
