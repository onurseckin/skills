/**
 * File-scoped unit tests for QuotaMonitor & Quota Evaluator.
 * Invariants: 0 any, 0 suppressions, <= 400 lines.
 */

import { describe, expect, it } from "bun:test";
import {
  computeAutoWakeSentinel,
  DEFAULT_FREEZE_THRESHOLD,
  DEFAULT_RECOVERY_THRESHOLD,
  evaluateQuotaState,
  extractResetTime,
  normalizePercentage,
  parseRawPercentage,
  parseResetTimeMs,
  QuotaMonitor,
  type QuotaDagSnapshot,
  type QuotaEvaluationVerdict,
  type SentinelWakeSchedule,
} from "../../../olt/scripts/src/telemetry/quota/index.ts";

describe("Quota Evaluator & Threshold Boundaries", () => {
  it("normalizes numbers and fractions accurately", () => {
    expect(normalizePercentage(9.999)).toBe(10);
    expect(normalizePercentage(9.991)).toBe(9.99);
    expect(parseRawPercentage(0.08)).toBe(8);
    expect(parseRawPercentage(0.1)).toBe(10);
    expect(parseRawPercentage(55.5)).toBe(55.5);
    expect(parseRawPercentage(undefined)).toBeUndefined();
    expect(parseRawPercentage(NaN)).toBeUndefined();
  });

  it("strictly enforces < 10.0% freeze boundary", () => {
    // 10.00% is boundary-safe (WARNING, shouldFreeze = false)
    const v10 = evaluateQuotaState(10.0);
    expect(v10.shouldFreeze).toBe(false);
    expect(v10.status).toBe("WARNING");
    expect(v10.remainingPercentage).toBe(10.0);

    // 9.99% strictly trips CRITICAL_FREEZE
    const v999 = evaluateQuotaState(9.99);
    expect(v999.shouldFreeze).toBe(true);
    expect(v999.status).toBe("CRITICAL_FREEZE");
    expect(v999.directive).toBeDefined();

    // 0.0% is exhausted
    const v0 = evaluateQuotaState(0);
    expect(v0.shouldFreeze).toBe(true);
    expect(v0.status).toBe("CRITICAL_FREEZE");

    // 25.0% is healthy
    const v25 = evaluateQuotaState(25.0);
    expect(v25.shouldFreeze).toBe(false);
    expect(v25.status).toBe("HEALTHY");
  });

  it("evaluates multi-model clusters and prioritizes binding constraint", () => {
    const multiModelReport = {
      metrics: [
        { modelName: "Model-Healthy", platformId: "gemini", remainingPercentage: 80 },
        {
          modelName: "Model-Crit",
          platformId: "claude",
          remainingPercentage: 5,
          resetTime: "2026-09-13T22:00:00.000Z",
        },
        { modelName: "Model-Unmeasured", platformId: "openai" },
      ],
    };
    const verdict = evaluateQuotaState(multiModelReport);
    expect(verdict.shouldFreeze).toBe(true);
    expect(verdict.status).toBe("CRITICAL_FREEZE");
    expect(verdict.constrainedModel?.modelName).toBe("Model-Crit");
    expect(verdict.constrainedModel?.remainingPercentage).toBe(5);
    expect(verdict.unmeasuredModels).toEqual(["Model-Unmeasured"]);
  });

  it("handles missing telemetry according to failClosed option", () => {
    const failClosedVerdict = evaluateQuotaState(null, { failClosed: true });
    expect(failClosedVerdict.shouldFreeze).toBe(true);
    expect(failClosedVerdict.status).toBe("CRITICAL_FREEZE");

    const failOpenVerdict = evaluateQuotaState(null, { failClosed: false });
    expect(failOpenVerdict.shouldFreeze).toBe(false);
    expect(failOpenVerdict.status).toBe("WARNING");
  });

  it("enforces hysteresis: stays frozen until >= 15% recovery threshold", () => {
    // Rebound to 10.5% while currently frozen -> remains frozen
    const reboundVerdict = evaluateQuotaState(10.5, undefined, { isCurrentlyFrozen: true });
    expect(reboundVerdict.shouldFreeze).toBe(true);
    expect(reboundVerdict.status).toBe("CRITICAL_FREEZE");

    // Full recovery to 15.0% -> unfreezes
    const recoveredVerdict = evaluateQuotaState(15.0, undefined, { isCurrentlyFrozen: true });
    expect(recoveredVerdict.shouldFreeze).toBe(false);
    expect(recoveredVerdict.status).toBe("WARNING");

    // Full recovery to 25.0% -> unfreezes to HEALTHY
    const healthyVerdict = evaluateQuotaState(25.0, undefined, { isCurrentlyFrozen: true });
    expect(healthyVerdict.shouldFreeze).toBe(false);
    expect(healthyVerdict.status).toBe("HEALTHY");
  });
});

