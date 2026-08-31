import { expect, test } from "bun:test";
import {
  compareBaseline,
  type ModularityBaseline,
} from "../../../../scripts/modularity/policy/index.ts";

function baseline(observed: number): ModularityBaseline {
  return {
    schema: "olt-modularity-baseline/v1",
    violations: [
      {
        rule: "line_limit",
        path: "a.ts",
        observed,
        limit: 300,
        detail: "File exceeds the 300 physical-line limit.",
      },
    ],
  };
}

test("rejects growth and accepts reduction", () => {
  expect(compareBaseline(baseline(450), baseline(451)).passed).toBe(false);
  expect(compareBaseline(baseline(450), baseline(300)).passed).toBe(true);
});

test("handles non-number observed and cycle rules in compareBaseline", () => {
  const base: ModularityBaseline = {
    schema: "olt-modularity-baseline/v1",
    violations: [
      {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts",
        detail: "cycle",
      },
      {
        rule: "missing_facade",
        path: "src/dir",
        observed: "missing index.ts",
        detail: "missing",
      },
    ],
  };
  const current: ModularityBaseline = {
    schema: "olt-modularity-baseline/v1",
    violations: [
      {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts",
        detail: "cycle",
      },
    ],
  };
  const result = compareBaseline(base, current);
  expect(result.passed).toBe(true);
  expect(result.baselineDelta.resolved.length).toBe(1);
  expect(result.baselineDelta.resolved[0].rule).toBe("missing_facade");
});

test("detects dependency_cycle expansion and node additions as worsened", () => {
  const base: ModularityBaseline = {
    schema: "olt-modularity-baseline/v1",
    violations: [
      {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts",
        detail: "cycle",
      },
    ],
  };
  const expanded: ModularityBaseline = {
    schema: "olt-modularity-baseline/v1",
    violations: [
      {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts,src/c.ts",
        detail: "cycle",
      },
    ],
  };
  const result = compareBaseline(base, expanded);
  expect(result.passed).toBe(false);
  expect(result.baselineDelta.worsened.length).toBe(1);
  expect(result.baselineDelta.worsened[0].path).toBe("src/a.ts");
});

test("accepts dependency_cycle shrink when nodes are removed", () => {
  const base: ModularityBaseline = {
    schema: "olt-modularity-baseline/v1",
    violations: [
      {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts,src/c.ts",
        detail: "cycle",
      },
    ],
  };
  const shrunk: ModularityBaseline = {
    schema: "olt-modularity-baseline/v1",
    violations: [
      {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts",
        detail: "cycle",
      },
    ],
  };
  const result = compareBaseline(base, shrunk);
  expect(result.passed).toBe(true);
  expect(result.baselineDelta.worsened.length).toBe(0);
});

test("accepts cycle shrink when pivot node decouples and path changes", () => {
  const base: ModularityBaseline = {
    schema: "olt-modularity-baseline/v1",
    violations: [
      {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts,src/c.ts",
        detail: "cycle",
      },
    ],
  };
  const pivotRemoved: ModularityBaseline = {
    schema: "olt-modularity-baseline/v1",
    violations: [
      {
        rule: "dependency_cycle",
        path: "src/b.ts",
        observed: "src/b.ts,src/c.ts",
        detail: "cycle",
      },
    ],
  };
  const result = compareBaseline(base, pivotRemoved);
  expect(result.passed).toBe(true);
  expect(result.baselineDelta.added.length).toBe(0);
  expect(result.baselineDelta.worsened.length).toBe(0);
});

test("rejects an added violation and duplicate baseline identity", () => {
  expect(
    compareBaseline(baseline(300), {
      ...baseline(300),
      violations: [
        ...baseline(300).violations,
        {
          rule: "export_star",
          path: "slice/index.ts",
          observed: 1,
          detail: "No export star.",
        },
      ],
    }).passed,
  ).toBe(false);
  expect(() =>
    compareBaseline(
      {
        ...baseline(450),
        violations: [...baseline(450).violations, ...baseline(450).violations],
      },
      baseline(450),
    ),
  ).toThrow("duplicate");
});
