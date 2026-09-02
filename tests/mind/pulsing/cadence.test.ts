import { describe, expect, it, spyOn, afterEach } from "bun:test";
import * as evaluatorModule from "../../../olt/scripts/src/mind/pulsing/evaluator.ts";
import * as badgesModule from "../../../olt/scripts/src/mind/pulsing/badges.ts";
import * as markdownModule from "../../../olt/scripts/src/telemetry/circuit-breaker-markdown.ts";
import * as snapshotModule from "../../../olt/scripts/src/telemetry/snapshot/index.ts";
import {
  managePulseSupervisoryCadence,
  PULSE_WRAP_UP_DIRECTIVES,
} from "../../../olt/scripts/src/mind/pulsing/cadence.ts";
import type {
  PulseQuotaEvaluation,
  PulseSupervisoryCadenceOptions,
} from "../../../olt/scripts/src/mind/pulsing/types.ts";
import type { CircuitBreakerEvaluation } from "../../../olt/scripts/src/telemetry/circuit-breaker-evaluator.ts";
import type { DagExecutionSnapshot } from "../../../olt/scripts/src/telemetry/snapshot/types.ts";

describe("Mind Pulsing Cadence Coverage Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  const baseEval: PulseQuotaEvaluation = {
    activeHost: "host-alpha",
    status: "nominal",
    isCircuitBreakerTripped: false,
    lowestRemainingQuota: 85,
    thresholdPercentage: 20,
    constrainedModels: [],
    metrics: [],
    checkedAt: "2026-09-01T12:00:00.000Z",
    warningMessages: [],
  };

  it("exports valid pulse wrap-up directives array", () => {
    expect(PULSE_WRAP_UP_DIRECTIVES).toHaveLength(4);
    expect(PULSE_WRAP_UP_DIRECTIVES[0]).toContain("Wrap up current micro-step immediately");
    expect(PULSE_WRAP_UP_DIRECTIVES[2]).toContain("Non-Destructive Invariant");
  });

  it("manages nominal supervisory cadence without freezing", async () => {
    let capturedOptions: unknown = null;
    spies.push(
      spyOn(evaluatorModule, "evaluateMindPulseQuota").mockImplementation(async (opts) => {
        capturedOptions = opts;
        return baseEval;
      }),
    );
    spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(false));

    const options: PulseSupervisoryCadenceOptions = {
      runRoot: "/virtual/run-root",
      actor: "pulsar",
      host: "host-alpha",
      baseIntervalMs: 30000,
      thresholdPercentage: 15,
      forceProbe: true,
    };

    const result = await managePulseSupervisoryCadence(options);
    expect(result.shouldFreeze).toBe(false);
    expect(result.nextScheduledIntervalMs).toBe(30000);
    expect(result.wrapUpDirectives).toEqual([]);
    expect(result.snapshotCaptured).toBe(false);
    expect(result.snapshotPath).toBeUndefined();
    expect(result.bannerMarkdown).toContain("HOST: host-alpha");
    expect(capturedOptions).toEqual({
      runRoot: "/virtual/run-root",
      actor: "pulsar",
      host: "host-alpha",
      thresholdPercentage: 15,
      forceProbe: true,
      cachedReport: undefined,
    });
  });

  it("freezes with circuit breaker evaluation and autoWake schedule, persisting snapshot", async () => {
    const cbEval: CircuitBreakerEvaluation = {
      isTriggered: true,
      lowestRemainingQuota: 5,
      thresholdPercentage: 10,
      status: "critical",
      constrainedModels: [],
      summary: "Critically low quota",
      wrapUpDirectives: [],
    };
    const freezeEval: PulseQuotaEvaluation = {
      ...baseEval,
      status: "critical",
      isCircuitBreakerTripped: true,
      lowestRemainingQuota: 5,
      constrainedModels: ["model-x"],
      circuitBreakerEvaluation: cbEval,
      autoWakeSchedule: {
        durationSeconds: 90,
        targetWakeupIso: "2026-09-01T12:01:30.000Z",
        reason: "quota_reset",
      },
    };

    spies.push(spyOn(evaluatorModule, "evaluateMindPulseQuota").mockResolvedValue(freezeEval));
    spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(true));
    spies.push(
      spyOn(snapshotModule, "captureDagSnapshot").mockResolvedValue({} as DagExecutionSnapshot),
    );
    spies.push(
      spyOn(snapshotModule, "persistDagSnapshot").mockReturnValue("/snapshots/snap-freeze.json"),
    );

    const result = await managePulseSupervisoryCadence({
      runRoot: "/virtual/run-root",
      repoRoot: "/virtual/repo-root",
      baseIntervalMs: 15000,
      captureSnapshotOnFreeze: true,
    });

    expect(result.shouldFreeze).toBe(true);
    expect(result.wrapUpDirectives).toEqual([...PULSE_WRAP_UP_DIRECTIVES]);
    expect(result.nextScheduledIntervalMs).toBe(90000);
    expect(result.nextWakeAt).toBe("2026-09-01T12:01:30.000Z");
    expect(result.snapshotCaptured).toBe(true);
    expect(result.snapshotPath).toBe("/snapshots/snap-freeze.json");
    expect(result.bannerMarkdown).toContain("CIRCUIT-BREAKER");
  });

  it("freezes without circuit breaker and clamps interval to minimum 60s without schedule", async () => {
    const freezeEvalNoSchedule: PulseQuotaEvaluation = {
      ...baseEval,
      status: "critical",
      isCircuitBreakerTripped: true,
      lowestRemainingQuota: 8,
    };

    spies.push(
      spyOn(evaluatorModule, "evaluateMindPulseQuota").mockResolvedValue(freezeEvalNoSchedule),
    );
    spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(true));
    spies.push(
      spyOn(snapshotModule, "captureDagSnapshot").mockResolvedValue({} as DagExecutionSnapshot),
    );
    spies.push(
      spyOn(snapshotModule, "persistDagSnapshot").mockReturnValue("/snapshots/default-cwd.json"),
    );

    const resultLowBase = await managePulseSupervisoryCadence({
      runRoot: "/virtual/run-root",
      repoRoot: "",
      baseIntervalMs: 10000,
    });
    expect(resultLowBase.nextScheduledIntervalMs).toBe(60000);
    expect(resultLowBase.snapshotCaptured).toBe(true);
    expect(resultLowBase.snapshotPath).toBe("/snapshots/default-cwd.json");

    const resultHighBase = await managePulseSupervisoryCadence({
      runRoot: "/virtual/run-root",
      baseIntervalMs: 120000,
      captureSnapshotOnFreeze: false,
    });
    expect(resultHighBase.nextScheduledIntervalMs).toBe(120000);
    expect(resultHighBase.snapshotCaptured).toBe(false);
    expect(resultHighBase.snapshotPath).toBeUndefined();
  });

  it("catches snapshot capture errors gracefully and marks snapshotCaptured false", async () => {
    const freezeEval: PulseQuotaEvaluation = {
      ...baseEval,
      status: "critical",
      isCircuitBreakerTripped: true,
    };

    spies.push(spyOn(evaluatorModule, "evaluateMindPulseQuota").mockResolvedValue(freezeEval));
    spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(true));
    spies.push(
      spyOn(snapshotModule, "captureDagSnapshot").mockRejectedValue(new Error("Disk IO Error")),
    );

    const result = await managePulseSupervisoryCadence({
      runRoot: "/virtual/run-root",
      baseIntervalMs: 60000,
    });

    expect(result.shouldFreeze).toBe(true);
    expect(result.snapshotCaptured).toBe(false);
    expect(result.snapshotPath).toBeUndefined();
  });
});
