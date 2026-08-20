import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupRoots, emptyState, render, task, tempRoot } from "./markdown-fixtures.ts";

afterEach(cleanupRoots);

/** Writes the one field `task:review` persists that this section reads: `checklist_coverage`. */
function withReviewReport(root: string, taskId: string, checklistCoverage: unknown): void {
  mkdirSync(join(root, "reports"), { recursive: true });
  writeFileSync(
    join(root, "reports", `${taskId}-review.json`),
    JSON.stringify({ task_id: taskId, checklist_coverage: checklistCoverage }),
  );
}

describe("summary.md: standing checklist coverage (B12.5)", () => {
  test("no task has recorded a review: the section says so, not an empty table", () => {
    const markdown = render(emptyState);
    expect(markdown).toContain("## 20. Standing Checklist Coverage");
    expect(markdown).toContain(
      "No task has recorded a review yet, so no standing checklist coverage exists.",
    );
    expect(markdown).toContain(
      "Coverage never gates a task's own verdict (section 14); it states separately what the validator's standing checklist actually inspected.",
    );
  });

  test("a task whose review carried no checklist domain states the reason, not silence", () => {
    const root = tempRoot();
    withReviewReport(root, "task-a", {
      applicable: false,
      reason: "no --checklist-domain was named for this review; no standing checklist coverage applies",
    });
    const state = { ...emptyState, tasks: { "task-a": task({ id: "task-a" }) } };

    const markdown = render(state, { runRoot: root });

    expect(markdown).toContain("### task-a");
    expect(markdown).toContain(
      "no --checklist-domain was named for this review; no standing checklist coverage applies",
    );
  });

  test("full coverage renders checked, not-applicable, could-not-check and adjacent findings separately", () => {
    const root = tempRoot();
    withReviewReport(root, "task-b", {
      applicable: true,
      domain: "code-quality",
      items: [
        { id: "CQ-STRUCT-001", disposition: "checked" },
        { id: "CQ-STRUCT-002", disposition: "not_applicable", reason: "no new abstraction was introduced" },
        { id: "CQ-NAMING-001", disposition: "could_not_check", reason: "the linter did not run in this sandbox" },
      ],
      adjacent_findings: [
        {
          id: "adj-1",
          checklist_item_id: "CQ-NAMING-002",
          severity: "minor",
          observation: "sidebar text size does not match its siblings",
          remediation: "match the sidebar label to the sibling font-size token",
          evidence: [{ kind: "diff" }],
        },
      ],
    });
    const state = { ...emptyState, tasks: { "task-b": task({ id: "task-b" }) } };

    const markdown = render(state, { runRoot: root });

    expect(markdown).toContain("### task-b");
    expect(markdown).toContain(
      "Domain: code-quality. 1 checked and passed, 1 not applicable, 1 could not be checked, of 3 total.",
    );
    expect(markdown).toContain("Checked and passed: `CQ-STRUCT-001`");
    expect(markdown).toContain("| `CQ-STRUCT-002` | no new abstraction was introduced |");
    expect(markdown).toContain("| `CQ-NAMING-001` | the linter did not run in this sandbox |");
    expect(markdown).toContain(
      "| `adj-1` | `CQ-NAMING-002` | minor | sidebar text size does not match its siblings | match the sidebar label to the sibling font-size token |",
    );
    // Adjacent findings never merge into section 14's own task-scope findings table; they only
    // ever appear here, under the checklist that found them.
    expect(markdown.indexOf("## 14. Probes, Pushbacks And Repairs")).toBeLessThan(
      markdown.indexOf("## 20. Standing Checklist Coverage"),
    );
  });

  test("a task with no review report yet is simply absent from the section, not shown as empty", () => {
    const state = { ...emptyState, tasks: { "task-c": task({ id: "task-c" }) } };
    const markdown = render(state);
    const coverageSection = markdown.slice(markdown.indexOf("## 20. Standing Checklist Coverage"));
    expect(coverageSection).toContain(
      "No task has recorded a review yet, so no standing checklist coverage exists.",
    );
    // Section 8 (Task Trajectory) has its own "### task-c" subheading; section 19 must not borrow it
    // for a task that never recorded a review.
    expect(coverageSection).not.toContain("### task-c");
  });
});
