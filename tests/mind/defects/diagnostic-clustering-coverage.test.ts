/**
 * @file diagnostic-clustering-coverage.test.ts
 * Comprehensive unit tests for diagnostic parsing, classification, clustering, and matrix synthesis.
 */

import { describe, expect, it } from "bun:test";
import {
  DEFICIT_CRITICALITY_CLASSES,
  DIAGNOSTIC_ERROR_KINDS,
  clusterDiagnosticErrors,
  computeStackSignature,
  extractStackFrames,
  formatDeficitTopologyMatrixMarkdown,
  inferSubsystemFromPath,
  parseRawDiagnostics,
  type ParsedDiagnosticError,
} from "../../../olt/scripts/src/mind/defects/diagnostic-clustering.ts";

describe("Diagnostic Clustering & Parsing Coverage Suite", () => {
  describe("inferSubsystemFromPath & Stack Utilities", () => {
    it("handles various path structures, src relative segments, and fallback heuristics", () => {
      expect(inferSubsystemFromPath("src/nested/layer/deep.ts")).toBe("nested/layer");
      expect(inferSubsystemFromPath("src/single.ts")).toBe("system/core");
      expect(inferSubsystemFromPath("topdir/subdir/file.ts")).toBe("topdir/subdir");
      expect(inferSubsystemFromPath("topdir/file.ts")).toBe("topdir");
      expect(inferSubsystemFromPath(undefined, "crucible test failure")).toBe("mind/crucible");
      expect(inferSubsystemFromPath("", "")).toBe("system/core");
      expect(inferSubsystemFromPath(undefined, "unrelated text")).toBe("system/core");
    });

    it("extracts stack frames and generates message-based signatures when empty", () => {
      expect(extractStackFrames("" as string)).toEqual([]);
      expect(extractStackFrames("No stack here")).toEqual([]);
      const raw = "Error: boom\n  at- fn (/path/to/foo.ts:1:2)\n  at bar (baz.ts:3:4)";
      const frames = extractStackFrames(raw);
      expect(frames.length).toBe(2);
      expect(computeStackSignature([], "Test message")).toContain("SIG-MSG-");
      expect(computeStackSignature(frames, "")).toContain("SIG-STK-");
    });
  });

  describe("Structured Diagnostics & Kind/Criticality Classifiers", () => {
    it("classifies error kinds and criticalities across structured input variations", () => {
      const inputs = [
        { code: "TS2304", rawError: "typescript error in symbol resolution" },
        { message: "Syntax error near token", code: "SYNTAXERROR" },
        { message: "system deadlock or boot hang detected" },
        { message: "cannot find module './missing' err_module_not_found" },
        { message: "expect(received).toBe(expected) test failed in file", filePath: "foo.test.ts" },
        { message: "invariant violation in contract regression" },
        { message: "eslint rule violation: prettier formatting" },
        { message: "coverage threshold failed: uncovered lines found" },
        { message: "performance slowdown latency spike timed out" },
        { message: "fatal crash cannot compile", kind: undefined },
        { message: "unknown fail regression broke", kind: undefined },
        { message: "minor notice", kind: undefined },
      ];

      const parsed = parseRawDiagnostics({
        fileEntries: inputs.slice(0, 6),
        structuredErrors: inputs.slice(6),
        sourceProbe: "custom_probe",
      });

      expect(parsed).toHaveLength(12);
      expect(parsed[0]?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.TYPECHECK_COMPILATION);
      expect(parsed[1]?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.SYNTAX_ERROR);
      expect(parsed[2]?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.BOOT_DEADLOCK);
      expect(parsed[3]?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.MODULE_RESOLUTION);
      expect(parsed[4]?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.TEST_ASSERTION_FAILURE);
      expect(parsed[5]?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.INVARIANT_VIOLATION);
      expect(parsed[6]?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.LINT_WARNING);
      expect(parsed[7]?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.MISSING_COVERAGE);
      expect(parsed[8]?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.PERFORMANCE_SLOWDOWN);
      expect(parsed[9]?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER);
      expect(parsed[10]?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION);
      expect(parsed[11]?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT);
    });
  });

  describe("Multi-Dialect Log Parsing", () => {
    it("parses TS warnings, linter variations, test failures, and exceptions", () => {
      const log = [
        "src/test.ts(1,2): warning TS6133: 'x' is declared but never used.",
        "  const x = 1;",
        "src/other.ts:5:10 - warning TS7006: Parameter 'a' implicitly has an 'any' type.",
        "src/lint.ts:1:1: unexpected var [error/no-var]",
        "src/lint2.ts:2:2: missing semicolon [warning]",
        "✖ Test failed: math invariants",
        "  Assertion failed: 1 !== 2",
        "    at /path/test.ts:10:5",
        "SyntaxError: Unexpected token <",
        "    at parse (/path/parser.ts:20:1)",
        "ContractRegression: Method signature altered",
        "Module not found: Can't resolve 'lib'",
      ].join("\n");

      const parsed = parseRawDiagnostics(log, "dialect_probe");
      expect(parsed.length).toBeGreaterThanOrEqual(7);

      const tsWarn = parsed.find((e) => e.errorCode === "TS6133");
      expect(tsWarn?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.TYPE_CHECK_WARNING);
      expect(tsWarn?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT);

      const lintErr = parsed.find((e) => e.errorCode === "no-var");
      expect(lintErr?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.LINT_ERROR);

      const synErr = parsed.find((e) => e.errorCode === "SyntaxError");
      expect(synErr?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.SYNTAX_ERROR);
      expect(synErr?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER);

      const regErr = parsed.find((e) => e.errorCode === "ContractRegression");
      expect(regErr?.kind).toBe(DIAGNOSTIC_ERROR_KINDS.INVARIANT_VIOLATION);
      expect(regErr?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION);
    });
  });

  describe("Clustering Synthesizers & Edge Cases", () => {
    it("returns pristine matrix when empty diagnostic array is passed", () => {
      const matrix = clusterDiagnosticErrors([]);
      expect(matrix.totalRawErrors).toBe(0);
      expect(matrix.totalClusters).toBe(0);
      expect(matrix.summary.healthStatus).toBe("HEALTHY");
      expect(matrix.recommendedRoadmapAllocation.coreStability).toBe(70);
    });

    it("synthesizes titles, hypotheses, and remediations for various defect kinds", () => {
      const now = new Date().toISOString();
      const rawErrors: ParsedDiagnosticError[] = [
        {
          id: "E1",
          kind: DIAGNOSTIC_ERROR_KINDS.TYPECHECK_COMPILATION,
          classification: DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER,
          errorCode: "TS2322",
          message: "Type 'string' is not assignable to type 'number'",
          normalizedMessage: "type <type> is not assignable to type <type>",
          filePath: "src/file1.ts",
          subsystem: "mind/core",
          timestamp: now,
        },
        {
          id: "E2",
          kind: DIAGNOSTIC_ERROR_KINDS.TYPECHECK_COMPILATION,
          classification: DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER,
          errorCode: "TS2304",
          message: "Cannot find name 'MissingType'",
          normalizedMessage: "cannot find name <name>",
          filePath: "src/file1.ts",
          subsystem: "mind/core",
          timestamp: now,
        },
        {
          id: "E3",
          kind: DIAGNOSTIC_ERROR_KINDS.BOOT_DEADLOCK,
          classification: DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER,
          message: "Deadlock in initialization lock",
          normalizedMessage: "deadlock in initialization lock",
          filePath: "src/boot.ts",
          subsystem: "system/core",
          timestamp: now,
        },
        {
          id: "E4",
          kind: DIAGNOSTIC_ERROR_KINDS.UNKNOWN,
          classification: DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT,
          message: "Minor deficit notice",
          normalizedMessage: "minor deficit notice",
          filePath: "src/file1.ts",
          subsystem: "mind/core",
          timestamp: now,
        },
      ];

      const matrix = clusterDiagnosticErrors(rawErrors);
      expect(matrix.clusters.length).toBeGreaterThanOrEqual(3);

      const tsCluster = matrix.clusters.find((c) => c.errorCodes.includes("TS2304"));
      expect(tsCluster?.rootCauseTitle).toContain("Missing identifier 'MissingType'");
      expect(tsCluster?.rootCauseHypothesis).toContain("AST definition");
      expect(tsCluster?.suggestedRemediationAction).toContain("Update type declarations");

      const deadlockCluster = matrix.clusters.find(
        (c) =>
          c.classification === DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER &&
          c.affectedFiles.includes("src/boot.ts"),
      );
      expect(deadlockCluster?.rootCauseHypothesis).toContain("Cyclic initialization");
    });

    it("identifies cascading downstream clusters and applies custom allocation overrides", () => {
      const now = new Date().toISOString();
      const blocker: ParsedDiagnosticError = {
        id: "BLK-1",
        kind: DIAGNOSTIC_ERROR_KINDS.TYPECHECK_COMPILATION,
        classification: DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER,
        errorCode: "TS2304",
        message: "Cannot find name 'Foo'",
        normalizedMessage: "cannot find name foo",
        filePath: "src/shared.ts",
        subsystem: "mind/core",
        timestamp: now,
      };

      const regression: ParsedDiagnosticError = {
        id: "REG-1",
        kind: DIAGNOSTIC_ERROR_KINDS.TEST_ASSERTION_FAILURE,
        classification: DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION,
        errorCode: "AssertionError",
        message: "Assertion failed on shared module",
        normalizedMessage: "assertion failed on shared module",
        filePath: "src/shared.ts",
        subsystem: "mind/core",
        timestamp: now,
      };

      const matrix = clusterDiagnosticErrors([blocker, regression], {
        baseRoadmapAllocation: {
          coreStability: 60,
          architecturalEvolution: 30,
          exploratory: 10,
        },
      });

      expect(matrix.clusters[0]?.cascadingDownstreamClusters).toBeDefined();
      expect(matrix.recommendedRoadmapAllocation.coreStability).toBe(60);
      expect(matrix.recommendedRoadmapAllocation.architecturalEvolution).toBe(30);
      expect(matrix.recommendedRoadmapAllocation.exploratory).toBe(10);

      const cascadedMd = formatDeficitTopologyMatrixMarkdown(matrix);
      expect(cascadedMd).toContain("Cascading Downstream Clusters");
    });

    it("formats markdown reports across clean, warning, and caution health statuses", () => {
      const cleanMatrix = clusterDiagnosticErrors([]);
      const cleanMd = formatDeficitTopologyMatrixMarkdown(cleanMatrix);
      expect(cleanMd).toContain("🟢 HEALTHY");
      expect(cleanMd).toContain("PRISTINE BASELINE");
      expect(cleanMd).toContain("No active deficit clusters recorded");

      const errors: ParsedDiagnosticError[] = [
        {
          id: "REG-MD",
          kind: DIAGNOSTIC_ERROR_KINDS.INVARIANT_VIOLATION,
          classification: DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION,
          message: "Invariant violated in state machine",
          normalizedMessage: "invariant violated in state machine",
          filePath: "src/state.ts",
          subsystem: "mind/governance",
          rawSnippet: "InvariantViolation: state invalid",
          timestamp: new Date().toISOString(),
        },
        {
          id: "MOD-MD",
          kind: DIAGNOSTIC_ERROR_KINDS.MODULE_RESOLUTION,
          classification: DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER,
          message: "Cannot find module ./missing",
          normalizedMessage: "cannot find module ./missing",
          timestamp: new Date().toISOString(),
        },
        {
          id: "CRASH-MD",
          kind: DIAGNOSTIC_ERROR_KINDS.RUNTIME_CRASH,
          classification: DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER,
          message: "Uncaught panic in worker",
          normalizedMessage: "uncaught panic in worker",
          filePath: "src/worker.ts",
          timestamp: new Date().toISOString(),
        },
        {
          id: "LINT-MD",
          kind: DIAGNOSTIC_ERROR_KINDS.LINT_ERROR,
          classification: DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT,
          errorCode: "semi",
          message: "Missing semicolon",
          normalizedMessage: "missing semicolon",
          filePath: "src/worker.ts",
          timestamp: new Date().toISOString(),
        },
      ];
      const multiMatrix = clusterDiagnosticErrors(errors);
      const multiMd = formatDeficitTopologyMatrixMarkdown(multiMatrix);
      expect(multiMd).toContain("CLASS 1 BLOCKER CLUSTER");
      expect(multiMd).toContain("Cluster Diagnostic Deep-Dives");
    });
  });
});
