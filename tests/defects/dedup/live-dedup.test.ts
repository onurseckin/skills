import { describe, expect, it, test } from "bun:test";
import {
  computeDefectDiscriminator,
  LiveDefectDeduplicator,
} from "../../../olt/scripts/src/mind/defects/index.ts";
import type { DefectResolutionProof } from "../../../olt/scripts/src/mind/defects/core/index.ts";

export const liveDedupSuiteName = "LiveDefectDeduplicator Engine & Lifecycle";

describe(liveDedupSuiteName, () => {
  test("tracks and aggregates live defects synchronously", () => {
    const dedup = new LiveDefectDeduplicator();

    const r1 = dedup.record({
      id: "defect-first",
      type: "role_confinement_violation",
      agent_id: "orch-01",
      observation: "Unauthorized mutation attempt",
    });

    expect(r1.isNew).toBeTrue();
    expect(r1.entry.count).toBe(1);
    expect(dedup.size).toBe(1);

    const r2 = dedup.record({
      id: "defect-second",
      type: "role_confinement_violation",
      agent_id: "orch-01",
      observation: "Unauthorized mutation attempt",
    });

    expect(r2.isNew).toBeFalse();
    expect(r2.entry.count).toBe(2);
    expect(dedup.size).toBe(1);

    const retrievedById = dedup.get("defect-first");
    expect(retrievedById?.count).toBe(2);

    const retrievedByKey = dedup.get(r1.entry.dedup_key);
    expect(retrievedByKey?.count).toBe(2);
  });

  test("resolves defects with resolution proof and status filtering", () => {
    const dedup = new LiveDefectDeduplicator();

    const r1 = dedup.record({
      id: "defect-res-target",
      type: "syntax_error",
      observation: "Missing semicolon",
    });

    expect(r1.entry.status).toBe("open");
    expect(dedup.getOpenDefects()).toHaveLength(1);
    expect(dedup.getResolvedDefects()).toHaveLength(0);

    const proof: DefectResolutionProof = {
      task_id: "task-remed-syntax",
      test_assertion: "bun test tests/defects/dedup/live-dedup.test.ts",
      resolved_at: "2026-08-22T08:30:00.000Z",
    };

    const resolved = dedup.resolve("defect-res-target", proof);

    expect(resolved !== null).toBeTrue();
    if (resolved) {
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution?.task_id).toBe("task-remed-syntax");
    }

    const fetched = dedup.get("defect-res-target");
    expect(fetched?.status).toBe("resolved");
    expect(dedup.getOpenDefects()).toHaveLength(0);
    expect(dedup.getResolvedDefects()).toHaveLength(1);
  });

  test("prunes entries older than maxAgeMs", () => {
    const dedup = new LiveDefectDeduplicator();

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
    const pruned = dedup.prune(60 * 60 * 1000, nowMs);

    expect(pruned).toBe(1);
    expect(dedup.size).toBe(1);
    expect(dedup.getAll()[0]?.type).toBe("recent_error");
  });

  it("evicts oldest entries when entry limit is exceeded", () => {
    const live = new LiveDefectDeduplicator({ maxEntries: 2 });
    live.record({ type: "e1", observation: "Err 1", timestamp: "2026-08-22T10:00:00.000Z" });
    live.record({ type: "e2", observation: "Err 2", timestamp: "2026-08-22T10:01:00.000Z" });
    live.record({ type: "e3", observation: "Err 3", timestamp: "2026-08-22T10:02:00.000Z" });

    expect(live.size).toBe(2);
    expect(live.has(computeDefectDiscriminator({ type: "e1", observation: "Err 1" }))).toBe(false);
    expect(live.has(computeDefectDiscriminator({ type: "e3", observation: "Err 3" }))).toBe(true);
  });

  it("imports and exports JSONL correctly", () => {
    const live = new LiveDefectDeduplicator();
    live.record({ type: "e1", observation: "Observation A" });
    live.record({ type: "e2", observation: "Observation B" });

    const exported = live.exportJsonl();
    expect(exported).toContain("Observation A");
    expect(exported).toContain("Observation B");

    const newLive = new LiveDefectDeduplicator();
    const importedCount = newLive.importJsonl(exported);
    expect(importedCount).toBe(2);
    expect(newLive.size).toBe(2);
  });

  test("clears all state cleanly", () => {
    const dedup = new LiveDefectDeduplicator();
    dedup.record({ type: "t1", observation: "o1" });
    dedup.record({ type: "t2", observation: "o2" });

    expect(dedup.size).toBe(2);
    dedup.clear();
    expect(dedup.size).toBe(0);
    expect(dedup.getAll()).toEqual([]);
  });
});
