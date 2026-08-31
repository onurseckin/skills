import { describe, expect, test } from "bun:test";
import { validateGraph } from "../../../olt/scripts/src/graph/validate-graph.ts";
import { validPlanningDocuments } from "../validation/fixtures.ts";

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
    for (const segment of ["con", "aux", "prn", "com1", "lpt1", "NUL"]) {
      const issues = commandIssues(["bun", "test", `sub/${segment}/file.test.ts`]);
      expect(pathFormIssues(issues)).toHaveLength(1);
      expect(issues).not.toContain(weaknessIssue);
    }
  });

  test("a command flawed both ways is handled deterministically: path form wins", () => {
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
    expect(commandIssues(["bun", "test", "tests/planning"])).toEqual([]);
  });
});
