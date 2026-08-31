import { describe, test, expect } from "bun:test";
import { optimizeScopeCollisionDetection } from "../../../olt/scripts/src/plan/scope-analyzer.ts";

describe("scope-analyzer", () => {
  test("detects overlapping paths between scopes", () => {
    expect(optimizeScopeCollisionDetection(["a.ts", "b.ts"], ["c.ts", "b.ts"])).toBe(true);
    expect(optimizeScopeCollisionDetection(["a.ts", "b.ts"], ["c.ts", "d.ts"])).toBe(false);
    expect(optimizeScopeCollisionDetection([], ["c.ts"])).toBe(false);
    expect(optimizeScopeCollisionDetection(["a.ts"], [])).toBe(false);
  });
});
