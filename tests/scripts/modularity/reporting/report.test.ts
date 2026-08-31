import { expect, test } from "bun:test";
import type { CheckReport, Violation } from "../../../../scripts/modularity/core/index.ts";
import {
  renderJsonReport,
  renderMarkdownReport,
  sortViolations,
} from "../../../../scripts/modularity/reporting/index.ts";

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
