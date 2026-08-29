import { expect, test } from "bun:test";
import {
  renderJsonReport,
  renderMarkdownReport,
} from "../../../../../scripts/modularity/reporting/index.ts";

const report = {
  mode: "strict" as const,
  source: "tree" as const,
  violations: [
    {
      rule: "line_limit" as const,
      path: "z.ts",
      observed: 301,
      limit: 300,
      detail: "too long",
    },
    {
      rule: "export_star" as const,
      path: "a.ts",
      observed: 1,
      detail: "bad export",
    },
  ],
  baselineDelta: { added: [], worsened: [], resolved: [] },
  passed: false,
};

test("renders a stable schema-versioned JSON report", () => {
  expect(JSON.parse(renderJsonReport(report))).toMatchObject({
    schema: "olt-modularity-report/v1",
    violations: [
      expect.objectContaining({ path: "a.ts" }),
      expect.objectContaining({ path: "z.ts" }),
    ],
  });
});

test("renders sorted markdown findings", () => {
  expect(renderMarkdownReport(report)).toContain("`a.ts`");
});
