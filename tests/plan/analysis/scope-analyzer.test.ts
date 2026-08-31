import { describe, test, expect } from "bun:test";
import { optimizeScopeCollisionDetection } from "../../../olt/scripts/src/plan/scope-analyzer.ts";
import { createSampleScopePair, ANALYSIS_SUITES } from "./index.ts";

describe("scope-analyzer", () => {
  test("detects overlapping paths between scopes", () => {
    expect(optimizeScopeCollisionDetection(["a.ts", "b.ts"], ["c.ts", "b.ts"])).toBe(true);
    expect(optimizeScopeCollisionDetection(["a.ts", "b.ts"], ["c.ts", "d.ts"])).toBe(false);
    expect(optimizeScopeCollisionDetection([], ["c.ts"])).toBe(false);
    expect(optimizeScopeCollisionDetection(["a.ts"], [])).toBe(false);

    const { scopeA, scopeB, disjointScope } = createSampleScopePair();
    expect(optimizeScopeCollisionDetection(scopeA, scopeB)).toBe(true);
    expect(optimizeScopeCollisionDetection(scopeA, disjointScope)).toBe(false);
    expect(ANALYSIS_SUITES.length).toBe(2);
  });
});
