import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALL_NODE_PATH_MEMBERS,
  CANONICAL_NODE_PATH_SPECIFIER,
  DEFAULT_CHECKED_PATH_FUNCTIONS,
  DEFECT_REF,
  ERROR_CODE,
  KNOWN_DEFECTIVE_SLICE_28_FUNCTIONS,
  LEGACY_PATH_SPECIFIER,
  MISSING_NODE_PATH_IMPORTS,
  MissingNodePathImportError,
  TARGET_AUDITING_SLICE,
  assertSlicePathImportsPurity,
  auditAuditingSlices,
  auditSlice28,
  auditSliceDirectory,
  auditSliceFile,
  auditSourceCodePathImports,
  createDefectProof,
  createSampleDefectiveSlice28,
  createSampleFixedSlice28,
  detectPathFunctionUsages,
  extractPathImports,
  formatPathImportAuditReport,
  identifyMissingPathImports,
  maskSourceCodeNonCode,
  remediateAuditingSlices,
  remediateSlice28,
  remediateSliceDirectory,
  remediateSliceFile,
  remediateSourceCodePathImports,
  type PathFunctionUsage,
  type PathImportAuditReport,
  type PathImportFinding,
  type PathImportRemediationResult,
  type PathImportViolationType,
} from "../../../olt/scripts/src/mind/defect-auditing-slices-missing-node-path-imports.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
});

