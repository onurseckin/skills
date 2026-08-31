import { describe, expect, test } from "bun:test";
import type { CheckReport, Violation } from "../../../scripts/modularity/core/index.ts";
import {
  compareBaseline,
  type ModularityBaseline,
} from "../../../scripts/modularity/policy/index.ts";
import {
  renderJsonReport,
  renderMarkdownReport,
  sortViolations,
} from "../../../scripts/modularity/reporting/index.ts";

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

describe("baseline comparison", () => {
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
    expect(result.baselineDelta.resolved[0]?.rule).toBe("missing_facade");
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
    expect(result.baselineDelta.worsened[0]?.path).toBe("src/a.ts");
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
});

describe("report formatting", () => {
  const sampleReport: CheckReport = {
    mode: "strict",
    source: "tree",
    violations: [
      {
        rule: "line_limit",
        path: "z.ts",
        observed: 301,
        limit: 300,
        detail: "too long",
      },
      {
        rule: "export_star",
        path: "a.ts",
        observed: 1,
        detail: "bad export",
      },
    ],
    baselineDelta: { added: [], worsened: [], resolved: [] },
    passed: false,
  };

  test("renders a stable schema-versioned JSON report", () => {
    expect(JSON.parse(renderJsonReport(sampleReport))).toMatchObject({
      schema: "olt-modularity-report/v1",
      violations: [
        expect.objectContaining({ path: "a.ts" }),
        expect.objectContaining({ path: "z.ts" }),
      ],
    });
  });

  test("renders sorted markdown findings", () => {
    expect(renderMarkdownReport(sampleReport)).toContain("`a.ts`");
  });

  test("renders markdown report for passing check with no violations", () => {
    const passedReport: CheckReport = {
      mode: "ratchet",
      source: "index",
      violations: [],
      baselineDelta: { added: [], worsened: [], resolved: [] },
      passed: true,
    };
    const md = renderMarkdownReport(passedReport);
    expect(md).toContain("Status: passed");
    expect(md).toContain("No violations.");
  });

  test("renders markdown report for failing check with no violations", () => {
    const failedReport: CheckReport = {
      mode: "strict",
      source: "tree",
      violations: [],
      baselineDelta: { added: [], worsened: [], resolved: [] },
      passed: false,
    };
    const md = renderMarkdownReport(failedReport);
    expect(md).toContain("Status: failed");
    expect(md).toContain("No violations.");
  });

  test("sortViolations orders by rule, then path, then detail", () => {
    const v1: Violation = { rule: "export_star", path: "a.ts", observed: 1, detail: "alpha" };
    const v2: Violation = { rule: "export_star", path: "a.ts", observed: 1, detail: "beta" };
    const v3: Violation = { rule: "export_star", path: "b.ts", observed: 1, detail: "alpha" };
    const v4: Violation = { rule: "line_limit", path: "a.ts", observed: 350, detail: "alpha" };
    const v5: Violation = { rule: "line_limit", path: "a.ts", observed: 350, detail: "alpha" };

    const sorted = sortViolations([v4, v3, v2, v1, v5]);
    expect(sorted).toEqual([v1, v2, v3, v4, v5]);
  });
});
