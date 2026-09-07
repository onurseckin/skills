import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { reportsLayout } from "../../../olt/scripts/src/engine/store/layout/layout-reports.ts";
import {
  chmodSync,
  cleanupVirtualStoreFS,
  getVirtualStoreFS,
  scratchRoot as makeScratchRoot,
  setupVirtualStoreFS,
  symlinkSync,
} from "../store-fixture.ts";

beforeEach(() => {
  setupVirtualStoreFS();
});

afterEach(() => {
  cleanupVirtualStoreFS();
});

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

describe("reportsLayout", () => {
  test("returns no issues when reports/ does not exist", () => {
    const root = scratchRoot("returns-no-issues-when-reports-does-not-exist");
    expect(reportsLayout(root, undefined)).toEqual([]);
  });

  test("returns REPORT_UNREADABLE when reports/ exists but is not a directory", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("returns-report-unreadable-when-reports-exists-but-");
    vfs.writeFileSync(join(root, "reports"), "not a directory");
    const found = reportsLayout(root, undefined);
    expect(found).toEqual([expect.objectContaining({ code: "REPORT_UNREADABLE" })]);
  });

  test("ignores dotfiles and subdirectories inside reports/", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("ignores-dotfiles-and-subdirectories-inside-reports");
    vfs.mkdirSync(join(root, "reports"), { recursive: true });
    vfs.writeFileSync(join(root, "reports", ".hidden"), "ignored");
    vfs.mkdirSync(join(root, "reports", "a-subdirectory"), { recursive: true });
    expect(reportsLayout(root, undefined)).toEqual([]);
  });

  test("accepts the fixed critic-review.json name unconditionally", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("accepts-the-fixed-critic-review-json-name-uncondit");
    vfs.mkdirSync(join(root, "reports"), { recursive: true });
    vfs.writeFileSync(join(root, "reports", "critic-review.json"), "{}");
    expect(reportsLayout(root, undefined)).toEqual([]);
  });

  test("accepts report names matching submission, review, and probe-NN shapes and attributes them to a known task", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("accepts-report-names-matching-submission-review-an");
    vfs.mkdirSync(join(root, "reports"), { recursive: true });
    vfs.writeFileSync(join(root, "reports", "T-1-submission.json"), "{}");
    vfs.writeFileSync(join(root, "reports", "T-1-review.json"), "{}");
    vfs.writeFileSync(join(root, "reports", "T-1-probe-01.json"), "{}");
    const state = { tasks: { "T-1": {} } };
    expect(reportsLayout(root, state)).toEqual([]);
  });

  test("reports REPORT_UNDECLARED for a name that matches no known report shape", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("reports-report-undeclared-for-a-name-that-matches-");
    vfs.mkdirSync(join(root, "reports"), { recursive: true });
    vfs.writeFileSync(join(root, "reports", "random-file.json"), "{}");
    const found = reportsLayout(root, undefined);
    expect(found).toEqual([expect.objectContaining({ code: "REPORT_UNDECLARED" })]);
  });

  test("reports REPORT_UNDECLARED when the report names a task the run does not know about", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("reports-report-undeclared-when-the-report-names-a-");
    vfs.mkdirSync(join(root, "reports"), { recursive: true });
    vfs.writeFileSync(join(root, "reports", "T-unknown-submission.json"), "{}");
    const state = { tasks: { "T-1": {} } };
    const found = reportsLayout(root, state);
    expect(found).toEqual([expect.objectContaining({ code: "REPORT_UNDECLARED" })]);
  });

  test("accepts any owner when state.tasks is absent, since ownership cannot be checked", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("accepts-any-owner-when-state-tasks-is-absent-since");
    vfs.mkdirSync(join(root, "reports"), { recursive: true });
    vfs.writeFileSync(join(root, "reports", "T-anything-submission.json"), "{}");
    expect(reportsLayout(root, undefined)).toEqual([]);
    expect(reportsLayout(root, { tasks: "not-an-object" })).toEqual([]);
  });

  test("falls through to the other kind when lstat on a listed entry itself fails", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("falls-through-to-the-other-kind-when-lstat-on-a-li");
    const reportsDir = join(root, "reports");
    vfs.mkdirSync(reportsDir, { recursive: true });
    vfs.writeFileSync(join(reportsDir, "T-1-submission.json"), "{}");
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
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("reports-report-undeclared-for-a-directory-entry-th");
    vfs.mkdirSync(join(root, "reports"), { recursive: true });
    symlinkSync(join(root, "reports", "missing-target"), join(root, "reports", "broken-link.json"));
    const found = reportsLayout(root, undefined);
    expect(found).toEqual([
      expect.objectContaining({
        code: "REPORT_UNDECLARED",
        message: expect.stringContaining("holds something other than a report file"),
      }),
    ]);
  });

  test("handles complex task identifiers and rejects invalid probe number digits", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("complex-task-ids-and-probe-digits");
    vfs.mkdirSync(join(root, "reports"), { recursive: true });

    // Valid complex task ID with 2-digit probe or standard suffix
    vfs.writeFileSync(join(root, "reports", "T-42-subtask-review.json"), "{}");
    vfs.writeFileSync(join(root, "reports", "T-42-subtask-probe-01.json"), "{}");

    // Invalid probe shape (3 digits instead of 2: probe-999)
    vfs.writeFileSync(join(root, "reports", "T-1-probe-999.json"), "{}");

    const state = { tasks: { "T-42-subtask": {}, "T-1": {} } };
    const found = reportsLayout(root, state);

    // T-42-subtask files are valid, T-1-probe-999.json is rejected
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: "REPORT_UNDECLARED",
      message: expect.stringContaining("report name matches no known shape: T-1-probe-999.json"),
    });
  });

  test("reports REPORT_UNREADABLE when reports/ directory itself is unreadable (mode 000)", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot("completely-unreadable-reports-dir");
    const reportsDir = join(root, "reports");
    vfs.mkdirSync(reportsDir, { recursive: true });
    vfs.writeFileSync(join(reportsDir, "T-1-submission.json"), "{}");

    chmodSync(reportsDir, 0o000);
    try {
      const found = reportsLayout(root, undefined);
      expect(found).toEqual([
        expect.objectContaining({
          code: "REPORT_UNREADABLE",
          message: expect.stringContaining("reports/ is unreadable"),
        }),
      ]);
    } finally {
      chmodSync(reportsDir, 0o755);
    }
  });
});
