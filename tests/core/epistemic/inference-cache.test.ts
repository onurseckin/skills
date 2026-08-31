import { describe, expect, it } from "bun:test";
import { EpistemicInferenceCache } from "../../../olt/scripts/src/core/epistemic/index.ts";

describe("Epistemic Inference Cache & Invalidation", () => {
  it("computes deterministic cache keys for identical structured payloads", () => {
    const cache = new EpistemicInferenceCache();
    const payload1 = { claim: "alpha", evidence: [1, 2, 3] };
    const payload2 = { evidence: [1, 2, 3], claim: "alpha" };

    const key1 = cache.computeKey(payload1);
    const key2 = cache.computeKey(payload2);

    expect(key1).toBe(key2);
    expect(key1.startsWith("epistemic:")).toBe(true);
  });

  it("stores, retrieves, and tracks cache hits and misses", () => {
    const cache = new EpistemicInferenceCache<number>();
    const key = "test:1";

    expect(cache.get(key)).toBeUndefined();
    expect(cache.getStats().misses).toBe(1);
    expect(cache.getStats().hits).toBe(0);

    cache.set(key, 42);
    expect(cache.has(key)).toBe(true);
    expect(cache.get(key)).toBe(42);
    expect(cache.getStats().hits).toBe(1);
    expect(cache.size()).toBe(1);
  });

  it("invalidates cache entries by key", () => {
    const cache = new EpistemicInferenceCache<string>();
    cache.set("k1", "val1");
    cache.set("k2", "val2");

    const count = cache.invalidate("k1");
    expect(count).toBe(1);
    expect(cache.has("k1")).toBe(false);
    expect(cache.has("k2")).toBe(true);
    expect(cache.getStats().invalidations).toBe(1);
  });

  it("invalidates cascading dependencies", () => {
    const cache = new EpistemicInferenceCache<string>();
    cache.set("hypo:1", "claim1", { dependencies: ["claim:a", "claim:b"] });
    cache.set("hypo:2", "claim2", { dependencies: ["claim:b", "claim:c"] });
    cache.set("hypo:3", "claim3", { dependencies: ["claim:d"] });

    expect(cache.size()).toBe(3);

    const invalidated = cache.invalidateByDependency("claim:b");
    expect(invalidated).toBe(2);
    expect(cache.has("hypo:1")).toBe(false);
    expect(cache.has("hypo:2")).toBe(false);
    expect(cache.has("hypo:3")).toBe(true);
  });

  it("invalidates by key prefix", () => {
    const cache = new EpistemicInferenceCache<string>();
    cache.set("agent:01:score", "90");
    cache.set("agent:01:grade", "A");
    cache.set("agent:02:score", "80");

    const removed = cache.invalidateByPrefix("agent:01");
    expect(removed).toBe(2);
    expect(cache.has("agent:01:score")).toBe(false);
    expect(cache.has("agent:01:grade")).toBe(false);
    expect(cache.has("agent:02:score")).toBe(true);
  });

  it("evicts expired entries on TTL expiration", async () => {
    const cache = new EpistemicInferenceCache<string>({ defaultTtlMs: 20 });
    cache.set("short_lived", "data");

    expect(cache.has("short_lived")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(cache.get("short_lived")).toBeUndefined();
    expect(cache.getStats().evictions).toBe(1);
  });

  it("enforces maxEntries capacity limit by evicting oldest", () => {
    const cache = new EpistemicInferenceCache<number>({ maxEntries: 2 });
    cache.set("first", 1);
    cache.set("second", 2);
    cache.set("third", 3);

    expect(cache.size()).toBe(2);
    expect(cache.has("first")).toBe(false);
    expect(cache.has("second")).toBe(true);
    expect(cache.has("third")).toBe(true);
    expect(cache.getStats().evictions).toBe(1);
  });

  it("prunes expired entries proactively", async () => {
    const cache = new EpistemicInferenceCache<string>();
    cache.set("item1", "val", { ttlMs: 10 });
    cache.set("item2", "val", { ttlMs: 1000 });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const pruned = cache.pruneExpired();
    expect(pruned).toBe(1);
    expect(cache.has("item1")).toBe(false);
    expect(cache.has("item2")).toBe(true);
  });

  it("clears all cache entries and resets statistics", () => {
    const cache = new EpistemicInferenceCache<string>();
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a");

    expect(cache.getStats().hits).toBe(1);
    cache.clear();
    expect(cache.size()).toBe(0);

    cache.resetStats();
    expect(cache.getStats().hits).toBe(0);
    expect(cache.getStats().invalidations).toBe(0);
  });
});
