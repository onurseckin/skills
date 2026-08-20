import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { verifyCapsuleLayout } from "../../../orchestrating-long-tasks/scripts/src/store/layout-integrity.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runWithTask(runId = "run-reports"): string {
  const root = mkdtempSync(join(tmpdir(), "layout-reports-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  const run = initRun(repo, runId, new TextEncoder().encode("prompt\n"), "file", true);
  transact(run, "coordinator", "plan-compiled", { task_id: "T-1" }, (state) => {
    state.tasks = { "T-1": { id: "T-1", status: "changes_requested" } };
  });
  return run;
}

function codes(run: string): string[] {
  return verifyCapsuleLayout(run).map((issue) => issue.code);
}

function write(run: string, name: string, body = "{}"): void {
  mkdirSync(join(run, "reports"), { recursive: true });
  writeFileSync(join(run, "reports", name), body, "utf-8");
}

describe("reports/ holds only the shapes the harness itself writes", () => {
  test("every recognized shape for a known task raises nothing", () => {
    const run = runWithTask();
    write(run, "T-1-submission.json");
    write(run, "T-1-review.json");
    write(run, "T-1-probe-01.json");
    write(run, "critic-review.json");

    expect(codes(run)).toEqual([]);
  });

  test("a report for a task this run never planned is reported", () => {
    const run = runWithTask();
    write(run, "T-99-submission.json");

    expect(codes(run)).toContain("REPORT_UNDECLARED");
  });

  test("a name that matches no recognized report shape is reported", () => {
    const run = runWithTask();
    write(run, "notes.json");

    expect(codes(run)).toContain("REPORT_UNDECLARED");
  });

  test("a directory sitting in reports/ is reported rather than silently walked", () => {
    const run = runWithTask();
    mkdirSync(join(run, "reports", "screenshots"), { recursive: true });

    expect(codes(run)).toContain("REPORT_UNDECLARED");
  });

  test("a capsule with no reports/ directory raises nothing", () => {
    const run = runWithTask();

    expect(codes(run)).toEqual([]);
  });

  test("a report is not compared to current state, since a review is a snapshot in time", () => {
    // task.status has moved on since T-1-review.json would have been written; content is
    // deliberately not part of this check (see layout-reports.ts), only naming is.
    const run = runWithTask();
    transact(run, "validator", "task-reviewed", {}, (state) => {
      (state.tasks as Record<string, { status: string }>)["T-1"]!.status = "done";
    });
    write(run, "T-1-review.json", JSON.stringify({ status: "changes_requested" }));

    expect(codes(run)).toEqual([]);
  });
});
