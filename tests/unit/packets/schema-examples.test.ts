import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateGraph } from "../../../orchestrating-long-tasks/scripts/src/graph/validate-graph.ts";
import { validateRequirements } from "../../../orchestrating-long-tasks/scripts/src/requirements/validate-requirements.ts";
import { validateReview } from "../../../orchestrating-long-tasks/scripts/src/workflow/review/validate-review.ts";
import { validateReport } from "../../../orchestrating-long-tasks/scripts/src/workflow/submission/validate-report.ts";
import type { TaskRecord } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";

const path = fileURLToPath(
  new URL("../../../orchestrating-long-tasks/references/schema-examples.md", import.meta.url),
);
const source = readFileSync(path, "utf8");

function example(heading: string): Record<string, unknown> {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = source.match(
    new RegExp(
      `## ${escaped}[^\\n]*\\n(?:(?!\\n## ).)*?\\x60\\x60\\x60json\\s+([\\s\\S]*?)\\x60\\x60\\x60`,
      "us",
    ),
  );
  if (!match?.[1]) throw new Error(`missing JSON example: ${heading}`);
  return JSON.parse(match[1]);
}

const task: TaskRecord = {
  id: "task-1",
  status: "validating",
  requirement_ids: ["R-001"],
  write_scope: ["src/store"],
  dependencies: [],
  attempts: [],
  history: [],
  repair_round: 1,
};

describe("documented schema examples", () => {
  test("requirements and graph pass the production validators", () => {
    const requirements = example("Requirements");
    const graph = example("Graph");
    expect(validateRequirements("Preserve the complete prompt.", requirements)).toEqual([]);
    expect(validateGraph(graph, requirements)).toEqual([]);
  });

  test("plural source-line mapping passes the production requirements validator", () => {
    const requirements = example("Plural source-line mapping");
    expect(
      validateRequirements("Add local caching and publish it only after I approve.", requirements),
    ).toEqual([]);
  });

  test("submission, rejection, and repaired pass satisfy runtime contracts", () => {
    expect(() => validateReport(task, example("Implementer submission"))).not.toThrow();
    expect(validateReview(task, example("Validator rejection"))).toMatchObject({
      verdict: "reject",
    });
    expect(validateReview(task, example("Validator pass after repair"))).toMatchObject({
      verdict: "pass",
      resolved_findings: [{ finding_id: "F-001" }],
    });
  });
});
