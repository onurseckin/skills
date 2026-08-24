import { test, expect } from "bun:test";
import { QueueDrainage, SimpleQueue } from "../../queue-drainage.ts";

test("QueueDrainage processes all items with concurrency limit", async () => {
  const queue = new SimpleQueue<number>([1, 2, 3, 4, 5]);
  const drainage = new QueueDrainage<number>(queue, 2);
  const processed: number[] = [];

  let concurrent = 0;
  let maxConcurrent = 0;

  await drainage.drain(async (item) => {
    concurrent++;
    if (concurrent > maxConcurrent) {
      maxConcurrent = concurrent;
    }
    // Simulate async work
    await new Promise((resolve) => setTimeout(resolve, 10));
    processed.push(item);
    concurrent--;
  });

  expect(processed.length).toBe(5);
  expect(processed.sort()).toEqual([1, 2, 3, 4, 5]);
  expect(maxConcurrent).toBeLessThanOrEqual(2);
});
