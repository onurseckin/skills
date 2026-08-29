import { describe, expect, it } from "bun:test";
import {
  CAPSULE_DISK_HYGIENE_INVARIANT,
  DENSITY_BUDGET_INVARIANT,
  EXPLICIT_FACADE_EXPORTS_INVARIANT,
  MAX_FILES_PER_DIRECTORY,
  MAX_LINES_PER_FILE,
  MODULARITY_AND_ZERO_COMMENTS_VIOLATION,
  ZERO_COMMENTS_INVARIANT,
  assertNoModularityOrCommentsViolations,
  auditModularityAndZeroCommentsDefects,
  formatModularityViolationReport,
  inspectCapsuleHygieneViolation,
  inspectDensityViolation,
  inspectFacadeViolation,
  inspectFileCommentsViolation,
  remediateCommentViolations,
} from "../../../olt/scripts/src/validation/index.ts";

describe("Defect Modularity Facade and Zero-Comments Validation", () => {
  describe("1. Invariant Constants & Error Code", () => {
    it("defines the exact violation error code and invariants", () => {
      expect(MODULARITY_AND_ZERO_COMMENTS_VIOLATION).toBe("MODULARITY_AND_ZERO_COMMENTS_VIOLATION");
      expect(ZERO_COMMENTS_INVARIANT).toBe("zero_comments_invariant");
      expect(DENSITY_BUDGET_INVARIANT).toBe("density_budget_invariant");
      expect(EXPLICIT_FACADE_EXPORTS_INVARIANT).toBe("explicit_facade_exports_invariant");
      expect(CAPSULE_DISK_HYGIENE_INVARIANT).toBe("capsule_disk_hygiene_invariant");
      expect(MAX_LINES_PER_FILE).toBe(300);
      expect(MAX_FILES_PER_DIRECTORY).toBe(10);
    });
  });

  describe("2. Comments Violation Inspection", () => {
    it("detects single-line and multi-line comments", () => {
      const source = ["const a = 1; // line comment", "/* block comment */", "const b = 2;"].join(
        "\n",
      );
      const violations = inspectFileCommentsViolation("src/foo.ts", source);
      expect(violations.length).toBe(2);
      expect(violations[0]?.commentType).toBe("line");
      expect(violations[0]?.lineNumber).toBe(1);
      expect(violations[1]?.commentType).toBe("block");
      expect(violations[1]?.lineNumber).toBe(2);
    });

    it("ignores URLs and slashes within string literals and template literals", () => {
      const source = [
        'const doubleQuoteUrl = "https://example.com/api//v1/query?param=1";',
        "const singleQuoteUrl = 'http://domain.org/nested//path';",
        "const templateStr = `https://antigravity.dev//api and // not a comment`;",
      ].join("\n");
      const violations = inspectFileCommentsViolation("src/clean.ts", source);
      expect(violations.length).toBe(0);
    });

    it("detects comments inside template interpolation expressions", () => {
      const source = "const rendered = `prefix ${ /* inner comment */ id } suffix`;";
      const violations = inspectFileCommentsViolation("src/template.ts", source);
      expect(violations.length).toBe(1);
      expect(violations[0]?.commentType).toBe("block");
      expect(violations[0]?.lineNumber).toBe(1);
    });

    it("handles escaped characters and quotes properly", () => {
      const source = 'const escaped = "escaped \\" quote with https://url.com"; // real comment';
      const violations = inspectFileCommentsViolation("src/escaped.ts", source);
      expect(violations.length).toBe(1);
      expect(violations[0]?.commentType).toBe("line");
    });
  });

  describe("3. Density Violation Inspection", () => {
    it("accepts file line counts and directory counts within budget", () => {
      const violations = inspectDensityViolation("src/mod.ts", 250, 8);
      expect(violations.length).toBe(0);
    });

    it("detects files exceeding the 300-line limit", () => {
      const violations = inspectDensityViolation("src/bloated.ts", 301);
      expect(violations.length).toBe(1);
      expect(violations[0]?.violationType).toBe("file_line_budget");
      expect(violations[0]?.actual).toBe(301);
      expect(violations[0]?.maxBudget).toBe(300);
    });

    it("detects directories exceeding the 10-file limit", () => {
      const violations = inspectDensityViolation("src/dir/file.ts", 100, 11);
      expect(violations.length).toBe(1);
      expect(violations[0]?.violationType).toBe("directory_density_budget");
      expect(violations[0]?.actual).toBe(11);
      expect(violations[0]?.maxBudget).toBe(10);
    });
  });

  describe("4. Facade Violation Inspection", () => {
    it("detects wildcard exports in facades", () => {
      const source = ['export * from "./module.ts";', 'export * as sub from "./other.ts";'].join(
        "\n",
      );
      const violations = inspectFacadeViolation("src/index.ts", source);
      expect(violations.length).toBe(2);
      expect(violations[0]?.violationType).toBe("wildcard_export");
      expect(violations[1]?.violationType).toBe("wildcard_export");
    });

    it("detects default exports in index facades", () => {
      const source = "export default function main() {}";
      const violations = inspectFacadeViolation("src/index.ts", source);
      expect(violations.length).toBe(1);
      expect(violations[0]?.violationType).toBe("default_export");
    });

    it("detects direct imports bypassing facades into internal implementation paths", () => {
      const source = 'import { helper } from "../feature/internal/engine.ts";';
      const violations = inspectFacadeViolation("src/caller.ts", source);
      expect(violations.length).toBe(1);
      expect(violations[0]?.violationType).toBe("facade_bypass");
    });

    it("accepts valid explicit named facade exports", () => {
      const source = [
        'export { foo, bar } from "./module.ts";',
        'export { type FooOptions } from "./types.ts";',
      ].join("\n");
      const violations = inspectFacadeViolation("src/index.ts", source);
      expect(violations.length).toBe(0);
    });
  });

  describe("5. Capsule Hygiene Inspection", () => {
    it("detects temporary artifacts, backups, and scratch files in capsules", () => {
      const files = [
        "manifest.json",
        "temp-run.log",
        "scratch.ts",
        "archive.old",
        ".DS_Store",
        "temp.tmp",
      ];
      const violations = inspectCapsuleHygieneViolation("/capsule/run-1", files);
      expect(violations.length).toBe(5);
      expect(violations.some((v) => v.fileName === "temp-run.log")).toBe(true);
      expect(violations.some((v) => v.fileName === "scratch.ts")).toBe(true);
      expect(violations.some((v) => v.fileName === ".DS_Store")).toBe(true);
    });

    it("accepts clean capsule directory entries", () => {
      const files = ["manifest.json", "evidence.png", "index.ts", "state.json"];
      const violations = inspectCapsuleHygieneViolation("/capsule/run-1", files);
      expect(violations.length).toBe(0);
    });
  });

  describe("6. Defect Audit Aggregation and Assertion", () => {
    it("passes audit when all invariants are satisfied", () => {
      const result = auditModularityAndZeroCommentsDefects({
        files: [
          {
            path: "src/clean.ts",
            content: 'export const msg = "https://example.com";\nexport const x = 1;',
          },
        ],
        directories: [{ path: "src", fileCount: 4 }],
        capsules: [{ path: "capsules/task-1", fileNames: ["manifest.json", "state.json"] }],
      });
      expect(result.passed).toBe(true);
      expect(result.totalViolations).toBe(0);
      expect(result.errorCode).toBeUndefined();
      expect(result.verifiedInvariants).toContain(ZERO_COMMENTS_INVARIANT);
      expect(result.verifiedInvariants).toContain(DENSITY_BUDGET_INVARIANT);
      expect(result.verifiedInvariants).toContain(EXPLICIT_FACADE_EXPORTS_INVARIANT);
      expect(result.verifiedInvariants).toContain(CAPSULE_DISK_HYGIENE_INVARIANT);
      expect(() => assertNoModularityOrCommentsViolations(result)).not.toThrow();
    });

    it("fails audit and throws MODULARITY_AND_ZERO_COMMENTS_VIOLATION when violations exist", () => {
      const result = auditModularityAndZeroCommentsDefects({
        files: [{ path: "src/dirty.ts", content: 'export * from "./internal.ts"; // comment' }],
        directories: [{ path: "src/overcrowded", fileCount: 15 }],
        capsules: [{ path: "capsules/task-dirty", fileNames: ["scratch.ts", "temp.tmp"] }],
      });
      expect(result.passed).toBe(false);
      expect(result.totalViolations).toBeGreaterThan(0);
      expect(result.errorCode).toBe(MODULARITY_AND_ZERO_COMMENTS_VIOLATION);
      expect(() => assertNoModularityOrCommentsViolations(result)).toThrow(
        MODULARITY_AND_ZERO_COMMENTS_VIOLATION,
      );
    });
  });

  describe("7. Report Formatting", () => {
    it("formats pass report with verified invariants", () => {
      const result = auditModularityAndZeroCommentsDefects({
        files: [{ path: "src/clean.ts", content: "export const x = 1;" }],
      });
      const report = formatModularityViolationReport(result);
      expect(report).toContain("MODULARITY & ZERO-COMMENTS AUDIT PASSED");
      expect(report).toContain(ZERO_COMMENTS_INVARIANT);
    });

    it("formats failure report detailing defect categories", () => {
      const result = auditModularityAndZeroCommentsDefects({
        files: [{ path: "src/bad.ts", content: "// bad\nexport * from './mod.ts';" }],
        capsules: [{ path: "capsules/bad", fileNames: ["scratch.ts"] }],
      });
      const report = formatModularityViolationReport(result);
      expect(report).toContain("FAILED");
      expect(report).toContain(MODULARITY_AND_ZERO_COMMENTS_VIOLATION);
      expect(report).toContain("Comment Violations");
      expect(report).toContain("Facade Violations");
      expect(report).toContain("Capsule Hygiene Violations");
    });
  });

  describe("8. Comment Remediation Utility", () => {
    it("removes line and block comments while preserving string contents and URLs", () => {
      const dirty = [
        "// file banner",
        'const url = "https://example.com/api//v1"; // trailing comment',
        "/* block note */ const count = 42;",
        "export { url, count };",
      ].join("\n");
      const cleaned = remediateCommentViolations(dirty);
      expect(cleaned).toContain('const url = "https://example.com/api//v1";');
      expect(cleaned).toContain("const count = 42;");
      expect(cleaned).toContain("export { url, count };");
      expect(cleaned).not.toContain("file banner");
      expect(cleaned).not.toContain("trailing comment");
      expect(cleaned).not.toContain("block note");
      const rechecked = inspectFileCommentsViolation("src/cleaned.ts", cleaned);
      expect(rechecked.length).toBe(0);
    });
  });
});
