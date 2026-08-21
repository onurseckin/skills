import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reportsLayout } from "../../../orchestrating-long-tasks/scripts/src/store/layout-reports.ts";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

describe("reportsLayout", () => {
  test("returns no issues when reports/ does not exist", () => {
    const root = scratchRoot("returns-no-issues-when-reports-does-not-exist");
    expect(reportsLayout(root, undefined)).toEqual([]);
  });

  test("returns REPORT_UNREADABLE when reports/ exists but is not a directory", () => {
    const root = scratchRoot("returns-report-unreadable-when-reports-exists-but-");
    writeFileSync(join(root, "reports"), "not a directory");
    const found = reportsLayout(root, undefined);
    expect(found).toEqual([expect.objectContaining({ code: "REPORT_UNREADABLE" })]);
  });

  test("ignores dotfiles and subdirectories inside reports/", () => {
    const root = scratchRoot("ignores-dotfiles-and-subdirectories-inside-reports");
    mkdirSync(join(root, "reports"));
    writeFileSync(join(root, "reports", ".hidden"), "ignored");
    mkdirSync(join(root, "reports", "a-subdirectory"));
    expect(reportsLayout(root, undefined)).toEqual([]);
  });

  test("accepts the fixed critic-review.json name unconditionally", () => {
    const root = scratchRoot("accepts-the-fixed-critic-review-json-name-uncondit");
    mkdirSync(join(root, "reports"));
    writeFileSync(join(root, "reports", "critic-review.json"), "{}");
    expect(reportsLayout(root, undefined)).toEqual([]);
  });

  test("accepts report names matching submission, review, and probe-NN shapes and attributes them to a known task", () => {
    const root = scratchRoot("accepts-report-names-matching-submission-review-an");
    mkdirSync(join(root, "reports"));
    writeFileSync(join(root, "reports", "T-1-submission.json"), "{}");
    writeFileSync(join(root, "reports", "T-1-review.json"), "{}");
    writeFileSync(join(root, "reports", "T-1-probe-01.json"), "{}");
    const state = { tasks: { "T-1": {} } };
    expect(reportsLayout(root, state)).toEqual([]);
  });

  test("reports REPORT_UNDECLARED for a name that matches no known report shape", () => {
    const root = scratchRoot("reports-report-undeclared-for-a-name-that-matches-");
    mkdirSync(join(root, "reports"));
    writeFileSync(join(root, "reports", "random-file.json"), "{}");
    const found = reportsLayout(root, undefined);
    expect(found).toEqual([expect.objectContaining({ code: "REPORT_UNDECLARED" })]);
  });

  test("reports REPORT_UNDECLARED when the report names a task the run does not know about", () => {
    const root = scratchRoot("reports-report-undeclared-when-the-report-names-a-");
    mkdirSync(join(root, "reports"));
    writeFileSync(join(root, "reports", "T-unknown-submission.json"), "{}");
    const state = { tasks: { "T-1": {} } };
    const found = reportsLayout(root, state);
    expect(found).toEqual([expect.objectContaining({ code: "REPORT_UNDECLARED" })]);
  });

  test("accepts any owner when state.tasks is absent, since ownership cannot be checked", () => {
    const root = scratchRoot("accepts-any-owner-when-state-tasks-is-absent-since");
    mkdirSync(join(root, "reports"));
    writeFileSync(join(root, "reports", "T-anything-submission.json"), "{}");
    expect(reportsLayout(root, undefined)).toEqual([]);
    expect(reportsLayout(root, { tasks: "not-an-object" })).toEqual([]);
  });

  test("falls through to the other kind when lstat on a listed entry itself fails", () => {
    const root = scratchRoot("falls-through-to-the-other-kind-when-lstat-on-a-li");
    const reportsDir = join(root, "reports");
    mkdirSync(reportsDir);
    writeFileSync(join(reportsDir, "T-1-submission.json"), "{}");
    // Read+write but no execute on the directory: readdirSync can still list the name, but lstat
    // on that name requires traversal (execute) permission and fails with EACCES.
    chmodSync(reportsDir, 0o600);
    try {
      const found = reportsLayout(root, undefined);
      expect(found).toEqual([expect.objectContaining({ code: "REPORT_UNDECLARED" })]);
    } finally {
      chmodSync(reportsDir, 0o755);
    }
  });

  test("reports REPORT_UNDECLARED for a directory entry that is neither a file nor a directory", () => {
    const root = scratchRoot("reports-report-undeclared-for-a-directory-entry-th");
    mkdirSync(join(root, "reports"));
    symlinkSync(join(root, "reports", "missing-target"), join(root, "reports", "broken-link.json"));
    const found = reportsLayout(root, undefined);
    expect(found).toEqual([
      expect.objectContaining({
        code: "REPORT_UNDECLARED",
        message: expect.stringContaining("holds something other than a report file"),
      }),
    ]);
  });
});
