import { describe, expect, test } from "bun:test";
import type { CommandRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import type {
  TaskRecord,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import {
  buildTaskAndGateNodes,
  mapGateStatus,
} from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator-helpers.ts";

describe("graph generator gate node helpers", () => {
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

    expect(gateNode.status).toBe("warning");
    expect(gateNode.badge?.variant).toBe("warning");
    expect(gateNode.badge?.text).toBe("Pushback: 1 Finding");
    expect(gateNode.badge?.icon).toBe("IconAlertTriangle");

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
