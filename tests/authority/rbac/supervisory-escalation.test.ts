import { describe, expect, test } from "bun:test";
import {
  DECISION_PROTOCOLS,
  STANDING_CHECKLIST_DEFINITIONS,
  constructSupervisoryPersonaReminder,
  evaluateSupervisoryState,
} from "../../../olt/scripts/src/authority/supervisory/index.ts";
import type { SupervisoryReminderEvaluationContext } from "../../../olt/scripts/src/authority/supervisory/types.ts";

describe("Supervisory Invariant & Protocol Evaluation - Escalation & Reminders", () => {
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

    const idleContext: SupervisoryReminderEvaluationContext = {
      role: "orchestrator",
      subagentIdleWarningCount: 2,
    };
    const idleRes = evaluateSupervisoryState(idleContext);
    expect(idleRes.compliant).toBe(false);
    expect(idleRes.severity).toBe("low");
    expect(idleRes.driftScore).toBe(0.05);

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
