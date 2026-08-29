import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateDefectEntries,
  assertValidDefectsAggregatorImports,
  auditDefectsModuleGraph,
  calculateDefectAggregateMetrics,
  CANONICAL_AGGREGATOR_BARREL_PATH,
  CANONICAL_AGGREGATOR_BARREL_SPECIFIER,
  CANONICAL_AGGREGATOR_BARREL_SPECIFIER_FROM_MIND,
  CANONICAL_AGGREGATOR_BARREL_SPECIFIER_FROM_TEST,
  CANONICAL_AGGREGATOR_MODULE_PATH,
  CANONICAL_AGGREGATOR_SYMBOLS,
  CANONICAL_DEFECTS_BARREL_PATH,
  CANONICAL_METRICS_MODULE_PATH,
  classifyAggregatorImport,
  clusterDefectsBySimilarity,
  createDefectsAggregatorDefectEntry,
  createDefectsAggregatorDefectProof,
  DEFECT_REF,
  DefectsAggregatorImportError,
  DefectsImportResolutionError,
  ERROR_CODE,
  extractImportEntries,
  extractModuleImports,
  formatDefectsAggregatorAuditBrief,
  INVARIANT_DESCRIPTION,
  INVARIANT_NUMBER,
  INVARIANT_REF,
  isCanonicalAggregatorImport,
  isLegacyAggregatorImport,
  LEGACY_AGGREGATOR_PATTERNS,
  LEGACY_AGGREGATOR_SPECIFIER,
  mergeDefectSets,
  normalizeStatus,
  pickHigherSeverity,
  remediateDefectsAggregatorImports,
  remediateDefectsAggregatorImportsWithReport,
  resolveAggregatorImportPath,
  toAggregatedDefect,
  UNRESOLVED_MODULE_IMPORT_IN_DEFECTS,
  UnresolvedAggregatorImportError,
  validateDefectsAggregatorImports,
  verifyLiveDefectsBarrelIntegrity,
  withinDeduplicationWindow,
  type AggregatedDefect,
  type DefectMetricsResult,
  type DefectRecordInput,
  type DefectsAggregatorModuleAuditReport,
  type DefectsAggregatorValidationResult,
} from "../../../olt/scripts/src/mind/defect-mind-defects-unresolved-aggregator-import.ts";

