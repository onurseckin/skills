import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as evaluatorModule from "../../../../olt/scripts/src/mind/pulsing/evaluator.ts";
import * as snapshotModule from "../../../../olt/scripts/src/telemetry/snapshot/index.ts";
import {
  managePulseSupervisoryCadence,
  PULSE_WRAP_UP_DIRECTIVES,
} from "../../../../olt/scripts/src/mind/pulsing/cadence.ts";
import type {
  PulseQuotaEvaluation,
  PulseSupervisoryCadenceOptions,
} from "../../../../olt/scripts/src/mind/pulsing/types.ts";
import type { CircuitBreakerEvaluation } from "../../../../olt/scripts/src/telemetry/circuit-breaker-evaluator.ts";
import {
  cleanupVirtualMindFS,
  scratchRoot,
  setupVirtualMindFS,
} from "../../fixtures/mind-fixture.ts";

describe("Mind Assembly Pulse Supervisory Cadence Suite", () => {
  let testDir: string;
  const spies: Array<{ mockRestore: () => void }> = [];

  const baseEval: PulseQuotaEvaluation = {
    activeHost: "host-gamma",
    status: "nominal",
    isCircuitBreakerTripped: false,
    lowestRemainingQuota: 88,
    thresholdPercentage: 20,
    constrainedModels: [],
    metrics: [],
    checkedAt: "2026-09-01T12:00:00.000Z",
    warningMessages: [],
  };

  beforeEach(() => {
    setupVirtualMindFS();
    testDir = scratchRoot("supervisory-cadence");
  });

  afterEach(() => {
    for (const s of spies) s.mockRestore();
    spies.length = 0;
    cleanupVirtualMindFS();
  });

  describe("PULSE_WRAP_UP_DIRECTIVES Invariants", () => {
    it("exports 4 immutable non-destructive wrap-up directives", () => {
      expect(PULSE_WRAP_UP_DIRECTIVES).toHaveLength(4);
      expect(PULSE_WRAP_UP_DIRECTIVES[0]).toContain("Wrap up current micro-step immediately");
      expect(PULSE_WRAP_UP_DIRECTIVES[1]).toContain("Preserve working tree changes");
      expect(PULSE_WRAP_UP_DIRECTIVES[2]).toContain(
        "Non-Destructive Invariant: Do NOT kill active subagents",
      );
      expect(PULSE_WRAP_UP_DIRECTIVES[3]).toContain("IDLE state in memory");
    });
  });

  describe("Nominal Cadence Management", () => {
    it("handles nominal quota without triggering freeze or directives", async () => {
      spies.push(spyOn(evaluatorModule, "evaluateMindPulseQuota").mockResolvedValue(baseEval));
      spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(false));

      const opts: PulseSupervisoryCadenceOptions = {
        runRoot: testDir,
        actor: "pulsar-cadence",
        host: "host-gamma",
        baseIntervalMs: 45_000,
        thresholdPercentage: 20,
      };

      const result = await managePulseSupervisoryCadence(opts);
      expect(result.shouldFreeze).toBe(false);
      expect(result.nextScheduledIntervalMs).toBe(45_000);
      expect(result.wrapUpDirectives).toHaveLength(0);
      expect(result.snapshotCaptured).toBe(false);
      expect(result.snapshotPath).toBeUndefined();
      expect(result.bannerMarkdown).toContain("HOST: host-gamma");
      expect(result.badges).toBeDefined();
    });

    it("handles warning quota state without freezing while rendering warning banner", async () => {
      const warnEval: PulseQuotaEvaluation = {
        ...baseEval,
        status: "warning",
        lowestRemainingQuota: 18,
        warningMessages: ["Quota is approaching threshold"],
      };
      spies.push(spyOn(evaluatorModule, "evaluateMindPulseQuota").mockResolvedValue(warnEval));
      spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(false));

      const opts: PulseSupervisoryCadenceOptions = {
        runRoot: testDir,
        actor: "pulsar-cadence",
        host: "host-gamma",
        baseIntervalMs: 45_000,
        thresholdPercentage: 20,
      };

      const result = await managePulseSupervisoryCadence(opts);
      expect(result.shouldFreeze).toBe(false);
      expect(result.wrapUpDirectives).toHaveLength(0);
      expect(result.snapshotCaptured).toBe(false);
      expect(result.bannerMarkdown).toContain("HOST: host-gamma");
    });

    it("falls back to process.cwd() gracefully when repoRoot is omitted in options", async () => {
      spies.push(spyOn(evaluatorModule, "evaluateMindPulseQuota").mockResolvedValue(baseEval));
      spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(false));

      const opts: PulseSupervisoryCadenceOptions = {
        runRoot: testDir,
        actor: "pulsar-cadence",
        host: "host-gamma",
        baseIntervalMs: 30_000,
        thresholdPercentage: 20,
      };

      const result = await managePulseSupervisoryCadence(opts);
      expect(result.shouldFreeze).toBe(false);
      expect(result.nextScheduledIntervalMs).toBe(30_000);
    });
  });

  describe("Freeze Cadence with Circuit Breaker and Schedule", () => {
    it("freezes cadence, populates directives, and schedules next wake from autoWakeSchedule", async () => {
      const cbEval: CircuitBreakerEvaluation = {
        isTriggered: true,
        lowestRemainingQuota: 4,
        thresholdPercentage: 15,
        status: "QUOTA_EXHAUSTED_CIRCUIT_BROKEN",
        constrainedModels: [
          {
            platformId: "anthropic",
            modelName: "claude-3-opus",
            remainingPercentage: 4,
            resetTime: "2026-09-01T12:02:00.000Z",
          },
        ],
        summary: "Quota depletion alert",
        wrapUpDirectives: [],
        autoWakeSchedule: null,
        evaluatedAt: "2026-09-01T12:00:00.000Z",
      };

      const freezeEval: PulseQuotaEvaluation = {
        ...baseEval,
        status: "critical",
        isCircuitBreakerTripped: true,
        lowestRemainingQuota: 4,
        constrainedModels: ["claude-3-opus"],
        circuitBreakerEvaluation: cbEval,
        autoWakeSchedule: {
          durationSeconds: 120,
          targetWakeupIso: "2026-09-01T12:02:00.000Z",
          reason: "quota_reset",
        },
      };

      spies.push(spyOn(evaluatorModule, "evaluateMindPulseQuota").mockResolvedValue(freezeEval));
      spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(true));
      spies.push(
        spyOn(snapshotModule, "captureDagSnapshot").mockResolvedValue({
          version: "2",
          repositoryRoot: testDir,
          runRoot: testDir,
          frozenAt: "2026-09-01T12:00:00.000Z",
          status: "frozen",
          tasks: [],
          agents: [],
          cronsSuspended: [],
          uncommittedFiles: [],
          lowestQuotaObserved: 4,
          constrainedModels: ["claude-3-opus"],
          autoWakeSchedule: {
            resetTime: "2026-09-01T12:02:00.000Z",
            resumeTime: "2026-09-01T12:02:30.000Z",
          },
        }),
      );
      spies.push(
        spyOn(snapshotModule, "persistDagSnapshot").mockReturnValue("/snapshots/snap-1.json"),
      );

      const opts: PulseSupervisoryCadenceOptions = {
        runRoot: testDir,
        actor: "pulsar-cadence",
        host: "host-gamma",
        baseIntervalMs: 30_000,
        thresholdPercentage: 20,
        captureSnapshotOnFreeze: true,
      };

      const result = await managePulseSupervisoryCadence(opts);
      expect(result.shouldFreeze).toBe(true);
      expect(result.nextScheduledIntervalMs).toBe(120_000);
      expect(result.nextWakeAt).toBe("2026-09-01T12:02:00.000Z");
      expect(result.wrapUpDirectives).toHaveLength(4);
      expect(result.snapshotCaptured).toBe(true);
      expect(result.snapshotPath).toBe("/snapshots/snap-1.json");
      expect(result.bannerMarkdown).toBeDefined();
    });
  });

  describe("Freeze Cadence Minimum Interval Clamping", () => {
    it("clamps next interval to minimum 60_000ms when autoWakeSchedule is absent", async () => {
      const freezeEvalNoSchedule: PulseQuotaEvaluation = {
        ...baseEval,
        status: "critical",
        isCircuitBreakerTripped: true,
        lowestRemainingQuota: 2,
        constrainedModels: ["gpt-4-turbo"],
      };

      spies.push(
        spyOn(evaluatorModule, "evaluateMindPulseQuota").mockResolvedValue(freezeEvalNoSchedule),
      );
      spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(true));

      const opts: PulseSupervisoryCadenceOptions = {
        runRoot: testDir,
        actor: "pulsar-cadence",
        host: "host-gamma",
        baseIntervalMs: 15_000,
        thresholdPercentage: 20,
        captureSnapshotOnFreeze: false,
      };

      const result = await managePulseSupervisoryCadence(opts);
      expect(result.shouldFreeze).toBe(true);
      expect(result.nextScheduledIntervalMs).toBe(60_000);
      expect(result.wrapUpDirectives).toHaveLength(4);
      expect(result.snapshotCaptured).toBe(false);
    });

    it("respects baseIntervalMs when baseIntervalMs exceeds 60_000ms without autoWakeSchedule", async () => {
      const freezeEvalNoSchedule: PulseQuotaEvaluation = {
        ...baseEval,
        status: "critical",
        isCircuitBreakerTripped: true,
        lowestRemainingQuota: 2,
      };

      spies.push(
        spyOn(evaluatorModule, "evaluateMindPulseQuota").mockResolvedValue(freezeEvalNoSchedule),
      );
      spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(true));

      const opts: PulseSupervisoryCadenceOptions = {
        runRoot: testDir,
        actor: "pulsar-cadence",
        host: "host-gamma",
        baseIntervalMs: 180_000,
        thresholdPercentage: 20,
        captureSnapshotOnFreeze: false,
      };

      const result = await managePulseSupervisoryCadence(opts);
      expect(result.shouldFreeze).toBe(true);
      expect(result.nextScheduledIntervalMs).toBe(180_000);
    });
  });
});
