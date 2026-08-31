import { afterAll, describe, expect, test } from "bun:test";
import { buildModules } from "../../../olt/scripts/src/health/modules.ts";
import { checkDeadCode } from "../../../olt/scripts/src/health/dead-code.ts";
import { cleanupTempRoots, loadTree, sourceOf } from "../fixture.ts";

afterAll(cleanupTempRoots);

function findings(relative: string, text: string): string[] {
  const file = sourceOf(relative, text);
  return checkDeadCode([file], buildModules([file])).findings.map((entry) => entry.detail);
}

describe("Health Checks - Dead Code Detection & Duplicate Helpers", () => {
  describe("code someone stopped running is still code", () => {
    test("a commented-out statement is reported with the line it sits on", () => {
      const file = sourceOf(
        "sample.ts",
        ["const a = 1;", "// const b = 2;", "const c = 3;"].join("\n"),
      );
      const result = checkDeadCode([file], buildModules([file])).findings;
      expect(result).toHaveLength(1);
      expect(result[0]?.line).toBe(2);
      expect(result[0]?.detail).toContain("const b = 2;");
    });

    test("a commented-out block counts every line it holds", () => {
      expect(
        findings("sample.ts", ["/*", " * if (ready) {", " *   run();", " * }", " */"].join("\n"))[0],
      ).toContain("3 line(s)");
    });

    test("prose in a comment is not code", () => {
      expect(
        findings(
          "sample.ts",
          ["// The caller decides whether to run this, and why it matters.", "const a = 1;"].join(
            "\n",
          ),
        ),
      ).toEqual([]);
    });

    test("a call left behind as a comment is reported", () => {
      expect(findings("sample.ts", "// recordEvent(state, event);")[0]).toContain("recordEvent");
    });
  });

  describe("a branch kept for a shape that no longer exists", () => {
    test("an identifier naming a legacy path is reported", () => {
      expect(findings("sample.ts", "export const legacyShape = 1;")[0]).toContain("legacy");
    });

    test("a comment describing a superseded shape is reported", () => {
      expect(
        findings("sample.ts", "// Deprecated: the writer no longer emits this.\nconst a = 1;")[0],
      ).toContain("superseded shape");
    });

    test("only the first identifier hit per file is reported, so one branch is one finding", () => {
      const detail = findings(
        "sample.ts",
        ["export const legacyOne = 1;", "export const legacyTwo = 2;"].join("\n"),
      );
      expect(detail.filter((entry) => entry.includes("names a path kept"))).toHaveLength(1);
    });

    test("a vendor name in a string is not a legacy branch", () => {
      expect(findings("sample.ts", 'const note = "legacy";')).toEqual([]);
    });
  });

  describe("a helper implemented twice is where the next divergence starts", () => {
    test("the duplicate names every module that exports it", () => {
      const tree = loadTree("duplicates", {
        "left.ts": "export function sameJson(): boolean {\n  return true;\n}",
        "right.ts": "export function sameJson(): boolean {\n  return false;\n}",
        "only.ts": "export function unique(): boolean {\n  return true;\n}",
      });
      const result = checkDeadCode(tree.files, tree.modules).findings;
      const duplicate = result.find((entry) => entry.key === "duplicate-helper:sameJson");
      expect(duplicate?.detail).toContain("left.ts");
      expect(duplicate?.detail).toContain("right.ts");
      expect(result.map((entry) => entry.key)).not.toContain("duplicate-helper:unique");
    });

    test("a re-export is not a second implementation", () => {
      const tree = loadTree("reexport-duplicates", {
        "source.ts": "export function shared(): number {\n  return 1;\n}",
        "barrel.ts": 'export { shared } from "./source.ts";',
      });
      expect(
        checkDeadCode(tree.files, tree.modules).findings.map((entry) => entry.key),
      ).not.toContain("duplicate-helper:shared");
    });

    test("the check states what it cannot see", () => {
      expect(checkDeadCode([], buildModules([])).limitations.length).toBeGreaterThan(0);
    });
  });
});
