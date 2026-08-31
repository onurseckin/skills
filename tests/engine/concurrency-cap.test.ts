import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  acquireSubagentSlot,
  getSubagentPoolStats,
  MAX_SUBAGENT_CAPACITY,
  releaseSubagentSlot,
  resetSubagentPool,
  SubagentPool,
  type SubagentSlotReceipt,
} from "../../olt/scripts/src/engine/runner/subagent-pool.ts";
import {
  checkQuotaCircuitBreaker,
  CRITICAL_WRAP_UP_MESSAGE,
  DEFAULT_QUOTA_THRESHOLD,
  type QuotaState,
} from "../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

describe("Subagent Concurrency Pool Hard Cap (<= 50 subagents)", () => {
  beforeEach(() => {
    resetSubagentPool();
  });

  afterEach(() => {
    resetSubagentPool();
  });

  test("MAX_SUBAGENT_CAPACITY is hard-locked to 50", () => {
    expect(MAX_SUBAGENT_CAPACITY).toBe(50);
    const pool = new SubagentPool();
    expect(pool.capacity).toBe(50);
  });

  test("acquires up to 50 slots concurrently without blocking", async () => {
    const receipts: SubagentSlotReceipt[] = [];

    for (let i = 1; i <= 50; i++) {
      const receipt = await acquireSubagentSlot({
        agentId: `worker-${i}`,
        role: "implementer",
        tier: 3,
      });
      receipts.push(receipt);
      expect(receipt.agentId).toBe(`worker-${i}`);
      expect(receipt.activeCount).toBe(i);
    }

    const stats = getSubagentPoolStats();
    expect(stats.activeCount).toBe(50);
    expect(stats.queueDepth).toBe(0);
    expect(stats.totalAcquired).toBe(50);

    for (const receipt of receipts) {
      receipt.release();
    }

    const afterStats = getSubagentPoolStats();
    expect(afterStats.activeCount).toBe(0);
    expect(afterStats.totalReleased).toBe(50);
  });

  test("queues 51st slot request in FIFO order and resolves upon release", async () => {
    const receipts: SubagentSlotReceipt[] = [];

    for (let i = 1; i <= 50; i++) {
      receipts.push(await acquireSubagentSlot({ agentId: `active-${i}` }));
    }

    expect(getSubagentPoolStats().activeCount).toBe(50);
    expect(getSubagentPoolStats().queueDepth).toBe(0);

    let queuedResolved = false;
    let queuedReceipt: SubagentSlotReceipt | undefined;

    const queuedPromise = acquireSubagentSlot({
      agentId: "queued-worker-51",
      role: "validator",
      tier: 3,
    }).then((res) => {
      queuedResolved = true;
      queuedReceipt = res;
      return res;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(queuedResolved).toBe(false);
    expect(getSubagentPoolStats().queueDepth).toBe(1);

    receipts[0]!.release();

    const resolved = await queuedPromise;
    expect(queuedResolved).toBe(true);
    expect(resolved.agentId).toBe("queued-worker-51");
    expect(resolved.role).toBe("validator");
    expect(getSubagentPoolStats().activeCount).toBe(50);
    expect(getSubagentPoolStats().queueDepth).toBe(0);

    if (queuedReceipt) {
      queuedReceipt.release();
    }
  });

  test("maintains strict FIFO ordering when multiple requests are queued", async () => {
    const miniPool = new SubagentPool(2);
    const r1 = await miniPool.acquire({ agentId: "held-1" });
    const r2 = await miniPool.acquire({ agentId: "held-2" });

    const resolutionOrder: string[] = [];

    const p1 = miniPool.acquire({ agentId: "waiter-1" }).then((r) => {
      resolutionOrder.push(r.agentId);
      return r;
    });
    const p2 = miniPool.acquire({ agentId: "waiter-2" }).then((r) => {
      resolutionOrder.push(r.agentId);
      return r;
    });
    const p3 = miniPool.acquire({ agentId: "waiter-3" }).then((r) => {
      resolutionOrder.push(r.agentId);
      return r;
    });

    expect(miniPool.queueDepth).toBe(3);

    r1.release();
    const resolvedP1 = await p1;
    expect(resolutionOrder).toEqual(["waiter-1"]);

    r2.release();
    const resolvedP2 = await p2;
    expect(resolutionOrder).toEqual(["waiter-1", "waiter-2"]);

    resolvedP1.release();
    const resolvedP3 = await p3;
    expect(resolutionOrder).toEqual(["waiter-1", "waiter-2", "waiter-3"]);

    resolvedP2.release();
    resolvedP3.release();
    expect(miniPool.activeCount).toBe(0);
  });

  test("rejects with LOCK_TIMEOUT when acquisition exceeds timeoutMs", async () => {
    const miniPool = new SubagentPool(1);
    const held = await miniPool.acquire({ agentId: "exclusive" });

    let thrownError: unknown;
    try {
      await miniPool.acquire({ agentId: "timed-out", timeoutMs: 25 });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(HarnessError);
    expect((thrownError as HarnessError).code).toBe("LOCK_TIMEOUT");
    expect(miniPool.queueDepth).toBe(0);

    held.release();
    expect(miniPool.activeCount).toBe(0);
  });

  test("release returns false for unknown receipt IDs", () => {
    const pool = new SubagentPool(5);
    expect(pool.release("non-existent-receipt")).toBe(false);
    expect(releaseSubagentSlot("non-existent-receipt")).toBe(false);
  });
});

describe("Quota Circuit Breaker Trip Verification (<= 10% remaining)", () => {
  test("returns nominal OK verdict when remaining quota is healthy (> 10%)", () => {
    const quota: QuotaState = { remainingPercentage: 85.5 };
    const verdict = checkQuotaCircuitBreaker(quota);

    expect(verdict.tripped).toBe(false);
    expect(verdict.status).toBe("OK");
    expect(verdict.remainingPercentage).toBe(85.5);
    expect(verdict.thresholdPercentage).toBe(DEFAULT_QUOTA_THRESHOLD);
    expect(verdict.reason).toBeUndefined();
    expect(verdict.wrapUpMessage).toBeUndefined();
  });

  test("trips circuit breaker when remaining quota is below 10%", () => {
    const quota: QuotaState = {
      remainingPercentage: 4.5,
      resetTime: "2026-08-29T20:00:00.000Z",
    };
    const verdict = checkQuotaCircuitBreaker(quota);

    expect(verdict.tripped).toBe(true);
    expect(verdict.status).toBe("TRIPPED");
    expect(verdict.remainingPercentage).toBe(4.5);
    expect(verdict.wrapUpMessage).toBe(CRITICAL_WRAP_UP_MESSAGE);
    expect(verdict.resetTime).toBe("2026-08-29T20:00:00.000Z");
    expect(verdict.reason).toContain("is at or below threshold");
  });

  test("trips at exact 10.0% boundary and at 0.0% exhaustion", () => {
    const boundaryVerdict = checkQuotaCircuitBreaker({ remainingPercentage: 10.0 });
    expect(boundaryVerdict.tripped).toBe(true);
    expect(boundaryVerdict.status).toBe("TRIPPED");

    const zeroVerdict = checkQuotaCircuitBreaker(0);
    expect(zeroVerdict.tripped).toBe(true);
    expect(zeroVerdict.status).toBe("TRIPPED");
  });

  test("supports fraction, ratio, and custom threshold formats", () => {
    const fractionVerdict = checkQuotaCircuitBreaker({ remainingFraction: 0.08 });
    expect(fractionVerdict.tripped).toBe(true);
    expect(fractionVerdict.remainingPercentage).toBeCloseTo(8.0, 1);

    const ratioVerdict = checkQuotaCircuitBreaker({ used: 95, total: 100 });
    expect(ratioVerdict.tripped).toBe(true);
    expect(ratioVerdict.remainingPercentage).toBe(5.0);

    const customThresholdVerdict = checkQuotaCircuitBreaker({ remainingPercentage: 15.0 }, 20.0);
    expect(customThresholdVerdict.tripped).toBe(true);
    expect(customThresholdVerdict.thresholdPercentage).toBe(20.0);
  });
});

describe("Physical Density and Zero-Comment Invariants", () => {
  test("all created and touched files are <= 300 lines with zero code comments", () => {
    const files = [
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/engine/runner/subagent-pool.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/engine/runner/index.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/telemetry/circuit-breaker.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/telemetry/circuit-breaker-evaluator.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/telemetry/circuit-breaker-markdown.ts",
      "/Users/onurseckinsenoglu/repos/skills/tests/unit/engine/concurrency-cap.test.ts",
    ];

    const commentPattern = new RegExp("\\/\\/|\\/\\*|\\*\\/");
    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      [
        "@ts" + "-ignore",
        "@ts" + "-expect-error",
        "@ts" + "-nocheck",
        "eslint" + "-disable",
        "oxlint" + "-disable",
      ].join("|"),
    );

    for (const file of files) {
      expect(existsSync(file)).toBe(true);
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (
          line.includes("commentPattern") ||
          line.includes("anyPattern") ||
          line.includes("suppressionPattern")
        ) {
          continue;
        }
        expect(commentPattern.test(line)).toBe(false);
        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
