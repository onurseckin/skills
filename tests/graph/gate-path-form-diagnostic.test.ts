import { describe, expect, test } from "bun:test";
import { validateGraph } from "../../olt/scripts/src/graph/validate-graph.ts";
import { validPlanningDocuments } from "./fixtures.ts";

// T6: `commandIsWeak` (read-only gate-command-policy.ts) folds path-form rejection and genuine
// weakness into one boolean, so a gate whose only flaw is an absolute-path operand was reported
// with a message about *rigour* ("must perform substantive verification") when the true cause is
// *path form*. These two substrings are how a caller tells the causes apart: neither message may
// contain the other's trigger phrase, so `toContain`/`not.toContain` on these constants is a real
// mechanism check, not prose-squinting.
const weaknessIssue = "gates[0].command must perform substantive verification";
const pathFormMarker = "must be a repository-relative path";

function commandIssues(command: unknown): string[] {
  const { graph, requirements } = validPlanningDocuments();
  const gates = graph.gates as Record<string, unknown>[];
  const gate = gates[0];
  if (gate === undefined) throw new Error("fixture must produce at least one gate");
  gate.command = command;
  return validateGraph(graph, requirements);
}

function pathFormIssues(issues: string[]): string[] {
  return issues.filter((issue) => issue.includes(pathFormMarker));
}

describe("gate path-form diagnostic is separately identifiable from weakness", () => {
  test("an absolute-path-only flaw is named as path form, not as a weakness failure", () => {
    const issues = commandIssues([
      "bun",
      "test",
      "/Users/onurseckinsenoglu/repos/skills/tests/unit/mind/x.test.ts",
    ]);
    expect(pathFormIssues(issues)).toHaveLength(1);
    expect(issues.some((issue) => issue.includes(pathFormMarker))).toBe(true);
    expect(issues).not.toContain(weaknessIssue);
    // The operand itself is named in the message, not just "a path is wrong somewhere".
    expect(pathFormIssues(issues)[0]).toContain(
      "/Users/onurseckinsenoglu/repos/skills/tests/unit/mind/x.test.ts",
    );
  });

  test("a UNC/drive-letter-form operand is also named as path form, not weakness", () => {
    const issues = commandIssues(["bun", "test", "C:\\repo\\x.test.ts"]);
    expect(pathFormIssues(issues)).toHaveLength(1);
    expect(issues).not.toContain(weaknessIssue);
  });

  test("genuinely weak commands (no unsafe operand) still report weakness, not path form", () => {
    for (const command of [["true"], ["echo", "ok"]]) {
      const issues = commandIssues(command);
      expect(issues).toContain(weaknessIssue);
      expect(pathFormIssues(issues)).toHaveLength(0);
    }
  });

  test("parent-traversal operands are rejected as path form via hasUnsafeWin32Component", () => {
    const issues = commandIssues(["bun", "test", "../outside/x.test.ts"]);
    expect(pathFormIssues(issues)).toHaveLength(1);
    expect(issues).not.toContain(weaknessIssue);
    expect(pathFormIssues(issues)[0]).toContain("../outside/x.test.ts");
  });

  test("reserved Win32 device-name path segments are rejected as path form, cross-platform", () => {
    // hasUnsafeWin32Component fires on POSIX hosts too: the rule protects Windows hosts sharing
    // this graph, so it must not be gated on the host the validator happens to run on.
    for (const segment of ["con", "aux", "prn", "com1", "lpt1", "NUL"]) {
      const issues = commandIssues(["bun", "test", `sub/${segment}/file.test.ts`]);
      expect(pathFormIssues(issues)).toHaveLength(1);
      expect(issues).not.toContain(weaknessIssue);
    }
  });

  test("a command flawed both ways is handled deterministically: path form wins", () => {
    // Chosen behaviour: path-form is checked first and short-circuits the weakness check.
    // Justification — an unsafe operand path makes the command unsafe/non-portable to run at
    // all, so naming that is the actionable fix; whether the command would *also* be considered
    // weak is unknowable/irrelevant until the path is corrected (fixing the path may well change
    // the weakness verdict too, e.g. a `bun test <path>` gate becomes strong once relativized).
    // A single, unambiguous diagnostic beats reporting two causes where only one is currently
    // actionable.
    const noopWithAbsolutePath = commandIssues(["echo", "/Users/onurseckinsenoglu/abs.txt"]);
    expect(pathFormIssues(noopWithAbsolutePath)).toHaveLength(1);
    expect(noopWithAbsolutePath).not.toContain(weaknessIssue);

    const dryRunWithAbsolutePath = commandIssues([
      "custom-check",
      "--dry-run",
      "/Users/onurseckinsenoglu/abs.txt",
    ]);
    expect(pathFormIssues(dryRunWithAbsolutePath)).toHaveLength(1);
    expect(dryRunWithAbsolutePath).not.toContain(weaknessIssue);
  });

  test("a valid repo-relative gate still validates cleanly (no regression)", () => {
    expect(commandIssues(["bun", "test", "tests/unit/foo.test.ts"])).toEqual([]);
    // Baseline fixture command, unchanged, must also still be clean.
    expect(commandIssues(["bun", "test", "tests/planning"])).toEqual([]);
  });
});