describe("Auto-Wake Sentinel Scheduling", () => {
  const FIXED_NOW = new Date("2026-09-13T12:00:00.000Z").getTime();

  it("schedules one-shot timer targeting future reset time + 60s buffer", () => {
    const futureReset = new Date("2026-09-13T12:10:00.000Z").toISOString(); // +10 minutes (600s)
    const verdict: QuotaEvaluationVerdict = {
      tripped: true,
      shouldFreeze: true,
      status: "CRITICAL_FREEZE",
      remainingPercentage: 5,
      thresholdPercentage: DEFAULT_FREEZE_THRESHOLD,
      recoveryThresholdPercentage: DEFAULT_RECOVERY_THRESHOLD,
      resetTime: futureReset,
      checkedAt: new Date(FIXED_NOW).toISOString(),
    };

    const sentinel = computeAutoWakeSentinel(verdict, {
      now: FIXED_NOW,
      disableJitter: true,
      bufferSeconds: 60,
    });

    // 600s + 60s buffer = 660s
    expect(sentinel.type).toBe("one_shot_timer");
    expect(sentinel.durationSeconds).toBe(660);
    expect(sentinel.targetWakeupIso).toBe(new Date(FIXED_NOW + 660 * 1000).toISOString());
    expect(sentinel.fallbackUsed).toBeUndefined();
  });

  it("handles near-term clock skew by scheduling for buffer seconds (60s)", () => {
    // Reset time is 30s in the past (<= 300s clock skew)
    const pastReset = new Date(FIXED_NOW - 30 * 1000).toISOString();
    const verdict: QuotaEvaluationVerdict = {
      tripped: true,
      shouldFreeze: true,
      status: "CRITICAL_FREEZE",
      remainingPercentage: 2,
      thresholdPercentage: DEFAULT_FREEZE_THRESHOLD,
      recoveryThresholdPercentage: DEFAULT_RECOVERY_THRESHOLD,
      resetTime: pastReset,
      checkedAt: new Date(FIXED_NOW).toISOString(),
    };

    const sentinel = computeAutoWakeSentinel(verdict, {
      now: FIXED_NOW,
      disableJitter: true,
      bufferSeconds: 60,
    });

    expect(sentinel.durationSeconds).toBe(60);
    expect(sentinel.fallbackUsed).toBeUndefined();
  });

  it("rejects severely stale reset timestamps and falls back to safe window (5h + 60s)", () => {
    // Reset time is 10 minutes in the past (> 300s stale)
    const staleReset = new Date(FIXED_NOW - 600 * 1000).toISOString();
    const verdict: QuotaEvaluationVerdict = {
      tripped: true,
      shouldFreeze: true,
      status: "CRITICAL_FREEZE",
      remainingPercentage: 0,
      thresholdPercentage: DEFAULT_FREEZE_THRESHOLD,
      recoveryThresholdPercentage: DEFAULT_RECOVERY_THRESHOLD,
      resetTime: staleReset,
      checkedAt: new Date(FIXED_NOW).toISOString(),
    };

    const sentinel = computeAutoWakeSentinel(verdict, {
      now: FIXED_NOW,
      disableJitter: true,
      safeWindowSeconds: 18000,
      bufferSeconds: 60,
    });

    // 18000 + 60 = 18060
    expect(sentinel.durationSeconds).toBe(18060);
    expect(sentinel.fallbackUsed).toBe(true);
  });

  it("clamps anti-thundering-herd jitter within max boundaries", () => {
    const verdict: QuotaEvaluationVerdict = {
      tripped: true,
      shouldFreeze: true,
      status: "CRITICAL_FREEZE",
      remainingPercentage: 0,
      thresholdPercentage: DEFAULT_FREEZE_THRESHOLD,
      recoveryThresholdPercentage: DEFAULT_RECOVERY_THRESHOLD,
      checkedAt: new Date(FIXED_NOW).toISOString(),
    };

    const sentinel = computeAutoWakeSentinel(verdict, {
      now: FIXED_NOW,
      enableJitter: true,
      jitterSeconds: 450, // exceeds 300 max
      maxJitterSeconds: 300,
      safeWindowSeconds: 1000,
      bufferSeconds: 60,
    });

    expect(sentinel.jitterSeconds).toBe(300);
    expect(sentinel.durationSeconds).toBe(1060 + 300);
  });
});

