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
} from "../../../olt/scripts/src/engine/runner/subagent-pool.ts";
import {
  checkQuotaCircuitBreaker,
  CRITICAL_WRAP_UP_MESSAGE,
} from "../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualEngineFS, setupVirtualEngineFS } from "../fixture.ts";

describe("Subagent Concurrency Pool Hard Cap (<= 50 subagents)", () => {
  beforeEach(() => {
    setupVirtualEngineFS();
    resetSubagentPool();
  });
  afterEach(() => {
    resetSubagentPool();
    cleanupVirtualEngineFS();
  });

  test("MAX_SUBAGENT_CAPACITY is hard-locked to 50", () => {
    expect(MAX_SUBAGENT_CAPACITY).toBe(50);
    expect(new SubagentPool().capacity).toBe(50);
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
    expect(getSubagentPoolStats().activeCount).toBe(50);
    expect(getSubagentPoolStats().queueDepth).toBe(0);
    expect(getSubagentPoolStats().totalAcquired).toBe(50);

    for (const receipt of receipts) receipt.release();
    expect(getSubagentPoolStats().activeCount).toBe(0);
    expect(getSubagentPoolStats().totalReleased).toBe(50);
  });

  test("queues 51st slot request in FIFO order and resolves upon release", async () => {
    const receipts: SubagentSlotReceipt[] = [];
    for (let i = 1; i <= 50; i++) {
      receipts.push(
        await acquireSubagentSlot({ agentId: `worker-${i}`, role: "implementer", tier: 3 }),
      );
    }

    let queuedResolved = false;
    let queuedReceipt: SubagentSlotReceipt | null = null;
    const queuedPromise = acquireSubagentSlot({
      agentId: "worker-51-queued",
      role: "task_implementer",
      tier: 3,
    }).then((rcpt) => {
      queuedResolved = true;
      queuedReceipt = rcpt;
      return rcpt;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(queuedResolved).toBe(false);
    expect(getSubagentPoolStats().queueDepth).toBe(1);

    receipts[0]!.release();
    await queuedPromise;

    expect(queuedResolved).toBe(true);
    expect(queuedReceipt!.agentId).toBe("worker-51-queued");
    expect(getSubagentPoolStats().queueDepth).toBe(0);

    for (let i = 1; i < receipts.length; i++) receipts[i]!.release();
    queuedReceipt!.release();
    expect(getSubagentPoolStats().activeCount).toBe(0);
  });

  test("maintains strict FIFO ordering when multiple requests are queued", async () => {
    const receipts: SubagentSlotReceipt[] = [];
    for (let i = 1; i <= 50; i++) {
      receipts.push(
        await acquireSubagentSlot({ agentId: `worker-${i}`, role: "implementer", tier: 3 }),
      );
    }
    const resolvedOrder: string[] = [];
    const p1 = acquireSubagentSlot({ agentId: "q1", role: "worker", tier: 3 }).then((r) => {
      resolvedOrder.push(r.agentId);
      return r;
    });
    const p2 = acquireSubagentSlot({ agentId: "q2", role: "worker", tier: 3 }).then((r) => {
      resolvedOrder.push(r.agentId);
      return r;
    });
    const p3 = acquireSubagentSlot({ agentId: "q3", role: "worker", tier: 3 }).then((r) => {
      resolvedOrder.push(r.agentId);
      return r;
    });
    expect(getSubagentPoolStats().queueDepth).toBe(3);
    receipts[0]!.release();
    const r1 = await p1;
    expect(resolvedOrder).toEqual(["q1"]);
    receipts[1]!.release();
    const r2 = await p2;
    expect(resolvedOrder).toEqual(["q1", "q2"]);
    receipts[2]!.release();
    const r3 = await p3;
    expect(resolvedOrder).toEqual(["q1", "q2", "q3"]);
    for (let i = 3; i < receipts.length; i++) receipts[i]!.release();
    r1.release();
    r2.release();
    r3.release();
  });

  test("rejects with LOCK_TIMEOUT when acquisition exceeds timeoutMs", async () => {
    const receipts: SubagentSlotReceipt[] = [];
    for (let i = 1; i <= 50; i++)
      receipts.push(
        await acquireSubagentSlot({ agentId: `worker-${i}`, role: "implementer", tier: 3 }),
      );
    let errorCaught: unknown = null;
    try {
      await acquireSubagentSlot({
        agentId: "timeout-worker",
        role: "worker",
        tier: 3,
        timeoutMs: 25,
      });
    } catch (err) {
      errorCaught = err;
    }
    expect(errorCaught).toBeInstanceOf(HarnessError);
    expect((errorCaught as HarnessError).code).toBe("LOCK_TIMEOUT");
    for (const receipt of receipts) receipt.release();
  });

  test("release returns false for unknown receipt IDs", () => {
    expect(releaseSubagentSlot("non-existent-receipt-id")).toBe(false);
  });
});

describe("Quota Circuit Breaker Trip Verification (<= 10% remaining)", () => {
  test("returns nominal OK verdict when remaining quota is healthy (> 10%)", () => {
    const verdict50 = checkQuotaCircuitBreaker({ remainingPercentage: 50.0 });
    expect(verdict50.tripped).toBe(false);
    expect(verdict50.status).toBe("OK");
    expect(verdict50.remainingPercentage).toBe(50.0);
    expect(verdict50.thresholdPercentage).toBe(10.0);

    const verdict10point1 = checkQuotaCircuitBreaker({ remainingPercentage: 10.1 });
    expect(verdict10point1.tripped).toBe(false);
    expect(verdict10point1.status).toBe("OK");
  });

  test("trips circuit breaker when remaining quota is below 10%", () => {
    const verdict9 = checkQuotaCircuitBreaker({ remainingPercentage: 9.9 });
    expect(verdict9.tripped).toBe(true);
    expect(verdict9.status).toBe("TRIPPED");
    expect(verdict9.wrapUpMessage).toBe(CRITICAL_WRAP_UP_MESSAGE);

    const verdict1 = checkQuotaCircuitBreaker({ remainingPercentage: 1.0 });
    expect(verdict1.tripped).toBe(true);
    expect(verdict1.status).toBe("TRIPPED");
  });

  test("trips at exact 10.0% boundary and at 0.0% exhaustion", () => {
    expect(checkQuotaCircuitBreaker(10.0).tripped).toBe(true);
    expect(checkQuotaCircuitBreaker(0).tripped).toBe(true);
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
  beforeEach(() => {
    setupVirtualEngineFS();
  });
  afterEach(() => {
    cleanupVirtualEngineFS();
  });

  test("all created and touched files are <= 300 lines with zero code comments", () => {
    const files = [
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/engine/runner/subagent-pool.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/engine/runner/index.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/telemetry/circuit-breaker.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/telemetry/circuit-breaker-evaluator.ts",
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/telemetry/circuit-breaker-markdown.ts",
      "/Users/onurseckinsenoglu/repos/skills/tests/engine/policy/concurrency-cap.test.ts",
    ];
    const commentPattern = new RegExp("\\/\\/|\\/\\*|\\*\\/");
    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionTokens = [
      "@ts" + "-ignore",
      "@ts" + "-expect-error",
      "@ts" + "-nocheck",
      "eslint" + "-disable",
      "oxlint" + "-disable",
    ];

    for (const file of files) {
      expect(existsSync(file)).toBe(true);
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);
      for (const line of lines) {
        if (
          line.includes("commentPattern") ||
          line.includes("anyPattern") ||
          line.includes("suppressionTokens")
        )
          continue;
        expect(commentPattern.test(line)).toBe(false);
        expect(anyPattern.test(line)).toBe(false);
        for (const token of suppressionTokens) expect(line.includes(token)).toBe(false);
      }
    }
  });
});
