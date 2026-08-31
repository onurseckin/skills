import { describe, it, expect } from "bun:test";
import { SimpleQueue, QueueDrainage } from "../../../olt/scripts/src/mind/tasks/index.ts";

describe("mind/queue-drainage", () => {
  describe("SimpleQueue", () => {
    it("enqueues, dequeues, and tracks size accurately", () => {
      const queue = new SimpleQueue<number>([1, 2]);
      expect(queue.size()).toBe(2);

      queue.enqueue(3);
      expect(queue.size()).toBe(3);

      expect(queue.dequeue()).toBe(1);
      expect(queue.dequeue()).toBe(2);
      expect(queue.dequeue()).toBe(3);
      expect(queue.dequeue()).toBeUndefined();
      expect(queue.size()).toBe(0);
    });
  });

  describe("QueueDrainage", () => {
    it("throws error when concurrencyLimit is less than 1", () => {
      const queue = new SimpleQueue<string>();
      expect(() => new QueueDrainage(queue, 0)).toThrow("Concurrency limit must be at least 1");
      expect(() => new QueueDrainage(queue, -1)).toThrow("Concurrency limit must be at least 1");
    });

    it("drains queue concurrently up to concurrency limit", async () => {
      const queue = new SimpleQueue<number>([10, 20, 30, 40]);
      const drainage = new QueueDrainage(queue, 2);

      const processed: number[] = [];
      let activeCount = 0;
      let maxActiveObserved = 0;

      await drainage.drain(async (item) => {
        activeCount += 1;
        maxActiveObserved = Math.max(maxActiveObserved, activeCount);
        await new Promise((r) => setTimeout(r, 20));
        processed.push(item);
        activeCount -= 1;
      });

      expect(processed.length).toBe(4);
      expect(maxActiveObserved).toBeLessThanOrEqual(2);
      expect(queue.size()).toBe(0);
    });

    it("handles empty queue gracefully", async () => {
      const queue = new SimpleQueue<string>();
      const drainage = new QueueDrainage(queue, 4);

      let processed = 0;
      await drainage.drain(async () => {
        processed += 1;
      });

      expect(processed).toBe(0);
    });
  });
});
