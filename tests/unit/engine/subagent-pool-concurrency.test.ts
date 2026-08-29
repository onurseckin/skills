import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  MAX_SUBAGENT_CAPACITY,
  SubagentPool,
  acquireSubagentSlot,
  getSubagentPoolStats,
  releaseSubagentSlot,
  resetSubagentPool,
  type SubagentSlotReceipt,
} from "../../../olt/scripts/src/engine/runner/subagent-pool.ts";

describe("SubagentPool Concurrency & Slot Reservation", () => {
  beforeEach(() => {
    resetSubagentPool();
  });

  afterEach(() => {
    resetSubagentPool();
  });

  describe("Slot Reservation & Acquisition", () => {
    it("acquires slot with default options and valid receipt structure", async () => {
      const receipt = await acquireSubagentSlot();
      expect(receipt.receiptId).toStartWith("slot_");
      expect(receipt.agentId).toStartWith("agent_");
      expect(receipt.role).toBe("implementer");
      expect(receipt.tier).toBe(3);
      expect(receipt.taskId).toBeUndefined();
      expect(receipt.activeCount).toBe(1);
      expect(typeof receipt.release).toBe("function");

      const stats = getSubagentPoolStats();
      expect(stats.activeCount).toBe(1);
      expect(stats.queueDepth).toBe(0);
      expect(stats.totalAcquired).toBe(1);
      expect(stats.totalReleased).toBe(0);
    });

    it("acquires slot with custom metadata", async () => {
      const receipt = await acquireSubagentSlot({
        agentId: "agent-custom-99",
        role: "validator",
        tier: 1,
        taskId: "task-verify-core",
      });

      expect(receipt.agentId).toBe("agent-custom-99");
      expect(receipt.role).toBe("validator");
      expect(receipt.tier).toBe(1);
      expect(receipt.taskId).toBe("task-verify-core");
    });

    it("releases slot via receipt release method", async () => {
      const receipt = await acquireSubagentSlot({ agentId: "agent-rel" });
      expect(getSubagentPoolStats().activeCount).toBe(1);

      receipt.release();
      const stats = getSubagentPoolStats();
      expect(stats.activeCount).toBe(0);
      expect(stats.totalReleased).toBe(1);
    });

    it("releases slot via string receiptId and handles non-existent IDs", async () => {
      const receipt = await acquireSubagentSlot();
      const released = releaseSubagentSlot(receipt.receiptId);
      expect(released).toBe(true);

      const doubleReleased = releaseSubagentSlot(receipt.receiptId);
      expect(doubleReleased).toBe(false);

      const invalidReleased = releaseSubagentSlot("non_existent_slot");
      expect(invalidReleased).toBe(false);
    });
  });

  describe("Concurrency Bounds & Queueing", () => {
    it("enforces maxCapacity on custom SubagentPool instances", async () => {
      const pool = new SubagentPool(2);
      expect(pool.capacity).toBe(2);

      const r1 = await pool.acquire({ agentId: "agent-1" });
      const r2 = await pool.acquire({ agentId: "agent-2" });
      expect(pool.activeCount).toBe(2);
      expect(pool.queueDepth).toBe(0);

      let r3Resolved = false;
      const r3Promise = pool.acquire({ agentId: "agent-3" }).then((res) => {
        r3Resolved = true;
        return res;
      });

      expect(pool.activeCount).toBe(2);
      expect(pool.queueDepth).toBe(1);
      expect(r3Resolved).toBe(false);

      r1.release();
      const r3 = await r3Promise;

      expect(r3Resolved).toBe(true);
      expect(r3.agentId).toBe("agent-3");
      expect(pool.activeCount).toBe(2);
      expect(pool.queueDepth).toBe(0);

      r2.release();
      r3.release();
      expect(pool.activeCount).toBe(0);
    });

    it("services queued requests in FIFO order", async () => {
      const pool = new SubagentPool(1);
      const r1 = await pool.acquire({ agentId: "lead" });

      const order: string[] = [];
      const p2 = pool.acquire({ agentId: "first-in-queue" }).then((r) => {
        order.push(r.agentId);
        return r;
      });
      const p3 = pool.acquire({ agentId: "second-in-queue" }).then((r) => {
        order.push(r.agentId);
        return r;
      });

      expect(pool.queueDepth).toBe(2);

      r1.release();
      const r2 = await p2;
      expect(order).toEqual(["first-in-queue"]);

      r2.release();
      const r3 = await p3;
      expect(order).toEqual(["first-in-queue", "second-in-queue"]);

      r3.release();
      expect(pool.activeCount).toBe(0);
      expect(pool.queueDepth).toBe(0);
    });

    it("handles batch concurrent reservations under capacity", async () => {
      const pool = new SubagentPool(10);
      const promises: Promise<SubagentSlotReceipt>[] = [];
      for (let i = 0; i < 10; i += 1) {
        promises.push(pool.acquire({ agentId: `worker-${i}` }));
      }

      const receipts = await Promise.all(promises);
      expect(receipts.length).toBe(10);
      expect(pool.activeCount).toBe(10);
      expect(pool.queueDepth).toBe(0);

      for (const receipt of receipts) {
        receipt.release();
      }
      expect(pool.activeCount).toBe(0);
      expect(pool.getStats().totalReleased).toBe(10);
    });
  });

  describe("Lock Timeout & Reset Handling", () => {
    it("rejects with LOCK_TIMEOUT when timeout expires while queued", async () => {
      const pool = new SubagentPool(1);
      const r1 = await pool.acquire({ agentId: "holder" });

      let errorCaught: HarnessError | undefined;
      try {
        await pool.acquire({ agentId: "waiting", timeoutMs: 30 });
      } catch (err) {
        if (err instanceof HarnessError) {
          errorCaught = err;
        }
      }

      expect(errorCaught).toBeDefined();
      expect(errorCaught?.code).toBe("LOCK_TIMEOUT");
      expect(errorCaught?.exitCode).toBe(4);
      expect(errorCaught?.message).toContain("Subagent concurrency slot acquisition timed out");
      expect(pool.queueDepth).toBe(0);
      expect(pool.activeCount).toBe(1);

      r1.release();
      expect(pool.activeCount).toBe(0);
    });

    it("clears timeout timer if queued request is serviced before expiry", async () => {
      const pool = new SubagentPool(1);
      const r1 = await pool.acquire({ agentId: "holder" });

      const acquiredPromise = pool.acquire({ agentId: "timed-waiter", timeoutMs: 500 });
      expect(pool.queueDepth).toBe(1);

      r1.release();
      const r2 = await acquiredPromise;
      expect(r2.agentId).toBe("timed-waiter");
      expect(pool.queueDepth).toBe(0);
      expect(pool.activeCount).toBe(1);

      r2.release();
      expect(pool.activeCount).toBe(0);
    });

    it("rejects queued requests with INVALID_STATE on pool reset", async () => {
      const pool = new SubagentPool(1);
      await pool.acquire({ agentId: "holder" });

      let caught1: HarnessError | undefined;
      let caught2: HarnessError | undefined;

      const p1 = pool.acquire({ agentId: "q1", timeoutMs: 1000 }).catch((err: unknown) => {
        if (err instanceof HarnessError) {
          caught1 = err;
        }
      });
      const p2 = pool.acquire({ agentId: "q2" }).catch((err: unknown) => {
        if (err instanceof HarnessError) {
          caught2 = err;
        }
      });

      expect(pool.queueDepth).toBe(2);

      pool.reset();

      await Promise.all([p1, p2]);

      expect(caught1?.code).toBe("INVALID_STATE");
      expect(caught1?.message).toContain("Subagent concurrency pool was reset");
      expect(caught2?.code).toBe("INVALID_STATE");
      expect(caught2?.message).toContain("Subagent concurrency pool was reset");
      expect(pool.queueDepth).toBe(0);
      expect(pool.activeCount).toBe(0);
      expect(pool.getStats().totalAcquired).toBe(0);
    });

    it("clamps minimum pool capacity to at least 1", () => {
      const poolZero = new SubagentPool(0);
      expect(poolZero.capacity).toBe(1);

      const poolNegative = new SubagentPool(-5);
      expect(poolNegative.capacity).toBe(1);

      const poolDefault = new SubagentPool();
      expect(poolDefault.capacity).toBe(MAX_SUBAGENT_CAPACITY);
    });
  });
});
