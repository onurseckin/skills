import { describe, expect, test } from "bun:test";
import type { TaskRecord } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import {
  computeGateTokens,
  computeTaskTokens,
} from "../../../orchestrating-long-tasks/scripts/src/summary/metrics-collector.ts";

describe("metrics token collector", () => {
  test("computes multi-dimensional token usage with reasoning and cache tokens", () => {
    const task: TaskRecord = {
      id: "T-20",
      status: "done",
      requirement_ids: ["R-20"],
      write_scope: ["src/x.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      report: { summary: "Refactored module", files_changed: ["src/x.ts"] },
    };

    const hostTokens = {
      inputTokens: 1200,
      outputTokens: 400,
      reasoningTokens: 800,
      cacheCreationTokens: 300,
      cacheReadTokens: 100,
      costUsd: 0.015,
      isEstimated: false,
    };

    const tokens = computeTaskTokens(task, undefined, [], hostTokens);
    expect(tokens.inputTokens).toBe(1200);
    expect(tokens.outputTokens).toBe(400);
    expect(tokens.reasoningTokens).toBe(800);
    expect(tokens.cacheCreationTokens).toBe(300);
    expect(tokens.cacheReadTokens).toBe(100);
    expect(tokens.totalTokens).toBe(2800);
    expect(tokens.costUsd).toBe(0.015);
    expect(tokens.isEstimated).toBe(false);
  });

  test("preserves hostTokens.costUsd even when token calculation is estimated", () => {
    const task: TaskRecord = {
      id: "T-21",
      status: "done",
      requirement_ids: ["R-21"],
      write_scope: ["src/y.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      report: { summary: "Implemented module Y", files_changed: ["src/y.ts"] },
    };

    const hostTokens = {
      reasoningTokens: 100,
      cacheCreationTokens: 50,
      cacheReadTokens: 25,
      costUsd: 0.0085,
      isEstimated: true,
    };

    const tokens = computeTaskTokens(task, undefined, [], hostTokens);
    expect(tokens.isEstimated).toBe(true);
    expect(tokens.reasoningTokens).toBe(100);
    expect(tokens.cacheCreationTokens).toBe(50);
    expect(tokens.cacheReadTokens).toBe(25);
    expect(tokens.costUsd).toBe(0.0085);
  });

  test("computes gate token usage accurately with validator hostTokens", () => {
    const task: TaskRecord = {
      id: "T-40",
      status: "done",
      requirement_ids: ["R-40"],
      write_scope: ["src/gate.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      findings: [
        {
          id: "F-40",
          requirement_id: "R-40",
          severity: "important",
          observation: "Gate observation",
          remediation: "Remediate",
          revalidation: "Reval",
          status: "resolved",
        },
      ],
    };

    const hostTokens = {
      inputTokens: 800,
      outputTokens: 250,
      reasoningTokens: 600,
      cacheCreationTokens: 150,
      cacheReadTokens: 50,
      costUsd: 0.0092,
      isEstimated: false,
    };

    const directTokens = computeGateTokens(task, [], hostTokens);
    expect(directTokens.inputTokens).toBe(800);
    expect(directTokens.outputTokens).toBe(250);
    expect(directTokens.reasoningTokens).toBe(600);
    expect(directTokens.cacheCreationTokens).toBe(150);
    expect(directTokens.cacheReadTokens).toBe(50);
    expect(directTokens.totalTokens).toBe(1850);
    expect(directTokens.costUsd).toBe(0.0092);
    expect(directTokens.isEstimated).toBe(false);

    const estimatedHostTokens = {
      reasoningTokens: 120,
      cacheCreationTokens: 40,
      cacheReadTokens: 10,
      costUsd: 0.0035,
      isEstimated: true,
    };

    const estimatedTokens = computeGateTokens(task, [], estimatedHostTokens);
    expect(estimatedTokens.isEstimated).toBe(true);
    expect(estimatedTokens.reasoningTokens).toBe(120);
    expect(estimatedTokens.cacheCreationTokens).toBe(40);
    expect(estimatedTokens.cacheReadTokens).toBe(10);
    expect(estimatedTokens.costUsd).toBe(0.0035);
    expect(estimatedTokens.totalTokens).toBe(
      (estimatedTokens.inputTokens ?? 0) + (estimatedTokens.outputTokens ?? 0) + 120 + 40 + 10,
    );
  });

  test("strictly enforces 5-part token summation formula across all execution paths", () => {
    const task: TaskRecord = {
      id: "T-strict",
      status: "done",
      requirement_ids: ["R-S"],
      write_scope: ["src/s.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      report: { summary: "Strict token test", files_changed: ["src/s.ts"] },
    };

    const hostWithMismatchedTotal = {
      inputTokens: 500,
      outputTokens: 200,
      reasoningTokens: 100,
      cacheCreationTokens: 50,
      cacheReadTokens: 25,
      totalTokens: 999999,
      costUsd: 0.005,
      isEstimated: false,
    };

    const taskTokens = computeTaskTokens(task, undefined, [], hostWithMismatchedTotal);
    expect(taskTokens.totalTokens).toBe(875);
    expect(taskTokens.totalTokens).toBe(
      (taskTokens.inputTokens ?? 0) +
        (taskTokens.outputTokens ?? 0) +
        (taskTokens.reasoningTokens ?? 0) +
        (taskTokens.cacheCreationTokens ?? 0) +
        (taskTokens.cacheReadTokens ?? 0),
    );

    const gateTokens = computeGateTokens(task, [], hostWithMismatchedTotal);
    expect(gateTokens.totalTokens).toBe(875);
    expect(gateTokens.totalTokens).toBe(
      (gateTokens.inputTokens ?? 0) +
        (gateTokens.outputTokens ?? 0) +
        (gateTokens.reasoningTokens ?? 0) +
        (gateTokens.cacheCreationTokens ?? 0) +
        (gateTokens.cacheReadTokens ?? 0),
    );

    const estimatedTaskTokens = computeTaskTokens(task, undefined, []);
    expect(estimatedTaskTokens.totalTokens).toBe(
      (estimatedTaskTokens.inputTokens ?? 0) +
        (estimatedTaskTokens.outputTokens ?? 0) +
        (estimatedTaskTokens.reasoningTokens ?? 0) +
        (estimatedTaskTokens.cacheCreationTokens ?? 0) +
        (estimatedTaskTokens.cacheReadTokens ?? 0),
    );

    const estimatedGateTokens = computeGateTokens(task, []);
    expect(estimatedGateTokens.totalTokens).toBe(
      (estimatedGateTokens.inputTokens ?? 0) +
        (estimatedGateTokens.outputTokens ?? 0) +
        (estimatedGateTokens.reasoningTokens ?? 0) +
        (estimatedGateTokens.cacheCreationTokens ?? 0) +
        (estimatedGateTokens.cacheReadTokens ?? 0),
    );
  });
});