describe("QuotaMonitor Lifecycle & Zero-Kill Invariant", () => {
  it("manages state transitions, freezes gracefully on < 10%, and emits mailbox events silently", async () => {
    let freezeNotified = false;
    let resumeNotified = false;
    const mailboxEvents: { channel: string; event: string }[] = [];

    let currentQuota = 80; // start healthy
    const monitor = new QuotaMonitor({
      storageDir: ":memory:",
      cadenceMs: 50,
      quotaProvider: () => currentQuota,
      onFreeze: () => {
        freezeNotified = true;
      },
      onResume: () => {
        resumeNotified = true;
      },
      onMailboxEmit: (channel, payload) => {
        mailboxEvents.push({ channel, event: String(payload["event"]) });
      },
    });

    // 1. Initial status
    const status1 = monitor.getStatus();
    expect(status1.state).toBe("IDLE");
    expect(status1.isFrozen).toBe(false);

    // 2. First tick (healthy at 80%)
    const v1 = await monitor.tick();
    expect(v1.status).toBe("HEALTHY");
    expect(monitor.getStatus().isFrozen).toBe(false);
    expect(freezeNotified).toBe(false);

    // 3. Quota drops below 10% (5%) -> triggers freeze transition
    currentQuota = 5;
    const v2 = await monitor.tick();
    expect(v2.shouldFreeze).toBe(true);
    expect(v2.status).toBe("CRITICAL_FREEZE");
    expect(monitor.getStatus().isFrozen).toBe(true);
    expect(monitor.getStatus().state).toBe("FROZEN");
    expect(freezeNotified).toBe(true);

    // Verify Mailbox IPC emitted silently
    expect(
      mailboxEvents.some(
        (e) => e.channel === "quota:freeze" && e.event === "QUOTA_FREEZE_ACTIVATED",
      ),
    ).toBe(true);

    // Verify DAG snapshot persisted with zero-kill state
    const snap = monitor.getSnapshot();
    expect(snap).toBeDefined();
    expect(snap?.status).toBe("active_freeze");
    expect(snap?.remainingQuotaPercentage).toBe(5);

    // 4. Sub-recovery to 11% while frozen -> stays frozen (hysteresis)
    currentQuota = 11;
    const v3 = await monitor.tick();
    expect(v3.shouldFreeze).toBe(true);
    expect(monitor.getStatus().isFrozen).toBe(true);

    // 5. Full recovery to 20% -> triggers resume transition
    currentQuota = 20;
    const v4 = await monitor.tick();
    expect(v4.shouldFreeze).toBe(false);
    expect(monitor.getStatus().isFrozen).toBe(false);
    expect(monitor.getStatus().state).toBe("MONITORING");
    expect(resumeNotified).toBe(true);

    // Verify snapshot updated to status: "resumed"
    const resumedSnap = monitor.getSnapshot();
    expect(resumedSnap).toBeDefined();
    expect(resumedSnap?.status).toBe("resumed");
    expect(resumedSnap?.resumedAt).toBeDefined();

    // Verify Mailbox IPC resume emitted
    expect(
      mailboxEvents.some((e) => e.channel === "quota:resume" && e.event === "QUOTA_FREEZE_RESUMED"),
    ).toBe(true);

    monitor.stop();
    expect(monitor.getStatus().state).toBe("STOPPED");
  });
});
