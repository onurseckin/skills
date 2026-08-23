import { describe, expect, test } from "bun:test";
import { schedulingMetrics } from "../../../olt/scripts/src/engine/scheduler/metrics.ts";

describe("schedulingMetrics", () => {
  test("computes critical depth and descendant counts for a simple chain", () => {
    const dependencies = new Map([
      ["A", new Set<string>()],
      ["B", new Set(["A"])],
      ["C", new Set(["B"])],
    ]);
    const metrics = schedulingMetrics(dependencies);
    expect(metrics.criticalDepth.get("A")).toBe(2);
    expect(metrics.criticalDepth.get("B")).toBe(1);
    expect(metrics.criticalDepth.get("C")).toBe(0);
    expect(metrics.descendants.get("A")).toBe(2);
    expect(metrics.descendants.get("C")).toBe(0);
  });

  test("refuses to compute metrics over a dependency cycle", () => {
    const dependencies = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    expect(() => schedulingMetrics(dependencies)).toThrow(/execution cycle/i);
  });
});