describe("Task 1.12: Defect Remediation - Unresolved import './aggregator.ts' in mind/defects/index.ts", () => {
  describe("1. Defect Metadata, Constants & Canonical Path Contracts", () => {
    it("defect identifiers and error codes match architectural specifications", () => {
      expect(DEFECT_REF).toBe("defect-mind-defects-unresolved-aggregator-import");
      expect(ERROR_CODE).toBe("UNRESOLVED_MODULE_IMPORT_IN_DEFECTS");
      expect(UNRESOLVED_MODULE_IMPORT_IN_DEFECTS).toBe("UNRESOLVED_MODULE_IMPORT_IN_DEFECTS");
      expect(INVARIANT_NUMBER).toBe(12);
      expect(INVARIANT_REF).toBe("Invariant 1.12");
      expect(INVARIANT_DESCRIPTION.includes("mind/defects/index.ts")).toBe(true);
      expect(INVARIANT_DESCRIPTION.includes("./aggregator.ts")).toBe(true);
    });

    it("canonical paths and specifiers are accurately declared", () => {
      expect(CANONICAL_DEFECTS_BARREL_PATH).toBe("olt/scripts/src/mind/defects/index.ts");
      expect(CANONICAL_AGGREGATOR_BARREL_PATH).toBe(
        "olt/scripts/src/mind/defects/aggregator/index.ts",
      );
      expect(CANONICAL_AGGREGATOR_MODULE_PATH).toBe(
        "olt/scripts/src/mind/defects/aggregator/aggregator.ts",
      );
      expect(CANONICAL_METRICS_MODULE_PATH).toBe(
        "olt/scripts/src/mind/defects/aggregator/metrics.ts",
      );
      expect(CANONICAL_AGGREGATOR_BARREL_SPECIFIER).toBe("./aggregator/index.ts");
      expect(CANONICAL_AGGREGATOR_BARREL_SPECIFIER_FROM_MIND).toBe("./defects/aggregator/index.ts");
      expect(CANONICAL_AGGREGATOR_BARREL_SPECIFIER_FROM_TEST).toBe(
        "../../../olt/scripts/src/mind/defects/aggregator/index.ts",
      );
      expect(LEGACY_AGGREGATOR_SPECIFIER).toBe("./aggregator.ts");
    });

    it("freezes legacy patterns and aggregator symbols catalogs", () => {
      expect(Object.isFrozen(LEGACY_AGGREGATOR_PATTERNS)).toBe(true);
      expect(LEGACY_AGGREGATOR_PATTERNS.includes("./aggregator.ts")).toBe(true);
      expect(LEGACY_AGGREGATOR_PATTERNS.includes("./slices/aggregator.ts")).toBe(true);
      expect(LEGACY_AGGREGATOR_PATTERNS.includes("../aggregator.ts")).toBe(true);
      expect(LEGACY_AGGREGATOR_PATTERNS.includes("mind/defects/aggregator.ts")).toBe(true);

      expect(Object.isFrozen(CANONICAL_AGGREGATOR_SYMBOLS)).toBe(true);
      expect(CANONICAL_AGGREGATOR_SYMBOLS.includes("pickHigherSeverity")).toBe(true);
      expect(CANONICAL_AGGREGATOR_SYMBOLS.includes("normalizeStatus")).toBe(true);
      expect(CANONICAL_AGGREGATOR_SYMBOLS.includes("withinDeduplicationWindow")).toBe(true);
      expect(CANONICAL_AGGREGATOR_SYMBOLS.includes("toAggregatedDefect")).toBe(true);
      expect(CANONICAL_AGGREGATOR_SYMBOLS.includes("aggregateDefectEntries")).toBe(true);
      expect(CANONICAL_AGGREGATOR_SYMBOLS.includes("mergeDefectSets")).toBe(true);
      expect(CANONICAL_AGGREGATOR_SYMBOLS.includes("calculateDefectAggregateMetrics")).toBe(true);
      expect(CANONICAL_AGGREGATOR_SYMBOLS.includes("clusterDefectsBySimilarity")).toBe(true);
      expect(CANONICAL_AGGREGATOR_SYMBOLS.includes("DefectMetricsResult")).toBe(true);
    });
  });

  describe("2. Canonical Aggregator Facade Exports & Functionality", () => {
    it("re-exports all core aggregator functions and metric utilities", () => {
      expect(typeof pickHigherSeverity).toBe("function");
      expect(typeof normalizeStatus).toBe("function");
      expect(typeof withinDeduplicationWindow).toBe("function");
      expect(typeof toAggregatedDefect).toBe("function");
      expect(typeof aggregateDefectEntries).toBe("function");
      expect(typeof mergeDefectSets).toBe("function");
      expect(typeof calculateDefectAggregateMetrics).toBe("function");
      expect(typeof clusterDefectsBySimilarity).toBe("function");
    });

    it("evaluates pickHigherSeverity correctly", () => {
      expect(pickHigherSeverity("low", "critical")).toBe("critical");
      expect(pickHigherSeverity("high", "medium")).toBe("high");
      expect(pickHigherSeverity("warning", "info")).toBe("warning");
      expect(pickHigherSeverity("critical", "critical")).toBe("critical");
    });

    it("evaluates normalizeStatus correctly", () => {
      expect(normalizeStatus("OPEN")).toBe("open");
      expect(normalizeStatus("RESOLVED")).toBe("resolved");
      expect(normalizeStatus("completed")).toBe("resolved");
      expect(normalizeStatus("wont_fix")).toBe("wontfix");
      expect(normalizeStatus("wont-fix")).toBe("wontfix");
      expect(normalizeStatus("wontfix")).toBe("wontfix");
      expect(normalizeStatus(undefined)).toBe("open");
    });

    it("evaluates withinDeduplicationWindow correctly", () => {
      const t1 = "2026-08-29T10:00:00.000Z";
      const t2 = "2026-08-29T10:00:30.000Z";
      const t3 = "2026-08-29T10:05:00.000Z";

      expect(withinDeduplicationWindow(t1, t2, 60_000)).toBe(true);
      expect(withinDeduplicationWindow(t1, t3, 60_000)).toBe(false);
      expect(withinDeduplicationWindow(t1, t2, 0)).toBe(true);
    });

    it("executes toAggregatedDefect and aggregateDefectEntries lifecycle", () => {
      const input: DefectRecordInput = {
        id: "d-001",
        type: "import_error",
        severity: "medium",
        status: "open",
        observation: "Missing module",
        timestamp: "2026-08-29T10:00:00.000Z",
      };

      const aggregated: AggregatedDefect = toAggregatedDefect(input);
      expect(aggregated.id).toBe("d-001");
      expect(aggregated.severity).toBe("medium");
      expect(aggregated.status).toBe("open");
      expect(aggregated.count).toBe(1);

      const incoming: DefectRecordInput = {
        severity: "critical",
        status: "resolved",
        observation: "Missing module resolved",
        timestamp: "2026-08-29T10:10:00.000Z",
        resolution: {
          task_id: "Task 1.12",
          test_assertion: "100% pass",
          resolved_at: "2026-08-29T10:10:00.000Z",
        },
      };

      const updated = aggregateDefectEntries(aggregated, incoming);
      expect(updated.count).toBe(2);
      expect(updated.severity).toBe("critical");
      expect(updated.status).toBe("resolved");
      expect(updated.last_seen_at).toBe("2026-08-29T10:10:00.000Z");
      expect(updated.resolution?.task_id).toBe("Task 1.12");
    });

    it("executes mergeDefectSets correctly", () => {
      const setA = [toAggregatedDefect({ id: "d-1", type: "syntax_error", observation: "Err 1" })];
      const setB = [
        toAggregatedDefect({ id: "d-2", type: "type_error", observation: "Err 2" }),
        toAggregatedDefect({ id: "d-1", type: "syntax_error", observation: "Err 1", count: 2 }),
      ];

      const merged = mergeDefectSets(setA, setB);
      expect(merged.length).toBe(2);
      const d1 = merged.find((d) => d.id === "d-1");
      expect(d1?.count).toBe(3);
    });

    it("calculates aggregate metrics and clusters defects by similarity", () => {
      const d1 = toAggregatedDefect({
        category: "code_defect",
        severity: "high",
        status: "open",
        type: "unresolved_import",
        observation: "Unresolved import in module A",
      });
      const d2 = toAggregatedDefect({
        category: "code_defect",
        severity: "critical",
        status: "resolved",
        type: "unresolved_import",
        observation: "Unresolved import in module B",
        first_seen_at: "2026-08-29T10:00:00.000Z",
        resolution: {
          task_id: "Task 1.12",
          test_assertion: "passed",
          resolved_at: "2026-08-29T10:30:00.000Z",
        },
      });

      const metrics: DefectMetricsResult = calculateDefectAggregateMetrics([d1, d2]);
      expect(metrics.total_recorded).toBe(2);
      expect(metrics.open_count).toBe(1);
      expect(metrics.resolved_count).toBe(1);
      expect(metrics.by_severity.high).toBe(1);
      expect(metrics.by_severity.critical).toBe(1);
      expect(metrics.mean_time_to_resolution_ms).toBe(30 * 60 * 1000);

      const clusters = clusterDefectsBySimilarity([d1, d2], 0.3);
      expect(clusters.length).toBeGreaterThan(0);
    });
  });

  describe("3. Classification & Path Resolution", () => {
    it("isLegacyAggregatorImport accurately identifies legacy import paths", () => {
      expect(isLegacyAggregatorImport("./aggregator.ts")).toBe(true);
      expect(isLegacyAggregatorImport("./aggregator")).toBe(true);
      expect(isLegacyAggregatorImport("./slices/aggregator.ts")).toBe(true);
      expect(isLegacyAggregatorImport("./slices/aggregator")).toBe(true);
      expect(isLegacyAggregatorImport("../aggregator.ts")).toBe(true);
      expect(isLegacyAggregatorImport("../../mind/defects/aggregator.ts")).toBe(true);
      expect(isLegacyAggregatorImport("mind/defects/aggregator.ts")).toBe(true);
      expect(isLegacyAggregatorImport("./defects/aggregator.ts")).toBe(true);

      expect(isLegacyAggregatorImport("./aggregator/index.ts")).toBe(false);
      expect(isLegacyAggregatorImport("./defects/aggregator/index.ts")).toBe(false);
      expect(isLegacyAggregatorImport("./aggregator/aggregator.ts")).toBe(false);
      expect(isLegacyAggregatorImport("node:fs")).toBe(false);
    });

    it("isCanonicalAggregatorImport accurately identifies canonical import paths", () => {
      expect(isCanonicalAggregatorImport("./aggregator/index.ts")).toBe(true);
      expect(isCanonicalAggregatorImport("./defects/aggregator/index.ts")).toBe(true);
      expect(
        isCanonicalAggregatorImport("../../../olt/scripts/src/mind/defects/aggregator/index.ts"),
      ).toBe(true);
      expect(isCanonicalAggregatorImport("./aggregator/aggregator.ts")).toBe(true);
      expect(isCanonicalAggregatorImport("./aggregator/metrics.ts")).toBe(true);
      expect(isCanonicalAggregatorImport("./aggregator.ts")).toBe(false);
    });

    it("classifyAggregatorImport classifies specifiers and provides canonical replacement", () => {
      const legacyClass = classifyAggregatorImport("./aggregator.ts");
      expect(legacyClass.isLegacy).toBe(true);
      expect(legacyClass.isCanonical).toBe(false);
      expect(legacyClass.resolvedSpecifier).toBe("./aggregator/index.ts");

      const barrelClass = classifyAggregatorImport("./aggregator/index.ts");
      expect(barrelClass.isLegacy).toBe(false);
      expect(barrelClass.isCanonical).toBe(true);
      expect(barrelClass.isAggregatorBarrel).toBe(true);
      expect(barrelClass.resolvedSpecifier).toBe("./aggregator/index.ts");

      const metricsClass = classifyAggregatorImport("./aggregator/metrics.ts");
      expect(metricsClass.isLegacy).toBe(false);
      expect(metricsClass.isCanonical).toBe(true);
      expect(metricsClass.isMetricsDirect).toBe(true);
    });

    it("resolveAggregatorImportPath provides context-appropriate canonical paths", () => {
      expect(
        resolveAggregatorImportPath("./aggregator.ts", "olt/scripts/src/mind/defects/index.ts"),
      ).toBe("./aggregator/index.ts");
      expect(
        resolveAggregatorImportPath(
          "../../mind/defects/aggregator.ts",
          "tests/unit/mind/defects.test.ts",
        ),
      ).toBe("../../../olt/scripts/src/mind/defects/aggregator/index.ts");
      expect(
        resolveAggregatorImportPath("./defects/aggregator.ts", "olt/scripts/src/mind/index.ts"),
      ).toBe("./defects/aggregator/index.ts");
    });
  });

  describe("4. AST / Import Extraction & Validation", () => {
    it("extractModuleImports extracts all static and dynamic imports", () => {
      const code = `
        import { pickHigherSeverity } from "./aggregator.ts";
        import type { DefectEntry } from "./core/types.ts";
        export { toAggregatedDefect } from "./aggregator/index.ts";
        const dyn = await import("./dedup/index.ts");
      `;
      const imports = extractModuleImports(code);
      expect(imports.includes("./aggregator.ts")).toBe(true);
      expect(imports.includes("./core/types.ts")).toBe(true);
      expect(imports.includes("./aggregator/index.ts")).toBe(true);
      expect(imports.includes("./dedup/index.ts")).toBe(true);
    });

    it("extractImportEntries parses structured details including named symbols and line numbers", () => {
      const code = `
        import {
          pickHigherSeverity,
          toAggregatedDefect,
        } from "./aggregator/index.ts";
        import type { AggregatedDefect } from "./core/types.ts";
        import * as fs from "node:fs";
      `;
      const entries = extractImportEntries(code);
      expect(entries.length).toBe(3);

      expect(entries[0]?.specifier).toBe("./aggregator/index.ts");
      expect(entries[0]?.namedSymbols.includes("pickHigherSeverity")).toBe(true);
      expect(entries[0]?.namedSymbols.includes("toAggregatedDefect")).toBe(true);

      expect(entries[1]?.isTypeOnly).toBe(true);
      expect(entries[1]?.namedSymbols.includes("AggregatedDefect")).toBe(true);

      expect(entries[2]?.namespaceImport).toBe("fs");
    });

    it("validateDefectsAggregatorImports flags legacy aggregator imports with actionable issues", () => {
      const defectiveCode = `
        import { pickHigherSeverity } from "./aggregator.ts";
      `;
      const result: DefectsAggregatorValidationResult = validateDefectsAggregatorImports(
        defectiveCode,
        "mind/defects/index.ts",
      );
      expect(result.valid).toBe(false);
      expect(result.legacyImportDetected).toBe(true);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0]?.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_DEFECTS);
      expect(result.issues[0]?.specifier).toBe("./aggregator.ts");
      expect(result.issues[0]?.suggestedRemediation?.includes("./aggregator/index.ts")).toBe(true);
    });

    it("validateDefectsAggregatorImports passes on clean canonical imports", () => {
      const cleanCode = `
        export {
          pickHigherSeverity,
          toAggregatedDefect,
          aggregateDefectEntries,
          withinDeduplicationWindow,
          mergeDefectSets,
          calculateDefectAggregateMetrics,
          clusterDefectsBySimilarity,
        } from "./aggregator/index.ts";
      `;
      const result = validateDefectsAggregatorImports(cleanCode, "mind/defects/index.ts");
      expect(result.valid).toBe(true);
      expect(result.legacyImportDetected).toBe(false);
      expect(result.canonicalImportPresent).toBe(true);
      expect(result.issues.length).toBe(0);
      expect(result.issueCount).toBe(0);
    });
  });

  describe("5. Remediation Engine", () => {
    it("remediateDefectsAggregatorImports replaces single-quoted and double-quoted legacy imports", () => {
      const legacyCode = `
        export { pickHigherSeverity } from './aggregator.ts';
        export { toAggregatedDefect } from "./slices/aggregator.ts";
      `;
      const remediated = remediateDefectsAggregatorImports(legacyCode);
      expect(remediated.includes("./aggregator.ts")).toBe(false);
      expect(remediated.includes('"./slices/aggregator.ts"')).toBe(false);
      expect(remediated.includes("'./aggregator/index.ts'")).toBe(true);
      expect(remediated.includes('"./aggregator/index.ts"')).toBe(true);
    });

    it("remediateDefectsAggregatorImportsWithReport provides full report metadata", () => {
      const legacyCode = `
        export { pickHigherSeverity } from './aggregator.ts';
      `;
      const report = remediateDefectsAggregatorImportsWithReport(legacyCode);
      expect(report.defectRef).toBe(DEFECT_REF);
      expect(report.success).toBe(true);
      expect(report.replacementsCount).toBe(1);
      expect(report.remediatedSource.includes("./aggregator/index.ts")).toBe(true);
    });

    it("remediateDefectsAggregatorImports is idempotent on clean source", () => {
      const cleanCode = `
        export { pickHigherSeverity } from "./aggregator/index.ts";
      `;
      const remediated = remediateDefectsAggregatorImports(cleanCode);
      expect(remediated).toBe(cleanCode);
    });
  });

  describe("6. Assertion & Custom Error Hierarchy", () => {
    it("assertValidDefectsAggregatorImports throws DefectsAggregatorImportError on invalid code", () => {
      const invalidCode = `
        export { pickHigherSeverity } from "./aggregator.ts";
      `;
      expect(() => assertValidDefectsAggregatorImports(invalidCode, "defects/index.ts")).toThrow(
        DefectsAggregatorImportError,
      );
    });

    it("assertValidDefectsAggregatorImports does not throw on valid code", () => {
      const validCode = `
        export { pickHigherSeverity } from "./aggregator/index.ts";
      `;
      expect(() =>
        assertValidDefectsAggregatorImports(validCode, "defects/index.ts"),
      ).not.toThrow();
    });

    it("DefectsAggregatorImportError initializes with proper error fields", () => {
      const err = new DefectsAggregatorImportError("Legacy import found", {
        code: UNRESOLVED_MODULE_IMPORT_IN_DEFECTS,
        specifier: "./aggregator.ts",
        filePath: "mind/defects/index.ts",
        issues: [
          {
            code: UNRESOLVED_MODULE_IMPORT_IN_DEFECTS,
            message: "Unresolved import",
            specifier: "./aggregator.ts",
          },
        ],
      });
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(DefectsAggregatorImportError);
      expect(err.name).toBe("DefectsAggregatorImportError");
      expect(err.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_DEFECTS);
      expect(err.defectRef).toBe(DEFECT_REF);
      expect(err.specifier).toBe("./aggregator.ts");
      expect(err.filePath).toBe("mind/defects/index.ts");
      expect(err.issues.length).toBe(1);
    });

    it("aliases UnresolvedAggregatorImportError and DefectsImportResolutionError point to same class", () => {
      expect(UnresolvedAggregatorImportError).toBe(DefectsAggregatorImportError);
      expect(DefectsImportResolutionError).toBe(DefectsAggregatorImportError);
    });
  });

  describe("7. Live Repository Integrity & Audit", () => {
    it("verifyLiveDefectsBarrelIntegrity verifies that live mind/defects/index.ts is 100% clean", () => {
      const result = verifyLiveDefectsBarrelIntegrity();
      expect(result.valid).toBe(true);
      expect(result.legacyImportDetected).toBe(false);
      expect(result.canonicalImportPresent).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.issueCount).toBe(0);
    });

    it("auditDefectsModuleGraph scans all defect subsystem files and reports clean resolution", () => {
      const report: DefectsAggregatorModuleAuditReport = auditDefectsModuleGraph();
      expect(report.defectRef).toBe(DEFECT_REF);
      expect(report.errorCode).toBe(UNRESOLVED_MODULE_IMPORT_IN_DEFECTS);
      expect(report.resolved).toBe(true);
      expect(report.totalFilesScanned).toBeGreaterThan(0);
      expect(report.invalidFilesCount).toBe(0);
      expect(report.issues).toHaveLength(0);
      expect(report.checkedFiles.includes("olt/scripts/src/mind/defects/index.ts")).toBe(true);
    });

    it("confirms canonical file existence on disk", () => {
      const repoRoot = process.cwd();
      expect(existsSync(join(repoRoot, CANONICAL_DEFECTS_BARREL_PATH))).toBe(true);
      expect(existsSync(join(repoRoot, CANONICAL_AGGREGATOR_BARREL_PATH))).toBe(true);
      expect(existsSync(join(repoRoot, CANONICAL_AGGREGATOR_MODULE_PATH))).toBe(true);
      expect(existsSync(join(repoRoot, CANONICAL_METRICS_MODULE_PATH))).toBe(true);
    });
  });

  describe("8. Defect Tracking, Proof Generation & Brief Formatting", () => {
    it("createDefectsAggregatorDefectEntry creates compliant DefectEntry", () => {
      const entry = createDefectsAggregatorDefectEntry();
      expect(entry.id).toBe(DEFECT_REF);
      expect(entry.domain).toBe("mind");
      expect(entry.error_code).toBe(ERROR_CODE);
      expect(entry.status).toBe("resolved");
      expect(entry.category).toBe("code_defect");
      expect(entry.severity).toBe("high");
      expect(entry.remediation?.includes("./aggregator/index.ts")).toBe(true);
      expect(entry.timestamp).toBeDefined();
    });

    it("createDefectsAggregatorDefectProof generates valid DefectResolutionProof", () => {
      const proof = createDefectsAggregatorDefectProof({
        taskId: "Task 1.12",
        commitSha: "def12345",
      });
      expect(proof.task_id).toBe("Task 1.12");
      expect(proof.commit_sha).toBe("def12345");
      expect(proof.verified).toBe(true);
      expect(proof.empirical_command).toBe(
        "bun test tests/unit/mind/defect-mind-defects-unresolved-aggregator-import.test.ts",
      );
      expect(
        proof.test_assertion?.includes("defect-mind-defects-unresolved-aggregator-import"),
      ).toBe(true);
    });

    it("formatDefectsAggregatorAuditBrief formats audit and validation briefs into markdown", () => {
      const auditReport: DefectsAggregatorModuleAuditReport = {
        defectRef: DEFECT_REF,
        errorCode: UNRESOLVED_MODULE_IMPORT_IN_DEFECTS,
        resolved: true,
        totalFilesScanned: 8,
        validFilesCount: 8,
        invalidFilesCount: 0,
        checkedFiles: ["mind/defects/index.ts"],
        issues: [],
        fileReports: [],
        timestamp: "2026-08-29T10:00:00.000Z",
      };
      const auditBrief = formatDefectsAggregatorAuditBrief(auditReport);
      expect(auditBrief.includes("Defects Aggregator Import Audit Brief")).toBe(true);
      expect(auditBrief.includes("PASSED (Clean)")).toBe(true);
      expect(auditBrief.includes("Total Files Scanned")).toBe(true);
      expect(auditBrief.includes("8")).toBe(true);

      const validationResult: DefectsAggregatorValidationResult = {
        valid: true,
        defectRef: DEFECT_REF,
        filePath: CANONICAL_DEFECTS_BARREL_PATH,
        legacyImportDetected: false,
        canonicalImportPresent: true,
        imports: [CANONICAL_AGGREGATOR_BARREL_SPECIFIER],
        importEntries: [],
        issues: [],
        issueCount: 0,
      };
      const valBrief = formatDefectsAggregatorAuditBrief(validationResult);
      expect(valBrief.includes("Defects Aggregator Validation Brief")).toBe(true);
      expect(valBrief.includes("PASSED (Clean)")).toBe(true);
    });
  });
});
