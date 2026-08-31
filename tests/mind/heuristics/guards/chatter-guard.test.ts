import { describe, expect, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ChatterGuardEngine,
  DEFAULT_CHATTER_SUPPRESSION_NOTICE,
  DEFECT_MAIN_THREAD_CHATTER_BURNS_OWNER_CONTEXT,
  DEFECT_ROUTINE_PULSE_MAIN_THREAD_CHATTER_LEAK,
  FEATURE_MAIN_THREAD_CHATTER_GUARD,
  assertNonChatterOwnerContext,
  chatterGuard,
  classifyChatter,
  estimateTokenSavings,
  filterOwnerContextMessage,
  isActionableError,
  isCompanionAuditorOutput,
  isHighPriorityMilestone,
  isProgressNarration,
  isRoutinePulse,
  shouldSuppressForOwner,
} from "../../../../olt/scripts/src/mind/chatter-guard.ts";
import { chatterGuard as barrelChatterGuard } from "../../../../olt/scripts/src/mind/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

describe("Mind ChatterGuard Engine (chatter-guard.ts)", () => {
  beforeEach(() => {
    chatterGuard.resetMetrics();
  });

  test("exports canonical constants and defect reference identifiers", () => {
    expect(DEFECT_MAIN_THREAD_CHATTER_BURNS_OWNER_CONTEXT).toBe(
      "defect-main-thread-chatter-burns-owner-context",
    );
    expect(DEFECT_ROUTINE_PULSE_MAIN_THREAD_CHATTER_LEAK).toBe(
      "defect-routine-pulse-main-thread-chatter-leak",
    );
    expect(FEATURE_MAIN_THREAD_CHATTER_GUARD).toBe("fb-1788020100000-main-thread-chatter-guard");
    expect(DEFAULT_CHATTER_SUPPRESSION_NOTICE).toContain(
      "Background telemetry/routine pulse suppressed",
    );
    expect(barrelChatterGuard).toBeDefined();
    expect(barrelChatterGuard.chatterGuard).toBeDefined();
  });

  test("detects routine background pulses and heartbeat ticking", () => {
    const routinePulses = [
      "[Pulse Tick]: pulse #42 nominal execution state",
      "Heartbeat nominal - alive and ticking",
      "Routine pulse: background liveness check OK",
      "Periodic scan nominal for mind lifecycle",
      "Scheduled tick: cadence poll completed",
      "pulse 10 quiescent",
    ];
    for (const pulse of routinePulses) {
      expect(isRoutinePulse(pulse)).toBe(true);
      expect(classifyChatter(pulse).category).toBe("ROUTINE_PULSE");
      expect(shouldSuppressForOwner(pulse)).toBe(true);
    }
  });

  test("detects companion auditor outputs and witness traces", () => {
    const auditorChatters = [
      "[Companion Audit]: cognitive witness observation recorded",
      "Companion auditor: audit cycle #5 nominal",
      "Witness trace: cognitive flavor evaluation in progress",
      "Meta-auditor scan: routine questionnaire evaluation clean",
      "Audit cycle 3 passed without violations",
    ];
    for (const audit of auditorChatters) {
      expect(isCompanionAuditorOutput(audit)).toBe(true);
      expect(classifyChatter(audit).category).toBe("COMPANION_AUDIT");
      expect(shouldSuppressForOwner(audit)).toBe(true);
    }
  });

  test("detects mid-flight progress narration and status chatter", () => {
    const progressChats = [
      "Status update: Step 2/5 executing",
      "Progress update: worker dispatched to queue",
      "I am now running the test suite verification",
      "Waiting for subagent worker completion",
      "Executing step 3: compiling artifacts",
    ];
    for (const chat of progressChats) {
      expect(isProgressNarration(chat)).toBe(true);
      expect(classifyChatter(chat).category).toBe("PROGRESS_NARRATION");
      expect(shouldSuppressForOwner(chat)).toBe(true);
    }
  });

  test("allows high-priority milestones and deliverables to pass through", () => {
    const milestones = [
      "[Milestone]: Task completed successfully. 4 files modified.",
      "Milestone achieved: all 25 tests passing with 0 failures",
      "[Deliverable]: Final deliverable ready for inspection",
      "Objective fulfilled: core engine initialized",
      "Mission accomplished: migration complete",
    ];
    for (const milestone of milestones) {
      expect(isHighPriorityMilestone(milestone)).toBe(true);
      expect(classifyChatter(milestone).category).toBe("HIGH_PRIORITY_MILESTONE");
      expect(shouldSuppressForOwner(milestone)).toBe(false);
      const res = filterOwnerContextMessage(milestone);
      expect(res.allowed).toBe(true);
      expect(res.suppressed).toBe(false);
      expect(res.decision).toBe("ALLOW");
      expect(res.filteredText).toBe(milestone);
    }
  });

  test("allows actionable errors and critical faults to pass through", () => {
    const criticalErrors = [
      "[Fatal]: Invariant violation detected in worker pool",
      "Critical fault: crash_threshold_exceeded on node 1",
      "[Alert]: Panic: unrecoverable error during lease grant",
      "Role_confinement_violation: unauthorized write attempt",
      "Defect escalation: unhandled rejection in pipeline",
    ];
    for (const err of criticalErrors) {
      expect(isActionableError(err)).toBe(true);
      expect(classifyChatter(err).category).toBe("ACTIONABLE_ERROR");
      expect(shouldSuppressForOwner(err)).toBe(false);
      const res = filterOwnerContextMessage(err);
      expect(res.allowed).toBe(true);
      expect(res.suppressed).toBe(false);
      expect(res.decision).toBe("ALLOW");
      expect(res.filteredText).toBe(err);
    }
  });

  test("passes through standard non-chatter payloads", () => {
    const standardPayloads = [
      "Here is the requested architecture summary:",
      "export interface UserProfile { id: string; name: string; }",
      "Documentation index updated with 12 sections.",
    ];
    for (const payload of standardPayloads) {
      expect(classifyChatter(payload).category).toBe("STANDARD_PAYLOAD");
      expect(shouldSuppressForOwner(payload)).toBe(false);
      const res = filterOwnerContextMessage(payload);
      expect(res.allowed).toBe(true);
      expect(res.filteredText).toBe(payload);
    }
  });

  test("filterOwnerContextMessage intercepts chatter and applies masking and telemetry", () => {
    const rawPulse = "Routine pulse: Heartbeat ping from node-01 alive and ticking";
    const resDefault = filterOwnerContextMessage(rawPulse);
    expect(resDefault.allowed).toBe(false);
    expect(resDefault.suppressed).toBe(true);
    expect(resDefault.decision).toBe("SUPPRESS");
    expect(resDefault.filteredText).toBe(DEFAULT_CHATTER_SUPPRESSION_NOTICE);
    expect(resDefault.savedTokensEstimate).toBeGreaterThan(0);
    expect(resDefault.telemetryRoute).toBe(".olt/telemetry.jsonl");

    const customSink = ".olt/custom-telemetry.jsonl";
    const resCustom = filterOwnerContextMessage(rawPulse, {
      telemetrySink: customSink,
      suppressionNotice: "[DROPPED]",
    });
    expect(resCustom.filteredText).toBe("[DROPPED]");
    expect(resCustom.telemetryRoute).toBe(customSink);

    const resUnmasked = filterOwnerContextMessage(rawPulse, {
      maskSuppressedText: false,
    });
    expect(resUnmasked.filteredText).toBe("");
  });

  test("filterOwnerContextMessage respects suppression overrides", () => {
    const pulse = "Heartbeat nominal - alive and ticking";
    const resAllowed = filterOwnerContextMessage(pulse, {
      suppressRoutinePulses: false,
    });
    expect(resAllowed.allowed).toBe(true);
    expect(resAllowed.suppressed).toBe(false);
    expect(resAllowed.filteredText).toBe(pulse);
  });

  test("assertNonChatterOwnerContext throws ROLE_CONFINEMENT_VIOLATION on owner chatter leak", () => {
    const chatter = "Routine pulse: background tick nominal";
    expect(() => assertNonChatterOwnerContext(chatter, { isOwnerSeat: true })).toThrow(
      HarnessError,
    );
    expect(() => assertNonChatterOwnerContext(chatter, { recipientRoleOrId: "owner" })).toThrow(
      HarnessError,
    );
    expect(() =>
      assertNonChatterOwnerContext(chatter, { recipientRoleOrId: "main-thread" }),
    ).toThrow(HarnessError);
    expect(() => assertNonChatterOwnerContext(chatter, { recipientRoleOrId: "stdout" })).toThrow(
      HarnessError,
    );

    try {
      assertNonChatterOwnerContext(chatter, { isOwnerSeat: true });
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("ROLE_CONFINEMENT_VIOLATION");
    }

    expect(() =>
      assertNonChatterOwnerContext(chatter, {
        isOwnerSeat: false,
        recipientRoleOrId: "worker-pool",
      }),
    ).not.toThrow();

    const deliverable = "Task completed successfully. 0 failures.";
    expect(() => assertNonChatterOwnerContext(deliverable, { isOwnerSeat: true })).not.toThrow();
  });

  test("validates argument types fail-closed", () => {
    const invalid = null as unknown as string;
    expect(() => classifyChatter(invalid)).toThrow(HarnessError);
    expect(() => filterOwnerContextMessage(invalid)).toThrow(HarnessError);
    expect(() => assertNonChatterOwnerContext(invalid)).toThrow(HarnessError);
    expect(estimateTokenSavings("")).toBe(0);
    expect(isActionableError("")).toBe(false);
    expect(isHighPriorityMilestone("")).toBe(false);
    expect(isRoutinePulse("")).toBe(false);
  });

  test("ChatterGuardEngine accumulates metrics and resets correctly", () => {
    const engine = new ChatterGuardEngine();
    const pulse = "[Pulse Tick]: heartbeat alive and ticking";
    const milestone = "[Milestone]: deliverable ready";
    const audit = "[Companion Audit]: cognitive witness observation recorded";

    engine.evaluate(pulse);
    engine.evaluate(milestone);
    engine.evaluate(audit);

    const metrics = engine.getMetrics();
    expect(metrics.totalEvaluated).toBe(3);
    expect(metrics.totalSuppressed).toBe(2);
    expect(metrics.totalAllowed).toBe(1);
    expect(metrics.suppressedBytes).toBe(pulse.length + audit.length);
    expect(metrics.estimatedSavedTokens).toBeGreaterThan(0);
    expect(metrics.suppressedByCategory.ROUTINE_PULSE).toBe(1);
    expect(metrics.suppressedByCategory.COMPANION_AUDIT).toBe(1);
    expect(metrics.suppressedByCategory.HIGH_PRIORITY_MILESTONE).toBe(0);

    engine.resetMetrics();
    const resetMetrics = engine.getMetrics();
    expect(resetMetrics.totalEvaluated).toBe(0);
    expect(resetMetrics.totalSuppressed).toBe(0);
    expect(resetMetrics.totalAllowed).toBe(0);
    expect(resetMetrics.suppressedBytes).toBe(0);
  });

  test("architecture invariants: line count <= 300 and zero comments", () => {
    const targetFile = join(process.cwd(), "olt/scripts/src/mind/chatter-guard.ts");
    const testFile = join(process.cwd(), "tests/mind/heuristics/guards/chatter-guard.test.ts");

    const targetLines = readFileSync(targetFile, "utf-8").split("\n");
    const testLines = readFileSync(testFile, "utf-8").split("\n");

    expect(targetLines.length).toBeLessThanOrEqual(300);
    expect(testLines.length).toBeLessThanOrEqual(300);

    for (const line of [...targetLines, ...testLines]) {
      const trimmed = line.trim();
      expect(trimmed.startsWith("//")).toBe(false);
      expect(trimmed.startsWith("/*")).toBe(false);
      expect(trimmed.startsWith("*")).toBe(false);
    }
  });
});
