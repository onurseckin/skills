import { describe, expect, test } from "bun:test";
import type { CommandRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import type {
  TaskRecord,
  WorkflowState,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import {
  buildTaskAndGateNodes,
  mapGateStatus,
} from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator-helpers.ts";
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

    // Node metrics & Timing breakdown
    expect(t1Node?.metrics).toBeDefined();
    expect(t1Node?.metrics?.timingBreakdown).toBeDefined();
    expect(t1Node?.metrics?.timingBreakdown?.wallDurationMs).toBeGreaterThanOrEqual(1000);
    expect(t1Node?.metrics?.timingBreakdown?.activeCommandMs).toBe(1000);
    expect(t1Node?.metrics?.tokens).toBeDefined();
    expect(t1Node?.metrics?.tokens?.totalTokens).toBeGreaterThan(0);

    expect(g1Node?.metrics).toBeDefined();
    expect(g1Node?.metrics?.tokens).toBeDefined();

    // Sections are empty (no background phase overlays)
    expect(dataset.sections ?? []).toHaveLength(0);

    // Validator Media Assets and Playwright metadata assertions
    expect(t1Node?.metadata?.mediaAssets).toBeDefined();
    expect(g1Node?.metadata?.mediaAssets).toBeDefined();

    // Edge Traffic Detail and Exchanges
    const promptEdge = dataset.edges.find((e) => e.id === "edge-prompt-plan");
    expect(promptEdge?.traffic).toBeDefined();
    expect(promptEdge?.traffic?.messagesCount).toBeGreaterThanOrEqual(1);
    expect(promptEdge?.traffic?.tokensOut).toBeGreaterThan(0);
    expect(promptEdge?.traffic?.latencyMs).toBe(20);
    expect(promptEdge?.exchanges).toHaveLength(1);

    const criticEdge = dataset.edges.find((e) => e.id === "edge-critic-complete");
    expect(criticEdge?.traffic).toBeDefined();
    expect(criticEdge?.traffic?.tokens).toBe(450);
    expect(criticEdge?.traffic?.tokensIn).toBe(150);
    expect(criticEdge?.traffic?.tokensOut).toBe(300);
    expect(criticEdge?.traffic?.glowColor).toBe("#10b981");

    const spawnEdge = dataset.edges.find((e) => e.kind === "spawn");
    expect(spawnEdge?.badge?.icon).toBe("IconRocket");
    expect(spawnEdge?.container?.stepBadge).toBe("2");
    expect(spawnEdge?.container?.title).toBe("Dispatches Worker");
    expect(spawnEdge?.traffic).toBeDefined();
    expect(spawnEdge?.traffic?.tokensIn).toBe(100);
    expect(spawnEdge?.traffic?.tokensOut).toBe(250);
    expect(spawnEdge?.traffic?.latencyMs).toBe(30);
    expect(spawnEdge?.exchanges?.[0]?.kind).toBe("prompt");

    const loopEdge = dataset.edges.find((e) => e.kind === "loop");
    expect(loopEdge?.isCycle).toBe(true);
    expect(loopEdge?.badge?.icon).toBe("IconAlertCircle");
    expect(loopEdge?.container?.title).toContain("Validator Pushback");
    expect(loopEdge?.stepNumber).toBe("3 -> 2");
    expect(loopEdge?.traffic).toBeDefined();
    expect(loopEdge?.traffic?.status).toBe("congested");
    expect(loopEdge?.traffic?.glowColor).toBe("#f43f5e");
    expect(loopEdge?.traffic?.latencyMs).toBe(60);
    expect(loopEdge?.isHighTraffic).toBe(true);

    const depEdge = dataset.edges.find((e) => e.kind === "dependency");
    expect(depEdge?.traffic).toBeDefined();
    expect(depEdge?.traffic?.glowColor).toBe("#06b6d4");
    expect(depEdge?.traffic?.tokensIn).toBe(120);
    expect(depEdge?.traffic?.tokensOut).toBe(300);
    expect(depEdge?.isHighTraffic).toBe(true);

    const joinEdge = dataset.edges.find((e) => e.kind === "join");
    expect(joinEdge?.badge?.icon).toBe("IconFileText");
    expect(joinEdge?.container?.title).toBe("Evidence Report");
    expect(joinEdge?.traffic?.tokensIn).toBe(100);
    expect(joinEdge?.traffic?.tokensOut).toBe(200);
  });

  test("maps gate status correctly across all task lifecycle states", () => {
    expect(mapGateStatus({ id: "1", status: "done", requirement_ids: [], write_scope: [], dependencies: [], attempts: [], history: [], repair_round: 0 })).toBe("success");
    expect(mapGateStatus({ id: "2", status: "validated", requirement_ids: [], write_scope: [], dependencies: [], attempts: [], history: [], repair_round: 0 })).toBe("success");
    expect(mapGateStatus({ id: "3", status: "changes_requested", requirement_ids: [], write_scope: [], dependencies: [], attempts: [], history: [], repair_round: 1 })).toBe("warning");
    expect(mapGateStatus({ id: "4", status: "cancelled", requirement_ids: [], write_scope: [], dependencies: [], attempts: [], history: [], repair_round: 0 })).toBe("error");
    expect(mapGateStatus({ id: "5", status: "escalated", requirement_ids: [], write_scope: [], dependencies: [], attempts: [], history: [], repair_round: 0 })).toBe("error");
    expect(mapGateStatus({ id: "6", status: "validating", requirement_ids: [], write_scope: [], dependencies: [], attempts: [], history: [], repair_round: 0 })).toBe("running");
    expect(mapGateStatus({ id: "7", status: "gating", requirement_ids: [], write_scope: [], dependencies: [], attempts: [], history: [], repair_round: 0 })).toBe("running");
    expect(mapGateStatus({
      id: "8",
      status: "leased",
      requirement_ids: [],
      write_scope: [],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      validation: {
        validator_id: "val-1",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-14T20:00:00.000Z",
        deadline_at: "2026-08-14T20:10:00.000Z",
      },
    })).toBe("running");
    expect(mapGateStatus({ id: "9", status: "proposed", requirement_ids: [], write_scope: [], dependencies: [], attempts: [], history: [], repair_round: 0 })).toBe("pending");
    expect(mapGateStatus({ id: "10", status: "ready", requirement_ids: [], write_scope: [], dependencies: [], attempts: [], history: [], repair_round: 0 })).toBe("pending");
  });

  test("enriches gate node status, metadata, validator attribution and validation history", () => {
    const task: TaskRecord = {
      id: "T-pushback",
      label: "Feature with Pushback",
      status: "changes_requested",
      requirement_ids: ["R-PB"],
      write_scope: ["src/feature.ts", "src/feature.test.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 2,
      validation_history: [
        {
          validator_id: "validator-agent-alpha",
          token_digest: "tok1",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
          verdict: "reject",
        },
      ],
      findings: [
        {
          id: "F-101",
          requirement_id: "R-PB",
          severity: "critical",
          observation: "Coverage below threshold",
          remediation: "Add unit tests",
          revalidation: "Run coverage gate",
          status: "open",
        },
      ],
    };

    const { gateNode } = buildTaskAndGateNodes({
      task,
      taskStep: 2,
      taskWave: 1,
      taskCmds: [],
    });

    // Gate node status on changes_requested is warning (NOT pending)
    expect(gateNode.status).toBe("warning");
    expect(gateNode.badge?.variant).toBe("warning");
    expect(gateNode.badge?.text).toBe("Pushback: 1 Finding");
    expect(gateNode.badge?.icon).toBe("IconAlertTriangle");

    // Gate node metadata enrichment
    expect(gateNode.metadata?.validator_id).toBe("validator-agent-alpha");
    expect(gateNode.metadata?.leaseAgent).toBe("validator-agent-alpha");
    expect(gateNode.metadata?.repairRounds).toBe(2);
    expect(gateNode.metadata?.validationHistory).toHaveLength(1);
    expect(gateNode.metadata?.writeScope).toEqual(["src/feature.ts", "src/feature.test.ts"]);
    expect(gateNode.metadata?.findings).toHaveLength(1);
  });

  test("elevates top-level costUsd to node metrics on taskNode and gateNode", () => {
    const task: TaskRecord = {
      id: "T-cost",
      label: "Cost Elevation Test",
      status: "done",
      requirement_ids: ["R-C"],
      write_scope: ["src/cost.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      report: { summary: "Implemented cost feature", files_changed: ["src/cost.ts"] },
      validation: {
        validator_id: "val-cost",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-14T20:00:00.000Z",
        deadline_at: "2026-08-14T20:10:00.000Z",
      },
    };

    const cmd: CommandRecord = {
      id: "C-cost",
      argv: ["bun", "test"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      status: "succeeded",
      task_id: "T-cost",
      started_at: "2026-08-14T20:00:00.000Z",
      finished_at: "2026-08-14T20:00:01.000Z",
      exit_code: 0,
      signal: null,
      fingerprint: "fp-cost",
      attempt_signing_public_key: "pk-cost",
      record_path: "commands/C-cost/record.json",
      actor: "val",
    };

    const { taskNode, gateNode } = buildTaskAndGateNodes({
      task,
      taskStep: 2,
      taskWave: 1,
      taskCmds: [cmd],
    });

    // When taskTokens or gateTokens has costUsd, node.metrics.costUsd is elevated
    expect(taskNode.metrics).toBeDefined();
    if (taskNode.metrics?.tokens?.costUsd !== undefined) {
      expect(taskNode.metrics.costUsd).toBe(taskNode.metrics.tokens.costUsd);
    }
    expect(gateNode.metrics).toBeDefined();
    if (gateNode.metrics?.tokens?.costUsd !== undefined) {
      expect(gateNode.metrics.costUsd).toBe(gateNode.metrics.tokens.costUsd);
    }
  });
});
