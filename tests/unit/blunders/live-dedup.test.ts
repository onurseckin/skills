import { describe, expect, test } from "bun:test";
import { LiveBlunderDeduplicator } from "../../../orchestrating-long-tasks/scripts/src/blunders/live-dedup.ts";

describe("LiveBlunderDeduplicator Engine", () => {
  test("tracks and aggregates live blunders synchronously", () => {
    const dedup = new LiveBlunderDeduplicator();

    const r1 = dedup.record({
      id: "blunder-first",
      type: "role_confinement_violation",
      agent_id: "orch-01",
      observation: "Unauthorized mutation attempt",
    });

    expect(r1.isNew).toBeTrue();
    expect(r1.entry.count).toBe(1);
    expect(dedup.size).toBe(1);

    const r2 = dedup.record({
      id: "blunder-second",
      type: "role_confinement_violation",
      agent_id: "orch-01",
      observation: "Unauthorized mutation attempt",
    });

    expect(r2.isNew).toBeFalse();
    expect(r2.entry.count).toBe(2);
    expect(dedup.size).toBe(1);

    const retrievedById = dedup.get("blunder-first");
    expect(retrievedById?.count).toBe(2);

    const retrievedByKey = dedup.get(r1.entry.dedup_key);
    expect(retrievedByKey?.count).toBe(2);
  });

  test("resolves blunders with resolution proof", () => {
    const dedup = new LiveBlunderDeduplicator();

    const r1 = dedup.record({
      id: "blunder-res-target",
      type: "syntax_error",
      observation: "Missing semicolon",
    });

    expect(r1.entry.status).toBe("open");

    const resolved = dedup.resolve("blunder-res-target", {
      task_id: "task-remed-syntax",
      test_assertion: "bun test tests/unit/syntax.test.ts",
      resolved_at: "2026-08-22T08:30:00.000Z",
    });

    expect(resolved !== null).toBeTrue();
    if (resolved) {
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution?.task_id).toBe("task-remed-syntax");
    }

    const fetched = dedup.get("blunder-res-target");
    expect(fetched?.status).toBe("resolved");
  });

  test("prunes entries older than maxAgeMs", () => {
    const dedup = new LiveBlunderDeduplicator();

    dedup.record({
      type: "old_error",
      observation: "Happened long ago",
      timestamp: "2026-08-22T00:00:00.000Z",
    });

    dedup.record({
      type: "recent_error",
      observation: "Happened just now",
      timestamp: "2026-08-22T08:00:00.000Z",
    });

    expect(dedup.size).toBe(2);

    const nowMs = Date.parse("2026-08-22T08:05:00.000Z");
    const pruned = dedup.prune(60 * 60 * 1000, nowMs); // Prune older than 1 hour

    expect(pruned).toBe(1);
    expect(dedup.size).toBe(1);
    expect(dedup.getAll()[0]?.type).toBe("recent_error");
  });

  test("clears all state cleanly", () => {
    const dedup = new LiveBlunderDeduplicator();
    dedup.record({ type: "t1", observation: "o1" });
    dedup.record({ type: "t2", observation: "o2" });

    expect(dedup.size).toBe(2);
    dedup.clear();
    expect(dedup.size).toBe(0);
    expect(dedup.getAll()).toEqual([]);
  });
});
