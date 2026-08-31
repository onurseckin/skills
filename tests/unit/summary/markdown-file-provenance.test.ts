import { describe, expect, test } from "bun:test";
import {
  fileProvenanceDetails,
  fileProvenanceTable,
  type AttributedFileRef,
} from "../../../olt/scripts/src/summary/markdown/index.ts";

/**
 * Direct unit coverage of the B15.2 renderer: line ranges, diff, additions/deletions, rationale,
 * requirement ids and the step that produced each file, plus the honest-absence cases where one of
 * those was never observed.
 */
describe("fileProvenanceTable (B15.2 overview)", () => {
  test("no file was reported: the table is a note, not an empty header", () => {
    expect(fileProvenanceTable([])).toEqual([
      "_No agent reported a changed file and no branch observation recorded one._",
    ]);
  });

  test("a fully enriched file carries its step, mode, lines, delta and evidence in one row", () => {
    const entry: AttributedFileRef = {
      reportedBy: "task-1",
      file: {
        path: "src/a.ts",
        mode: "write",
        lines: "12-18,44",
        additions: 9,
        deletions: 2,
        evidence_class: "agent_reported",
        step: 9,
      },
    };
    const rows = fileProvenanceTable([entry]);
    expect(rows).toContain(
      "| `src/a.ts` | `task-1` | 9 | write | 12-18,44 | +9/-2 | agent_reported |",
    );
  });

  test("a file with no diff reading has an unknown step, lines and delta, not a fabricated zero", () => {
    const entry: AttributedFileRef = {
      reportedBy: "task-1",
      file: { path: "src/b.ts", evidence_class: "agent_reported" },
    };
    const rows = fileProvenanceTable([entry]);
    expect(rows).toContain(
      "| `src/b.ts` | `task-1` | unknown | unknown | unknown | unknown | agent_reported |",
    );
  });

  test("additions of zero still render, distinct from unknown", () => {
    const entry: AttributedFileRef = {
      reportedBy: "branch-1",
      file: { path: "src/c.ts", additions: 0, deletions: 4 },
    };
    const rows = fileProvenanceTable([entry]);
    expect(rows).toContain(
      "| `src/c.ts` | `branch-1` | unknown | unknown | unknown | +0/-4 | unknown |",
    );
  });
});

describe("fileProvenanceDetails (B15.2 why and diff)", () => {
  test("a file with neither a rationale nor a diff earns no detail block", () => {
    const entry: AttributedFileRef = {
      reportedBy: "task-1",
      file: { path: "src/a.ts", evidence_class: "harness_observed" },
    };
    expect(fileProvenanceDetails([entry])).toEqual([]);
  });

  test("a file with a rationale and a diff carries both, the diff whole and unfenced-by-its-own-content", () => {
    const diff =
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;";
    const entry: AttributedFileRef = {
      reportedBy: "task-1",
      file: {
        path: "src/a.ts",
        rationale: "Bumped the constant for the new grammar",
        requirementIds: ["REQ-1", "REQ-2"],
        diff,
      },
    };
    const lines = fileProvenanceDetails([entry]).join("\n");
    expect(lines).toContain("#### `src/a.ts` (task-1)");
    expect(lines).toContain("- **Why**: Bumped the constant for the new grammar");
    expect(lines).toContain("- **Requirements served**: `REQ-1`, `REQ-2`");
    expect(lines).toContain("```diff");
    expect(lines).toContain("-export const a = 1;");
    expect(lines).toContain("+export const a = 2;");
  });

  test("a rationale with no readable diff says so instead of omitting the file", () => {
    const entry: AttributedFileRef = {
      reportedBy: "task-1",
      file: { path: "src/a.ts", rationale: "Alpha complete" },
    };
    const lines = fileProvenanceDetails([entry]).join("\n");
    expect(lines).toContain("- **Why**: Alpha complete");
    expect(lines).toContain("No diff could be read for this path against the run's baseline.");
  });

  test("a diff with no rationale renders unknown for why, not a blank line", () => {
    const entry: AttributedFileRef = {
      reportedBy: "branch-1",
      file: { path: "src/a.ts", diff: "@@ -1 +1 @@\n-a\n+b" },
    };
    const lines = fileProvenanceDetails([entry]).join("\n");
    expect(lines).toContain("- **Why**: unknown");
  });

  test("only files carrying detail get a block; the rest are silently skipped, not padded with unknowns", () => {
    const entries: AttributedFileRef[] = [
      { reportedBy: "task-1", file: { path: "src/bare.ts" } },
      { reportedBy: "task-1", file: { path: "src/a.ts", rationale: "did the thing" } },
    ];
    const lines = fileProvenanceDetails(entries).join("\n");
    expect(lines).not.toContain("src/bare.ts");
    expect(lines).toContain("src/a.ts");
  });

  test("a branch-observed file with neither rationale nor diff still earns a block for its Git status and hash", () => {
    const entry: AttributedFileRef = {
      reportedBy: "branch-1",
      file: { path: "src/moved.ts", statusCode: "M", sha256: "f".repeat(64) },
    };
    const lines = fileProvenanceDetails([entry]).join("\n");
    expect(lines).toContain("#### `src/moved.ts` (branch-1)");
    expect(lines).toContain("- **Why**: unknown");
    expect(lines).toContain(`- **Git status**: \`M\``);
    expect(lines).toContain(`- **Content hash**: \`${"f".repeat(64)}\``);
  });

  test("a deleted path's null hash says no content was observed, never unknown or a fabricated digest", () => {
    const entry: AttributedFileRef = {
      reportedBy: "branch-1",
      file: { path: "src/gone.ts", statusCode: "D", sha256: null },
    };
    const lines = fileProvenanceDetails([entry]).join("\n");
    expect(lines).toContain("- **Git status**: `D`");
    expect(lines).toContain(
      "- **Content hash**: no content to hash — the path carries no readable file at this status",
    );
    expect(lines).not.toContain("**Content hash**: unknown");
  });

  test("a status code with no hash field at all renders the hash as unknown, not blank", () => {
    const entry: AttributedFileRef = {
      reportedBy: "branch-1",
      file: { path: "src/partial.ts", statusCode: "A" },
    };
    const lines = fileProvenanceDetails([entry]).join("\n");
    expect(lines).toContain("- **Git status**: `A`");
    expect(lines).toContain("- **Content hash**: unknown");
  });
});