function createTempDir(prefix = "slice-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

describe("Task 1.15: Defect Remediation - Missing 'node:path' imports in mind/auditing/slices (defect-auditing-slices-missing-node-path-imports)", () => {
  describe("1. Defect Constants & Contract Identifiers", () => {
    test("defect identifiers and error codes match specification", () => {
      expect(DEFECT_REF).toBe("defect-auditing-slices-missing-node-path-imports");
      expect(ERROR_CODE).toBe("MISSING_NODE_PATH_IMPORTS");
      expect(MISSING_NODE_PATH_IMPORTS).toBe("MISSING_NODE_PATH_IMPORTS");
      expect(TARGET_AUDITING_SLICE).toBe("mind/auditing/slices/group0/slice_28.ts");
      expect(CANONICAL_NODE_PATH_SPECIFIER).toBe("node:path");
      expect(LEGACY_PATH_SPECIFIER).toBe("path");
    });

    test("path functions and slice_28 defective function lists are correctly configured", () => {
      expect(KNOWN_DEFECTIVE_SLICE_28_FUNCTIONS).toContain("resolve");
      expect(KNOWN_DEFECTIVE_SLICE_28_FUNCTIONS).toContain("join");
      expect(KNOWN_DEFECTIVE_SLICE_28_FUNCTIONS).toContain("basename");

      expect(DEFAULT_CHECKED_PATH_FUNCTIONS).toContain("resolve");
      expect(DEFAULT_CHECKED_PATH_FUNCTIONS).toContain("join");
      expect(DEFAULT_CHECKED_PATH_FUNCTIONS).toContain("basename");
      expect(DEFAULT_CHECKED_PATH_FUNCTIONS).toContain("dirname");
      expect(DEFAULT_CHECKED_PATH_FUNCTIONS).toContain("relative");
      expect(DEFAULT_CHECKED_PATH_FUNCTIONS).toContain("normalize");
      expect(DEFAULT_CHECKED_PATH_FUNCTIONS).toContain("isAbsolute");

      expect(ALL_NODE_PATH_MEMBERS).toContain("toNamespacedPath");
      expect(ALL_NODE_PATH_MEMBERS).toContain("sep");
      expect(ALL_NODE_PATH_MEMBERS).toContain("delimiter");
    });
  });

  describe("2. Source Masker (maskSourceCodeNonCode)", () => {
    test("masks single-line and multi-line comments with whitespace while preserving line numbers", () => {
      const source = [
        "// resolve('comment')",
        "const a = 1; /* join('comment') */",
        "const b = 2;",
      ].join("\n");

      const masked = maskSourceCodeNonCode(source);
      expect(masked).not.toContain("resolve('comment')");
      expect(masked).not.toContain("join('comment')");
      expect(masked).toContain("const a = 1;");
      expect(masked).toContain("const b = 2;");
      expect(masked.split("\n")).toHaveLength(3);
    });

    test("masks single-quoted, double-quoted, and template strings containing path function names", () => {
      const source = [
        'const str1 = "resolve(a, b)";',
        "const str2 = 'join(x, y)';",
        "const str3 = `basename(p)`;",
      ].join("\n");

      const masked = maskSourceCodeNonCode(source);
      expect(masked).not.toContain("resolve(a, b)");
      expect(masked).not.toContain("join(x, y)");
      expect(masked).not.toContain("basename(p)");
      expect(masked.split("\n")).toHaveLength(3);
    });
  });

  describe("3. Path Import Extraction (extractPathImports)", () => {
    test("extracts named imports from canonical 'node:path'", () => {
      const source = 'import { basename, dirname, join, resolve } from "node:path";';
      const info = extractPathImports(source);

      expect(info.hasNodePath).toBe(true);
      expect(info.hasLegacyPath).toBe(false);
      expect(info.namedImports).toEqual(["basename", "dirname", "join", "resolve"]);
      expect(info.hasNamespaceImport).toBe(false);
      expect(info.hasDefaultImport).toBe(false);
    });

    test("extracts namespace imports from 'node:path'", () => {
      const source = 'import * as path from "node:path";';
      const info = extractPathImports(source);

      expect(info.hasNodePath).toBe(true);
      expect(info.hasNamespaceImport).toBe(true);
      expect(info.namespaceIdentifier).toBe("path");
    });

    test("extracts default and combined imports", () => {
      const source = 'import path, { resolve } from "node:path";';
      const info = extractPathImports(source);

      expect(info.hasNodePath).toBe(true);
      expect(info.hasDefaultImport).toBe(true);
      expect(info.defaultIdentifier).toBe("path");
      expect(info.namedImports).toContain("resolve");
    });

    test("detects legacy 'path' specifier", () => {
      const source = 'import { resolve, join } from "path";';
      const info = extractPathImports(source);

      expect(info.hasNodePath).toBe(false);
      expect(info.hasLegacyPath).toBe(true);
      expect(info.namedImports).toEqual(["join", "resolve"]);
    });

    test("handles CommonJS require syntax", () => {
      const source = 'const { resolve, basename } = require("node:path");';
      const info = extractPathImports(source);

      expect(info.hasNodePath).toBe(true);
      expect(info.namedImports).toContain("resolve");
      expect(info.namedImports).toContain("basename");
    });

    test("returns empty imports on source with no path imports", () => {
      const source = 'import { readFileSync } from "node:fs";\nconst x = 10;';
      const info = extractPathImports(source);

      expect(info.hasNodePath).toBe(false);
      expect(info.hasLegacyPath).toBe(false);
      expect(info.namedImports).toEqual([]);
      expect(info.importStatements).toEqual([]);
    });
  });

  describe("4. Path Function Usage Detection (detectPathFunctionUsages)", () => {
    test("detects standalone path function calls with accurate line and column", () => {
      const source = [
        'import { readFileSync } from "node:fs";',
        "export function run(baseDir: string) {",
        '  const p = resolve(baseDir, "sub");',
        '  const j = join(p, "file.txt");',
        "  const b = basename(j);",
        "  return { p, j, b };",
        "}",
      ].join("\n");

      const usages = detectPathFunctionUsages(source);
      expect(usages).toHaveLength(3);

      expect(usages[0]?.functionName).toBe("resolve");
      expect(usages[0]?.line).toBe(3);
      expect(usages[0]?.isImported).toBe(false);

      expect(usages[1]?.functionName).toBe("join");
      expect(usages[1]?.line).toBe(4);
      expect(usages[1]?.isImported).toBe(false);

      expect(usages[2]?.functionName).toBe("basename");
      expect(usages[2]?.line).toBe(5);
      expect(usages[2]?.isImported).toBe(false);
    });

    test("marks usage as isImported: true when function is in named imports", () => {
      const source = [
        'import { resolve, join } from "node:path";',
        "export function test(a: string, b: string) {",
        "  const p = resolve(a, b);",
        "  const j = join(p, 'x');",
        "  const base = basename(j);",
        "  return { p, j, base };",
        "}",
      ].join("\n");

      const usages = detectPathFunctionUsages(source);
      expect(usages).toHaveLength(3);

      const resolveUsage = usages.find((u) => u.functionName === "resolve");
      const joinUsage = usages.find((u) => u.functionName === "join");
      const basenameUsage = usages.find((u) => u.functionName === "basename");

      expect(resolveUsage?.isImported).toBe(true);
      expect(joinUsage?.isImported).toBe(true);
      expect(basenameUsage?.isImported).toBe(false);
    });

    test("ignores member method calls like Promise.resolve() and router.resolve()", () => {
      const source = [
        "async function asyncTask() {",
        "  const p = await Promise.resolve(42);",
        "  const r = router.resolve('/home');",
        "  const direct = resolve('dir', 'file');",
        "  return { p, r, direct };",
        "}",
      ].join("\n");

      const usages = detectPathFunctionUsages(source);
      expect(usages).toHaveLength(1);
      expect(usages[0]?.functionName).toBe("resolve");
      expect(usages[0]?.line).toBe(4);
    });

    test("ignores declarations like function resolve() or const resolve =", () => {
      const source = [
        "function resolve(param: string) { return param; }",
        "const join = (a: string, b: string) => a + b;",
        "const realCall = basename('foo/bar');",
      ].join("\n");

      const usages = detectPathFunctionUsages(source);
      expect(usages).toHaveLength(1);
      expect(usages[0]?.functionName).toBe("basename");
    });
  });

  describe("5. Missing Path Imports Identification & Audit (identifyMissingPathImports / auditSourceCodePathImports)", () => {
    test("detects MISSING_NODE_PATH_IMPORT on slice_28 code pattern", () => {
      const defectiveCode = createSampleDefectiveSlice28();
      const findings = identifyMissingPathImports(defectiveCode, { filePath: TARGET_AUDITING_SLICE });

      expect(findings).toHaveLength(1);
      const finding = findings[0]!;
      expect(finding.violationType).toBe("MISSING_NODE_PATH_IMPORT");
      expect(finding.severity).toBe("ERROR");
      expect(finding.missingFunctions).toContain("resolve");
      expect(finding.missingFunctions).toContain("join");
      expect(finding.missingFunctions).toContain("basename");
      expect(finding.hasNodePathImport).toBe(false);
      expect(finding.message).toContain("calls path function(s)");
    });

    test("detects INCOMPLETE_NODE_PATH_NAMED_IMPORTS when only partial imports exist", () => {
      const partialCode = [
        'import { resolve } from "node:path";',
        "export function run(dir: string) {",
        '  const p = resolve(dir, "sub");',
        '  const j = join(p, "index.ts");',
        "  const b = basename(j);",
        "  return { p, j, b };",
        "}",
      ].join("\n");

      const findings = identifyMissingPathImports(partialCode, { filePath: "slice_partial.ts" });
      expect(findings).toHaveLength(1);
      const finding = findings[0]!;
      expect(finding.violationType).toBe("INCOMPLETE_NODE_PATH_NAMED_IMPORTS");
      expect(finding.missingFunctions).toEqual(["basename", "join"]);
      expect(finding.importedFunctions).toEqual(["resolve"]);
    });

    test("detects LEGACY_PATH_MODULE_SPECIFIER when legacy 'path' is used", () => {
      const legacyCode = [
        'import { resolve, join, basename } from "path";',
        "export function run(dir: string) {",
        '  return resolve(join(dir, basename("file.ts")));',
        "}",
      ].join("\n");

      const findings = identifyMissingPathImports(legacyCode, { filePath: "slice_legacy.ts" });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.violationType).toBe("LEGACY_PATH_MODULE_SPECIFIER");
      expect(findings[0]?.severity).toBe("WARN");
      expect(findings[0]?.hasLegacyPathImport).toBe(true);
    });

    test("passes cleanly on fully compliant slice code", () => {
      const cleanCode = createSampleFixedSlice28();
      const report = auditSourceCodePathImports(cleanCode, TARGET_AUDITING_SLICE);

      expect(report.passed).toBe(true);
      expect(report.totalViolations).toBe(0);
      expect(report.findings).toHaveLength(0);
      expect(report.cleanFiles).toContain(TARGET_AUDITING_SLICE);
      expect(report.violatingFiles).toHaveLength(0);
    });
  });

  describe("6. Source Code Remediation (remediateSourceCodePathImports)", () => {
    test("injects new canonical 'node:path' import when no path import exists", () => {
      const defectiveCode = createSampleDefectiveSlice28();
      const remediated = remediateSourceCodePathImports(defectiveCode);

      expect(remediated).toContain('import { basename, join, resolve } from "node:path";');
      const audit = auditSourceCodePathImports(remediated, TARGET_AUDITING_SLICE);
      expect(audit.passed).toBe(true);
      expect(audit.totalViolations).toBe(0);
    });

    test("updates existing incomplete 'node:path' import with missing named members", () => {
      const partialCode = [
        'import { existsSync } from "node:fs";',
        'import { resolve } from "node:path";',
        "",
        "export function run(dir: string) {",
        '  const p = resolve(dir, "sub");',
        '  const j = join(p, "index.ts");',
        "  const b = basename(j);",
        "  const d = dirname(p);",
        "  return { p, j, b, d };",
        "}",
      ].join("\n");

      const remediated = remediateSourceCodePathImports(partialCode);
      expect(remediated).toContain('import { basename, dirname, join, resolve } from "node:path";');
      expect(remediated.match(/from "node:path"/g)?.length).toBe(1);

      const audit = auditSourceCodePathImports(remediated);
      expect(audit.passed).toBe(true);
    });

    test("modernizes legacy 'path' import to 'node:path' and ensures all members are imported", () => {
      const legacyCode = [
        'import { resolve } from "path";',
        "",
        "export function run(dir: string) {",
        '  const j = join(dir, "file.txt");',
        "  const b = basename(j);",
        "  return { j, b };",
        "}",
      ].join("\n");

      const remediated = remediateSourceCodePathImports(legacyCode);
      expect(remediated).toContain('import { basename, join, resolve } from "node:path";');
      expect(remediated).not.toContain('from "path"');

      const audit = auditSourceCodePathImports(remediated);
      expect(audit.passed).toBe(true);
    });

    test("is idempotent on already compliant source code", () => {
      const cleanCode = createSampleFixedSlice28();
      const remediated = remediateSourceCodePathImports(cleanCode);
      expect(remediated).toBe(cleanCode);
    });

    test("preserves top comments and docstrings when injecting new import", () => {
      const sourceWithComments = [
        "/**",
        " * Header docstring",
        " */",
        "// Line comment",
        "export function execute(dir: string) {",
        "  return basename(resolve(dir));",
        "}",
      ].join("\n");

      const remediated = remediateSourceCodePathImports(sourceWithComments);
      expect(remediated.startsWith("/**\n * Header docstring")).toBe(true);
      expect(remediated).toContain('import { basename, resolve } from "node:path";');
      expect(remediated).toContain("export function execute(dir: string)");
    });
  });

  describe("7. Filesystem Slice Auditing and Remediation (auditSliceFile / remediateSliceFile)", () => {
    test("audits and remediates a single slice file on disk", () => {
      const tempDir = createTempDir("single-slice-");
      const slicePath = join(tempDir, "slice_28.ts");
      writeFileSync(slicePath, createSampleDefectiveSlice28(), "utf-8");

      // Audit before remediation: must fail
      const auditBefore = auditSliceFile(slicePath);
      expect(auditBefore.passed).toBe(false);
      expect(auditBefore.totalViolations).toBe(1);
      expect(auditBefore.findings[0]?.missingFunctions).toContain("resolve");

      // Remediate file
      const remResult = remediateSliceFile(slicePath);
      expect(remResult.success).toBe(true);
      expect(remResult.remediatedFiles).toContain(slicePath);
      expect(remResult.dryRun).toBe(false);

      // Audit after remediation: must pass
      const auditAfter = auditSliceFile(slicePath);
      expect(auditAfter.passed).toBe(true);
      expect(auditAfter.totalViolations).toBe(0);

      // Verify on disk content
      const diskContent = readFileSync(slicePath, "utf-8");
      expect(diskContent).toContain('import { basename, join, resolve } from "node:path";');
    });

    test("dryRun mode computes remediation diff without modifying disk file", () => {
      const tempDir = createTempDir("dryrun-slice-");
      const slicePath = join(tempDir, "slice_dryrun.ts");
      const original = createSampleDefectiveSlice28();
      writeFileSync(slicePath, original, "utf-8");

      const remResult = remediateSliceFile(slicePath, { dryRun: true });
      expect(remResult.success).toBe(true);
      expect(remResult.dryRun).toBe(true);
      expect(remResult.remediatedFiles).toContain(slicePath);
      expect(remResult.modifiedContents[slicePath]).toContain('from "node:path"');

      // Disk file should remain untouched
      expect(readFileSync(slicePath, "utf-8")).toBe(original);
    });

    test("remediateSliceFile returns skipped when file is already clean", () => {
      const tempDir = createTempDir("clean-slice-");
      const slicePath = join(tempDir, "slice_clean.ts");
      writeFileSync(slicePath, createSampleFixedSlice28(), "utf-8");

      const remResult = remediateSliceFile(slicePath);
      expect(remResult.success).toBe(true);
      expect(remResult.remediatedFiles).toHaveLength(0);
      expect(remResult.skippedFiles).toContain(slicePath);
    });
  });

  describe("8. Directory-Wide Slice Auditing and Remediation", () => {
    test("audits directory of slices and remediates all defective slice files", () => {
      const tempDir = createTempDir("slices-group-");
      const group0 = join(tempDir, "group0");
      mkdirSync(group0, { recursive: true });

      // Create slice_27 (clean), slice_28 (defective), slice_29 (defective)
      const slice27 = join(group0, "slice_27.ts");
      const slice28 = join(group0, "slice_28.ts");
      const slice29 = join(group0, "slice_29.ts");

      writeFileSync(slice27, createSampleFixedSlice28(), "utf-8");
      writeFileSync(slice28, createSampleDefectiveSlice28(), "utf-8");
      writeFileSync(
        slice29,
        'export function test(d: string) { const x = dirname(d); const r = relative(".", d); return { x, r }; }',
        "utf-8",
      );

      // Audit directory before
      const dirAuditBefore: PathImportAuditReport = auditSliceDirectory(group0);
      expect(dirAuditBefore.passed).toBe(false);
      expect(dirAuditBefore.scannedFilesCount).toBe(3);
      expect(dirAuditBefore.violatingFiles).toHaveLength(2);
      expect(dirAuditBefore.cleanFiles).toHaveLength(1);

      // Remediate directory
      const dirRemResult: PathImportRemediationResult = remediateSliceDirectory(group0);
      expect(dirRemResult.success).toBe(true);
      expect(dirRemResult.remediatedFiles).toHaveLength(2);

      // Audit directory after
      const dirAuditAfter = auditSliceDirectory(group0);
      expect(dirAuditAfter.passed).toBe(true);
      expect(dirAuditAfter.totalViolations).toBe(0);
      expect(dirAuditAfter.cleanFiles).toHaveLength(3);
    });

    test("auditAuditingSlices audits repo slices without crashing", () => {
      const report = auditAuditingSlices();
      expect(report.defectRef).toBe(DEFECT_REF);
      expect(typeof report.passed).toBe("boolean");
      expect(report.scannedFilesCount).toBeGreaterThanOrEqual(0);
    });

    test("remediateAuditingSlices succeeds cleanly", () => {
      const result = remediateAuditingSlices({ dryRun: true });
      expect(result.defectRef).toBe(DEFECT_REF);
      expect(result.success).toBe(true);
    });
  });

  describe("9. Invariant Assertions & Error Handling (assertSlicePathImportsPurity / MissingNodePathImportError)", () => {
    test("assertSlicePathImportsPurity succeeds without throwing on compliant slice", () => {
      const clean = createSampleFixedSlice28();
      expect(() => assertSlicePathImportsPurity(clean)).not.toThrow();
    });

    test("assertSlicePathImportsPurity throws MissingNodePathImportError on defective slice", () => {
      const defective = createSampleDefectiveSlice28();

      expect(() => assertSlicePathImportsPurity(defective)).toThrow(MissingNodePathImportError);
      try {
        assertSlicePathImportsPurity(defective);
      } catch (err) {
        expect(err instanceof MissingNodePathImportError).toBe(true);
        const importErr = err as MissingNodePathImportError;
        expect(importErr.code).toBe(ERROR_CODE);
        expect(importErr.defectRef).toBe(DEFECT_REF);
        expect(importErr.missingFunctions).toContain("resolve");
        expect(importErr.missingFunctions).toContain("join");
        expect(importErr.missingFunctions).toContain("basename");
        expect(importErr.violationType).toBe("MISSING_NODE_PATH_IMPORT");
      }
    });

    test("MissingNodePathImportError instantiates with custom parameters", () => {
      const err = new MissingNodePathImportError("Custom missing import error", {
        code: "CUSTOM_ERR",
        defectRef: "custom-ref",
        filePath: "/path/to/slice_28.ts",
        missingFunctions: ["resolve", "join"],
        violationType: "UNDECLARED_PATH_FUNCTION_CALL",
      });

      expect(err.name).toBe("MissingNodePathImportError");
      expect(err.message).toBe("Custom missing import error");
      expect(err.code).toBe("CUSTOM_ERR");
      expect(err.defectRef).toBe("custom-ref");
      expect(err.filePath).toBe("/path/to/slice_28.ts");
      expect(err.missingFunctions).toEqual(["resolve", "join"]);
      expect(err.violationType).toBe("UNDECLARED_PATH_FUNCTION_CALL");
    });
  });

  describe("10. Slice 28 Helpers, Defect Proof & Text Formatting", () => {
    test("auditSlice28 and remediateSlice28 audit and transform slice_28 content", () => {
      const defective = createSampleDefectiveSlice28();
      const auditRes = auditSlice28(defective);
      expect(auditRes.passed).toBe(false);
      expect(auditRes.totalViolations).toBe(1);

      const fixed = remediateSlice28(defective);
      expect(fixed).toContain('import { basename, join, resolve } from "node:path";');

      const auditFixed = auditSlice28(fixed);
      expect(auditFixed.passed).toBe(true);
    });

    test("createDefectProof produces valid DefectResolutionProof contract", () => {
      const proof = createDefectProof({ taskId: "Task 1.15", verified: true });
      expect(proof.task_id).toBe("Task 1.15");
      expect(proof.verified).toBe(true);
      expect(proof.empirical_command).toBe(
        "bun test tests/unit/mind/defect-auditing-slices-missing-node-path-imports.test.ts",
      );
      expect(proof.test_assertion).toContain("Slice path import audit engine verifies 0 missing");
      expect(proof.explanation).toContain("slice_28.ts");
    });

    test("formatPathImportAuditReport formats human-readable report", () => {
      const defective = createSampleDefectiveSlice28();
      const report = auditSourceCodePathImports(defective, "group0/slice_28.ts");
      const formatted = formatPathImportAuditReport(report);

      expect(formatted).toContain("Slice Path Import Audit (defect-auditing-slices-missing-node-path-imports)");
      expect(formatted).toContain("Status: FAILED (Missing Imports Detected)");
      expect(formatted).toContain("Total Violations: 1");
      expect(formatted).toContain("group0/slice_28.ts");
      expect(formatted).toContain("Missing: basename, join, resolve");
    });
  });

  describe("11. Zero TypeScript any & Zero Compiler Suppressions Validation", () => {
    test("verifies zero TypeScript any and zero compiler suppressions across write scope and test files", () => {
      const filesToAudit = [
        join(
          process.cwd(),
          "olt/scripts/src/mind/defect-auditing-slices-missing-node-path-imports.ts",
        ),
        join(
          process.cwd(),
          "tests/unit/mind/defect-auditing-slices-missing-node-path-imports.test.ts",
        ),
      ];

      const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
      const suppressionPattern = new RegExp(
        ["@ts" + "-ignore", "@ts" + "-expect-error", "@ts" + "-nocheck"].join("|"),
      );

      for (const filePath of filesToAudit) {
        expect(existsSync(filePath)).toBe(true);
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;
          expect(anyPattern.test(line)).toBe(false);
          expect(suppressionPattern.test(line)).toBe(false);
        }
      }
    });
  });
});
