import { describe, expect, it } from "bun:test";
import type { Violation } from "../../scripts/modularity/core/contracts.ts";
import { compareBaseline } from "../../scripts/modularity/policy/compare.ts";
import type { ModularityBaseline } from "../../scripts/modularity/policy/baseline.ts";

function createBaseline(violations: Violation[]): ModularityBaseline {
  return {
    schema: "olt-modularity-baseline/v1",
    violations,
  };
}

describe("modularity baseline ratchet comparison (pure in-memory)", () => {
  it("passes when baseline and current violations are empty", () => {
    const baseline = createBaseline([]);
    const current = createBaseline([]);
    const result = compareBaseline(baseline, current);

    expect(result.passed).toBe(true);
    expect(result.baselineDelta.added).toEqual([]);
    expect(result.baselineDelta.worsened).toEqual([]);
    expect(result.baselineDelta.resolved).toEqual([]);
  });

  it("passes when observed violations exactly match the baseline", () => {
    const v: Violation = {
      rule: "line_limit",
      path: "src/file.ts",
      observed: 450,
      limit: 400,
      detail: "Line limit",
    };
    const baseline = createBaseline([v]);
    const current = createBaseline([{ ...v }]);
    const result = compareBaseline(baseline, current);

    expect(result.passed).toBe(true);
    expect(result.baselineDelta.added).toEqual([]);
    expect(result.baselineDelta.worsened).toEqual([]);
    expect(result.baselineDelta.resolved).toEqual([]);
  });

  it("fails and marks added when a new file violation appears", () => {
    const baseline = createBaseline([]);
    const newViolation: Violation = {
      rule: "directory_fanout",
      path: "src/new-dir",
      observed: 15,
      limit: 10,
      detail: "Fanout",
    };
    const current = createBaseline([newViolation]);
    const result = compareBaseline(baseline, current);

    expect(result.passed).toBe(false);
    expect(result.baselineDelta.added).toEqual([newViolation]);
    expect(result.baselineDelta.worsened).toEqual([]);
    expect(result.baselineDelta.resolved).toEqual([]);
  });

  it("fails and marks worsened when an existing violation count increases", () => {
    const baseViolation: Violation = {
      rule: "line_limit",
      path: "src/file.ts",
      observed: 450,
      limit: 400,
      detail: "Line limit",
    };
    const worseViolation: Violation = {
      rule: "line_limit",
      path: "src/file.ts",
      observed: 500,
      limit: 400,
      detail: "Line limit",
    };
    const baseline = createBaseline([baseViolation]);
    const current = createBaseline([worseViolation]);
    const result = compareBaseline(baseline, current);

    expect(result.passed).toBe(false);
    expect(result.baselineDelta.added).toEqual([]);
    expect(result.baselineDelta.worsened).toEqual([worseViolation]);
    expect(result.baselineDelta.resolved).toEqual([]);
  });

  it("passes and records resolved when an observed violation count decreases", () => {
    const baseViolation: Violation = {
      rule: "line_limit",
      path: "src/file.ts",
      observed: 500,
      limit: 400,
      detail: "Line limit",
    };
    const improvedViolation: Violation = {
      rule: "line_limit",
      path: "src/file.ts",
      observed: 420,
      limit: 400,
      detail: "Line limit",
    };
    const baseline = createBaseline([baseViolation]);
    const current = createBaseline([improvedViolation]);
    const result = compareBaseline(baseline, current);

    expect(result.passed).toBe(true);
    expect(result.baselineDelta.added).toEqual([]);
    expect(result.baselineDelta.worsened).toEqual([]);
  });

  it("passes and records resolved when a baselined violation is completely eliminated", () => {
    const baseViolation: Violation = {
      rule: "missing_facade",
      path: "src/dir",
      observed: "missing index.ts",
      detail: "Missing facade",
    };
    const baseline = createBaseline([baseViolation]);
    const current = createBaseline([]);
    const result = compareBaseline(baseline, current);

    expect(result.passed).toBe(true);
    expect(result.baselineDelta.added).toEqual([]);
    expect(result.baselineDelta.worsened).toEqual([]);
    expect(result.baselineDelta.resolved).toEqual([baseViolation]);
  });

  it("throws error when baseline contains duplicate violation identity", () => {
    const v: Violation = {
      rule: "line_limit",
      path: "src/file.ts",
      observed: 450,
      detail: "Limit",
    };
    const baseline = createBaseline([v, { ...v }]);
    const current = createBaseline([]);

    expect(() => compareBaseline(baseline, current)).toThrow(
      /duplicate identity line_limit:src\/file\.ts/,
    );
  });

  describe("dependency cycles ratchet tracking", () => {
    it("passes when cycle nodes are identical", () => {
      const cycle: Violation = {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts",
        detail: "Cycle",
      };
      const baseline = createBaseline([cycle]);
      const current = createBaseline([{ ...cycle }]);
      const result = compareBaseline(baseline, current);

      expect(result.passed).toBe(true);
      expect(result.baselineDelta.added).toEqual([]);
      expect(result.baselineDelta.worsened).toEqual([]);
    });

    it("marks added when an entirely new cycle is formed", () => {
      const cycleA: Violation = {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts",
        detail: "Cycle A",
      };
      const cycleB: Violation = {
        rule: "dependency_cycle",
        path: "src/x.ts",
        observed: "src/x.ts,src/y.ts",
        detail: "Cycle B",
      };
      const baseline = createBaseline([cycleA]);
      const current = createBaseline([cycleA, cycleB]);
      const result = compareBaseline(baseline, current);

      expect(result.passed).toBe(false);
      expect(result.baselineDelta.added).toEqual([cycleB]);
    });

    it("marks worsened when an existing cycle absorbs new nodes", () => {
      const baseCycle: Violation = {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts",
        detail: "Cycle",
      };
      const expandedCycle: Violation = {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts,src/c.ts",
        detail: "Cycle",
      };
      const baseline = createBaseline([baseCycle]);
      const current = createBaseline([expandedCycle]);
      const result = compareBaseline(baseline, current);

      expect(result.passed).toBe(false);
      expect(result.baselineDelta.worsened).toEqual([expandedCycle]);
    });

    it("marks resolved when a cycle is broken and disappears", () => {
      const cycle: Violation = {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts",
        detail: "Cycle",
      };
      const baseline = createBaseline([cycle]);
      const current = createBaseline([]);
      const result = compareBaseline(baseline, current);

      expect(result.passed).toBe(true);
      expect(result.baselineDelta.resolved).toEqual([cycle]);
    });
  });
});
