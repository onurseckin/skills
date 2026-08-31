import { describe, expect, test } from "bun:test";
import {
  computeScopeOverlaps,
  evaluateSupervisoryState,
  parseTimeMs,
} from "../../../olt/scripts/src/authority/supervisory/index.ts";
import { loadUnifiedAgentModel } from "../../../olt/scripts/src/authority/manifest/index.ts";
import type { SupervisoryReminderEvaluationContext } from "../../../olt/scripts/src/authority/supervisory/types.ts";

describe("Supervisory Invariant & Protocol Evaluation - Core", () => {
  test("parseTimeMs handles diverse input types and fallbacks", () => {
    expect(parseTimeMs(undefined)).toBeGreaterThan(0);
    expect(parseTimeMs(12345)).toBe(12345);
    expect(parseTimeMs("2026-08-31T00:00:00.000Z")).toBe(
      new Date("2026-08-31T00:00:00.000Z").getTime(),
    );
    expect(parseTimeMs("invalid-date-string")).toBeGreaterThan(0);
  });

  test("computeScopeOverlaps accurately finds write scope collisions", () => {
    expect(computeScopeOverlaps([])).toEqual([]);
    expect(
      computeScopeOverlaps([
        { taskId: "t1", agentId: "a1", writeScope: ["src/a.ts"] },
        { taskId: "t2", agentId: "a2", writeScope: ["src/b.ts"] },
      ]),
    ).toEqual([]);

    const overlaps = computeScopeOverlaps([
      { taskId: "t1", agentId: "a1", writeScope: ["src/a.ts", "src/shared.ts"] },
      { taskId: "t2", agentId: "a2", writeScope: ["src/shared.ts", "src/b.ts"] },
      { taskId: "t3", agentId: "a3", writeScope: [] },
    ]);
    expect(overlaps.length).toBe(1);
    expect(overlaps[0]?.taskA).toBe("t1");
    expect(overlaps[0]?.taskB).toBe("t2");
    expect(overlaps[0]?.overlappingFiles).toEqual(["src/shared.ts"]);
  });

  test("evaluateSupervisoryState returns compliant state for clean context", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      agentId: "coordinator_subsystem",
      tickNumber: 1,
    };
    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(true);
    expect(evalResult.driftScore).toBe(0);
    expect(evalResult.severity).toBe("none");
    expect(evalResult.violations.length).toBe(0);
    expect(evalResult.correctiveDirectives.length).toBe(0);
    expect(evalResult.checklist.every((c) => c.status === "completed")).toBe(true);
    expect(evalResult.summary).toContain("fully compliant");
  });

  test("Batch 1 Rule 1: detects supervisor direct file modifications", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      fileModificationsOnSupervisoryThread: ["src/file1.ts", "src/file2.ts"],
      recentActions: [
        { action: "edit_file", targetFile: "src/file3.ts" },
        { action: "write_file", targetFile: "src/file4.ts" },
        { action: "delete_file", targetFile: "src/file5.ts" },
        { action: "read_file", targetFile: "src/file6.ts" },
      ],
    };
    const res = evaluateSupervisoryState(context);
    expect(res.compliant).toBe(false);
    expect(res.severity).toBe("critical");
    const v = res.violations.find(
      (violation) => violation.code === "SUPERVISOR_ZERO_FILE_EDIT_BREACH",
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("critical");
    expect(res.correctiveDirectives.length).toBeGreaterThan(0);
  });

  test("Batch 1 Rule 2: detects supervisor direct task execution attempts", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "orchestrator",
      directExecutionAttempts: ["task:claim"],
      recentActions: [
        { action: "claim_task" },
        { action: "implement_task" },
        { action: "repair_task" },
        { action: "send_message" },
      ],
    };
    const res = evaluateSupervisoryState(context);
    expect(res.compliant).toBe(false);
    const v = res.violations.find(
      (violation) => violation.code === "SUPERVISOR_TASK_SELF_EXECUTION_BREACH",
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("critical");
  });

  test("Batch 1 Rule 3: detects cross-tier spawn hierarchy breach", () => {
    const model = loadUnifiedAgentModel("coordinator");
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      crossTierSpawns: ["mind_supervisor"],
      recentActions: [
        { action: "spawn_subagent", spawnedRole: "mind_supervisor" },
        { action: "spawn_subagent", spawnedRole: undefined },
      ],
    };
    const res = evaluateSupervisoryState(context, model);
    expect(res.compliant).toBe(false);
    const v = res.violations.find(
      (violation) => violation.code === "CROSS_TIER_SPAWN_HIERARCHY_BREACH",
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("critical");
  });

  test("Batch 1 Rule 4: detects write scope collision breach among leases", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      activeLeases: [
        { taskId: "task-A", agentId: "agent-a", writeScope: ["src/app.ts"] },
        { taskId: "task-B", agentId: "agent-b", writeScope: ["src/app.ts"] },
      ],
    };
    const res = evaluateSupervisoryState(context);
    expect(res.compliant).toBe(false);
    const v = res.violations.find((violation) => violation.code === "WRITE_SCOPE_COLLISION_BREACH");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("high");
  });

  test("Batch 1 Rule 5: detects queue idle anti-batching neglect", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      queueState: {
        totalCount: 5,
        readyCount: 5,
        runningCount: 0,
        blockedCount: 0,
      },
    };
    const res = evaluateSupervisoryState(context);
    expect(res.compliant).toBe(false);
    const v = res.violations.find(
      (violation) => violation.code === "QUEUE_IDLE_ANTI_BATCHING_NEGLECT",
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("medium");
  });

  test("Batch 2 Rule 1: detects unproven gate risk", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      unprovenGatesCount: 3,
    };
    const res = evaluateSupervisoryState(context);
    expect(res.compliant).toBe(false);
    const v = res.violations.find((violation) => violation.code === "UNPROVEN_GATE_RISK");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("medium");
  });

  test("Batch 2 Rule 2: detects qualitative pass rubber stamp breach", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      qualitativePassesWithoutProof: ["task-101", "task-102"],
    };
    const res = evaluateSupervisoryState(context);
    expect(res.compliant).toBe(false);
    const v = res.violations.find(
      (violation) => violation.code === "QUALITATIVE_PASS_RUBBER_STAMP_BREACH",
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("high");
  });

  test("Batch 2 Rule 3: detects 4-tier viewport matrix breach", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      uiTasksMissingViewportValidation: ["task-ui-header", "task-ui-modal"],
    };
    const res = evaluateSupervisoryState(context);
    expect(res.compliant).toBe(false);
    const v = res.violations.find(
      (violation) => violation.code === "FOUR_TIER_VIEWPORT_MATRIX_BREACH",
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("high");
  });
});
