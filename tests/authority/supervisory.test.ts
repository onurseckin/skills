import { describe, expect, test } from "bun:test";
import {
  DECISION_PROTOCOLS,
  STANDING_CHECKLIST_DEFINITIONS,
  computeScopeOverlaps,
  constructSupervisoryPersonaReminder,
  evaluateSupervisoryState,
  parseTimeMs,
} from "../../olt/scripts/src/authority/supervisory/index.ts";
import { loadUnifiedAgentModel } from "../../olt/scripts/src/authority/manifest/index.ts";
import type { SupervisoryReminderEvaluationContext } from "../../olt/scripts/src/authority/supervisory/types.ts";

describe("Supervisory Invariant & Protocol Evaluation", () => {
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

  test("Batch 2 Rule 4: detects premature run completion breach", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      attemptedPrematureCompletion: true,
      openFindingsCount: 2,
      failedGatesCount: 1,
      unprovenGatesCount: 1,
      activeLeases: [{ taskId: "active-1", agentId: "agent-1", writeScope: [] }],
    };
    const res = evaluateSupervisoryState(context);
    expect(res.compliant).toBe(false);
    const v = res.violations.find(
      (violation) => violation.code === "PREMATURE_RUN_COMPLETION_BREACH",
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("critical");
  });

  test("Batch 2 Rule 5: detects validator mandatory adversarial probe omission", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "validator_code_quality",
      adversarialProbeRecorded: false,
    };
    const res = evaluateSupervisoryState(context);
    expect(res.compliant).toBe(false);
    const v = res.violations.find(
      (violation) => violation.code === "MANDATORY_ADVERSARIAL_PROBE_OMISSION",
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("high");
  });

  test("Batch 2 Rule 6: detects unstandardized agent ID", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      agentId: "random_unregistered_id_999",
    };
    const res = evaluateSupervisoryState(context);
    expect(res.compliant).toBe(false);
    const v = res.violations.find(
      (violation) => violation.code === "UNSTANDARDIZED_AGENT_ID_BREACH",
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("high");
  });

  test("Batch 2 Rule 7: detects prose evidence bias / verification failure", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      evidenceVerificationFailed: true,
      evidenceVerification: {
        certified: false,
        milestone: "execution",
        capsulePath: "/path/to/capsule",
        hashChain: {
          valid: false,
          totalEvents: 10,
          headHash: "hash-head",
          brokenAtSequence: 4,
          error: "Tampered hash at seq 4",
        },
        commandReceipts: [],
        requiredEvents: [],
        missingEvents: [],
        failedReceipts: [],
        errors: ["Tampered hash at seq 4"],
        summary: "Failed evidence verification",
      },
    };
    const res = evaluateSupervisoryState(context);
    expect(res.compliant).toBe(false);
    const v = res.violations.find((violation) => violation.code === "PROSE_EVIDENCE_BIAS_BREACH");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("critical");
  });

  test("constructSupervisoryPersonaReminder constructs rich Markdown and brief formats", () => {
    const reminder = constructSupervisoryPersonaReminder({
      role: "coordinator",
      agentId: "coordinator_subsystem",
      runId: "run-2026-test",
      pulseId: "pulse-1",
      startedAt: Date.now() - 360_000,
      now: Date.now(),
      cadenceMs: 180_000,
      context: {
        role: "coordinator",
        unprovenGatesCount: 1,
      },
    });

    expect(reminder.role).toBe("coordinator");
    expect(reminder.tier).toBe(2);
    expect(reminder.tickNumber).toBe(3);
    expect(reminder.runId).toBe("run-2026-test");
    expect(reminder.pulseId).toBe("pulse-1");
    expect(reminder.renderedMarkdown).toContain("Supervisory Persona & Responsibility Reminder");
    expect(reminder.renderedMarkdown).toContain("run-2026-test");
    expect(reminder.renderedMarkdown).toContain("pulse-1");
    expect(reminder.renderedMarkdown).toContain("coordinator_subsystem");
    expect(reminder.renderedMarkdown).toContain("Binding Capability Contract");
    expect(reminder.renderedMarkdown).toContain("Standing Decision Protocols");
    expect(reminder.renderedMarkdown).toContain("Immediate Corrective Directives");
    expect(reminder.compactPromptInjection).toContain("[PERSONA REMINDER Tick #3]");
    expect(reminder.compactPromptInjection).toContain("DIRECTIVES:");
    expect(reminder.heartbeatTickBrief).toContain("Heartbeat Tick #3");

    // Construct without context / defaults
    const minimal = constructSupervisoryPersonaReminder({
      role: "orchestrator",
      tickNumber: 1,
    });
    expect(minimal.role).toBe("orchestrator");
    expect(minimal.agentId).toBeNull();
    expect(minimal.runId).toBeNull();
    expect(minimal.pulseId).toBeNull();
    expect(minimal.compactPromptInjection).not.toContain("DIRECTIVES:");
  });

  test("covers low severity drift score and evidence verification object", () => {
    // Evidence verification object with errors
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      evidenceVerification: {
        certified: false,
        milestone: "execution",
        capsulePath: "/path/to/capsule",
        hashChain: {
          valid: false,
          totalEvents: 10,
          headHash: "hash-head",
          brokenAtSequence: 4,
          error: "Cryptographic hash chain broken at sequence 4",
        },
        commandReceipts: [],
        requiredEvents: [],
        missingEvents: [],
        failedReceipts: [],
        errors: ["Cryptographic hash chain broken at sequence 4"],
        summary: "Failed evidence verification",
      },
    };
    const res = evaluateSupervisoryState(context);
    expect(res.compliant).toBe(false);
    expect(res.violations.some((v) => v.code === "PROSE_EVIDENCE_BIAS_BREACH")).toBe(true);

    // Subagent idle warning producing low severity and 0.05 drift score
    const idleContext: SupervisoryReminderEvaluationContext = {
      role: "orchestrator",
      subagentIdleWarningCount: 2,
    };
    const idleRes = evaluateSupervisoryState(idleContext);
    expect(idleRes.compliant).toBe(false);
    expect(idleRes.severity).toBe("low");
    expect(idleRes.driftScore).toBe(0.05);

    // Formatter handles reminder with low severity / idle warning
    const reminderWithIdle = constructSupervisoryPersonaReminder({
      role: "orchestrator",
      context: idleContext,
    });
    expect(reminderWithIdle.renderedMarkdown).toContain("⚠️ NEGLECTED");
    expect(reminderWithIdle.renderedMarkdown).toContain("subagent idle warning");
  });

  test("STANDING_CHECKLIST_DEFINITIONS and DECISION_PROTOCOLS constants integrity", () => {
    expect(STANDING_CHECKLIST_DEFINITIONS.length).toBeGreaterThan(0);
    expect(Object.keys(DECISION_PROTOCOLS).length).toBeGreaterThan(0);
    for (const proto of Object.values(DECISION_PROTOCOLS)) {
      expect(proto.id).toBeDefined();
      expect(proto.name).toBeDefined();
      expect(proto.formulaOrRule).toBeDefined();
      expect(proto.applicableTiers.length).toBeGreaterThan(0);
    }
  });
});
