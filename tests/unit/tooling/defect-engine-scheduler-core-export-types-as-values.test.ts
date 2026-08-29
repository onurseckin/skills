import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ALL_KNOWN_CORE_TYPE_NAMES,
  CANONICAL_SCHEDULER_CORE_DIR,
  DEFECT_REF,
  ERROR_CODE,
  KNOWN_CORE_TYPE_NAMES,
  KNOWN_CORE_VALUE_EXPORTS,
  KNOWN_FEEDBACK_TYPE_NAMES,
  SYNTAX_ERROR_TYPE_EXPORT_AS_VALUE,
  SchedulerCoreExportTypeError,
  TARGET_CORE_INDEX_PATH,
  TARGET_CORE_TYPES_PATH,
  assertSchedulerCoreExportPurity,
  auditDirectoryForTypeExportViolations,
  createSchedulerCoreExportDefectEntry,
  createSchedulerCoreResolutionProof,
  extractExportDeclarations,
  extractTypeNamesFromSource,
  loadTypeNamesFromTypesFile,
  reconcileSchedulerCoreIndex,
  remediateSchedulerCoreTypeExports,
  validateSchedulerCoreExportPurity,
  verifySchedulerCoreExportRemediation,
} from "../../../olt/scripts/src/tooling/defect-engine-scheduler-core-export-types-as-values.ts";

const tempDirs: string[] = [];

function createTempDir(prefix = "scheduler-core-export-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("Task 1.4: Defect Remediation - Export Types as Values in engine/scheduler/core/index.ts", () => {
  describe("1. Defect Constants, Identifiers & Canonical Paths", () => {
    test("defect identifiers and error codes match specification", () => {
      expect(DEFECT_REF).toBe("defect-engine-scheduler-core-export-types-as-values");
      expect(ERROR_CODE).toBe("SYNTAX_ERROR_TYPE_EXPORT_AS_VALUE");
      expect(SYNTAX_ERROR_TYPE_EXPORT_AS_VALUE).toBe("SYNTAX_ERROR_TYPE_EXPORT_AS_VALUE");
      expect(TARGET_CORE_INDEX_PATH).toBe("olt/scripts/src/engine/scheduler/core/index.ts");
      expect(TARGET_CORE_TYPES_PATH).toBe("olt/scripts/src/engine/scheduler/core/types.ts");
      expect(CANONICAL_SCHEDULER_CORE_DIR).toBe("olt/scripts/src/engine/scheduler/core");
    });

    test("known type symbols from types.ts are cataloged", () => {
      expect(KNOWN_CORE_TYPE_NAMES.length).toBeGreaterThanOrEqual(20);
      expect(KNOWN_CORE_TYPE_NAMES).toContain("GraphHealthIssue");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("OrphanedTasksProbeResult");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("StaleLeaseInfo");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("CircularDependenciesProbeResult");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("GateCoverageProbeResult");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("ScopeCollisionHazard");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("GraphHealthAuditReport");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("SupervisoryWatchdogAuditReport");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("WorkSpanHealthAudit");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("SupervisoryTopLeader");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("PlanEnhancementAudit");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("AgentRegistryAccuracyAudit");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("RoleBoundaryAdherenceAudit");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("DoctorErrorResolutionAudit");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("Supervisory5PointHealthReport");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("TaskRecoveryRecord");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("ScheduledTaskDispatch");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("BlockedTaskInfo");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("ScheduledWaveResult");
      expect(KNOWN_CORE_TYPE_NAMES).toContain("SchedulerEngineOptions");
    });

    test("known feedback types and value exports are cataloged", () => {
      expect(KNOWN_FEEDBACK_TYPE_NAMES).toContain("PulseLoopOptions");
      expect(KNOWN_FEEDBACK_TYPE_NAMES).toContain("PulseTickResult");
      expect(ALL_KNOWN_CORE_TYPE_NAMES.length).toBe(
        KNOWN_CORE_TYPE_NAMES.length + KNOWN_FEEDBACK_TYPE_NAMES.length,
      );

      expect(KNOWN_CORE_VALUE_EXPORTS).toContain("probeOrphanedTasks");
      expect(KNOWN_CORE_VALUE_EXPORTS).toContain("auditGraphHealth");
      expect(KNOWN_CORE_VALUE_EXPORTS).toContain("SchedulerEngine");
      expect(KNOWN_CORE_VALUE_EXPORTS).toContain("createSchedulerEngine");
    });
  });

  describe("2. Error Class & Custom Options", () => {
    test("SchedulerCoreExportTypeError instantiates with default code and defectRef", () => {
      const err = new SchedulerCoreExportTypeError("Export type error");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SchedulerCoreExportTypeError);
      expect(err.name).toBe("SchedulerCoreExportTypeError");
      expect(err.message).toBe("Export type error");
      expect(err.code).toBe(ERROR_CODE);
      expect(err.defectRef).toBe(DEFECT_REF);
      expect(err.filePath).toBeUndefined();
      expect(err.symbolName).toBeUndefined();
      expect(err.issues).toEqual([]);
    });

    test("SchedulerCoreExportTypeError preserves custom options", () => {
      const err = new SchedulerCoreExportTypeError("Invalid interface export as value", {
        code: "CUSTOM_ERR",
        defectRef: "custom-ref",
        filePath: "/path/to/core/index.ts",
        symbolName: "GraphHealthIssue",
        exportKind: "value",
        issues: [
          {
            code: "CUSTOM_ERR",
            severity: "ERROR",
            message: "Interface exported as value",
            symbolName: "GraphHealthIssue",
            moduleSpecifier: "./types.ts",
            filePath: "/path/to/core/index.ts",
            lineNumber: 45,
          },
        ],
      });

      expect(err.code).toBe("CUSTOM_ERR");
      expect(err.defectRef).toBe("custom-ref");
      expect(err.filePath).toBe("/path/to/core/index.ts");
      expect(err.symbolName).toBe("GraphHealthIssue");
      expect(err.exportKind).toBe("value");
      expect(err.issues.length).toBe(1);
      expect(err.issues[0]?.lineNumber).toBe(45);
    });
  });

  describe("3. Parsing & Extraction Helpers", () => {
    test("extractTypeNamesFromSource extracts interface, type, and enum definitions", () => {
      const src = `
        export interface GraphHealthIssue { id: string; }
        export type TaskRecoveryRecord = { taskId: string };
        export enum SchedulerStatus { IDLE, RUNNING }
        interface LocalPrivateInterface { count: number; }
        type LocalPrivateType = string | number;
        export function createEngine() {}
        export const MAX_REPAIR_ROUNDS = 5;
      `;
      const types = extractTypeNamesFromSource(src);
      expect(types).toContain("GraphHealthIssue");
      expect(types).toContain("TaskRecoveryRecord");
      expect(types).toContain("SchedulerStatus");
      expect(types).toContain("LocalPrivateInterface");
      expect(types).toContain("LocalPrivateType");
      expect(types).not.toContain("createEngine");
      expect(types).not.toContain("MAX_REPAIR_ROUNDS");
    });

    test("loadTypeNamesFromTypesFile loads from actual file or falls back to defaults", () => {
      const livePath = resolve(process.cwd(), TARGET_CORE_TYPES_PATH);
      if (existsSync(livePath)) {
        const types = loadTypeNamesFromTypesFile(livePath);
        expect(types).toContain("GraphHealthIssue");
        expect(types).toContain("SchedulerEngineOptions");
      }

      const fallback = loadTypeNamesFromTypesFile("/non/existent/types.ts");
      expect(fallback).toEqual(ALL_KNOWN_CORE_TYPE_NAMES);
    });

    test("extractExportDeclarations parses type-only, value, inline-type, and direct exports", () => {
      const snippet = `
        export { probeOrphanedTasks, probeStaleLeases } from "./tasks/tasks.ts";
        export type {
          GraphHealthIssue,
          OrphanedTasksProbeResult,
        } from "./types.ts";
        export { type StaleLeaseInfo, recoverStaleTasks } from "./state.ts";
        export function determineTopLeader() {}
        export const NOOP_COMMANDS = ["noop"];
        export interface InlinedInterface {}
      `;

      const declarations = extractExportDeclarations(snippet);
      expect(declarations.length).toBeGreaterThanOrEqual(5);

      const typeOnlyDecl = declarations.find((d) => d.isTypeOnly && d.moduleSpecifier === "./types.ts");
      expect(typeOnlyDecl).toBeDefined();
      expect(typeOnlyDecl?.symbols.map((s) => s.name)).toContain("GraphHealthIssue");
      expect(typeOnlyDecl?.symbols.map((s) => s.name)).toContain("OrphanedTasksProbeResult");
      expect(typeOnlyDecl?.symbols.every((s) => s.isTypeOnly)).toBe(true);

      const mixedDecl = declarations.find((d) => d.moduleSpecifier === "./state.ts");
      expect(mixedDecl).toBeDefined();
      const staleSym = mixedDecl?.symbols.find((s) => s.name === "StaleLeaseInfo");
      expect(staleSym?.isTypeOnly).toBe(true);

      const funcDecl = declarations.find((d) => d.symbols.some((s) => s.name === "determineTopLeader"));
      expect(funcDecl?.isTypeOnly).toBe(false);

      const inlinedDecl = declarations.find((d) => d.symbols.some((s) => s.name === "InlinedInterface"));
      expect(inlinedDecl?.isTypeOnly).toBe(true);
    });
  });

  describe("4. Validation & Purity Audits", () => {
    test("validateSchedulerCoreExportPurity succeeds on pure type export block", () => {
      const cleanSnippet = `
        export { probeOrphanedTasks } from "./tasks/tasks.ts";
        export type {
          GraphHealthIssue,
          OrphanedTasksProbeResult,
        } from "./types.ts";
        export { SchedulerEngine } from "./core-engine-class.ts";
      `;

      const result = validateSchedulerCoreExportPurity(cleanSnippet);
      expect(result.valid).toBe(true);
      expect(result.defectRef).toBe(DEFECT_REF);
      expect(result.errorCode).toBe(ERROR_CODE);
      expect(result.invalidTypeExportsAsValuesCount).toBe(0);
      expect(result.findings).toEqual([]);
      expect(result.typeOnlyExportsCount).toBe(1);
      expect(result.valueExportsCount).toBe(2);
    });

    test("validateSchedulerCoreExportPurity flags 'export { ... } from \"./types.ts\"' as error", () => {
      const defectiveSnippet = `
        export { probeOrphanedTasks } from "./tasks/tasks.ts";
        export {
          GraphHealthIssue,
          OrphanedTasksProbeResult,
          StaleLeaseInfo,
        } from "./types.ts";
        export { SchedulerEngine } from "./core-engine-class.ts";
      `;

      const result = validateSchedulerCoreExportPurity(defectiveSnippet);
      expect(result.valid).toBe(false);
      expect(result.invalidTypeExportsAsValuesCount).toBe(3);
      expect(result.findings.length).toBe(3);

      const f1 = result.findings.find((f) => f.symbolName === "GraphHealthIssue");
      expect(f1).toBeDefined();
      expect(f1?.code).toBe(ERROR_CODE);
      expect(f1?.severity).toBe("ERROR");
      expect(f1?.message).toContain("exported as a runtime value");
      expect(f1?.suggestedRemediation).toContain("export type");
    });

    test("validateSchedulerCoreExportPurity handles missing file path gracefully", () => {
      const result = validateSchedulerCoreExportPurity("/path/to/nonexistent/core/index.ts");
      expect(result.valid).toBe(false);
      expect(result.findings.length).toBe(1);
      expect(result.findings[0]?.symbolName).toBe("FILE_NOT_FOUND");
    });
  });

  describe("5. Assertion Behavior", () => {
    test("assertSchedulerCoreExportPurity does not throw on valid type-safe barrel", () => {
      const validCode = `
        export { probeOrphanedTasks } from "./tasks/tasks.ts";
        export type { GraphHealthIssue } from "./types.ts";
      `;
      expect(() => assertSchedulerCoreExportPurity(validCode)).not.toThrow();
    });

    test("assertSchedulerCoreExportPurity throws SchedulerCoreExportTypeError on violation", () => {
      const defectiveCode = `
        export { GraphHealthIssue } from "./types.ts";
      `;

      let thrown: unknown;
      try {
        assertSchedulerCoreExportPurity(defectiveCode);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(SchedulerCoreExportTypeError);
      if (thrown instanceof SchedulerCoreExportTypeError) {
        expect(thrown.code).toBe(ERROR_CODE);
        expect(thrown.defectRef).toBe(DEFECT_REF);
        expect(thrown.symbolName).toBe("GraphHealthIssue");
        expect(thrown.issues.length).toBe(1);
      }
    });
  });

  describe("6. Automated Remediation", () => {
    test("remediateSchedulerCoreTypeExports rewrites 'export { ... } from \"./types.ts\"' to 'export type'", () => {
      const defectiveCode = `
export { probeOrphanedTasks } from "./tasks/tasks.ts";

export {
  GraphHealthIssue,
  OrphanedTasksProbeResult,
} from "./types.ts";

export { SchedulerEngine } from "./core-engine-class.ts";
      `;

      const remediated = remediateSchedulerCoreTypeExports(defectiveCode);
      expect(remediated).toContain("export type {\n  GraphHealthIssue,\n  OrphanedTasksProbeResult,\n} from \"./types.ts\";");
      expect(remediated).toContain("export { probeOrphanedTasks } from \"./tasks/tasks.ts\";");
      expect(remediated).toContain("export { SchedulerEngine } from \"./core-engine-class.ts\";");

      // Verify the remediated content now passes purity validation
      const audit = validateSchedulerCoreExportPurity(remediated);
      expect(audit.valid).toBe(true);
      expect(audit.invalidTypeExportsAsValuesCount).toBe(0);
    });

    test("remediateSchedulerCoreTypeExports handles mixed exports by isolating types and values", () => {
      const mixedCode = `
export {
  probeOrphanedTasks,
  GraphHealthIssue,
} from "./types.ts";
      `;

      const remediated = remediateSchedulerCoreTypeExports(mixedCode);
      expect(remediated).toContain("export type {");
      expect(remediated).toContain("GraphHealthIssue");
    });

    test("remediateSchedulerCoreTypeExports leaves already compliant code untouched", () => {
      const compliantCode = `
export { probeOrphanedTasks } from "./tasks/tasks.ts";
export type { GraphHealthIssue } from "./types.ts";
      `;

      const remediated = remediateSchedulerCoreTypeExports(compliantCode);
      expect(remediated.trim()).toBe(compliantCode.trim());
    });
  });

  describe("7. Live Repository & Directory Tree Auditing", () => {
    test("validates live engine/scheduler/core/index.ts with 100% PASS", () => {
      const livePath = resolve(process.cwd(), TARGET_CORE_INDEX_PATH);
      expect(existsSync(livePath)).toBe(true);

      const audit = validateSchedulerCoreExportPurity(livePath);
      expect(audit.valid).toBe(true);
      expect(audit.defectRef).toBe(DEFECT_REF);
      expect(audit.errorCode).toBe(ERROR_CODE);
      expect(audit.invalidTypeExportsAsValuesCount).toBe(0);
      expect(audit.findings).toEqual([]);
      expect(audit.totalExportDeclarations).toBeGreaterThan(0);
      expect(audit.typeOnlyExportsCount).toBeGreaterThan(0);
    });

    test("assertSchedulerCoreExportPurity passes on live engine/scheduler/core/index.ts", () => {
      const livePath = resolve(process.cwd(), TARGET_CORE_INDEX_PATH);
      expect(() => assertSchedulerCoreExportPurity(livePath)).not.toThrow();
    });

    test("auditDirectoryForTypeExportViolations audits directories correctly", () => {
      const tempDir = createTempDir();
      const cleanFile = join(tempDir, "clean.ts");
      const badFile = join(tempDir, "bad.ts");

      writeFileSync(
        cleanFile,
        `export { probeOrphanedTasks } from "./tasks.ts";\nexport type { GraphHealthIssue } from "./types.ts";`,
        "utf-8",
      );
      writeFileSync(
        badFile,
        `export { GraphHealthIssue, StaleLeaseInfo } from "./types.ts";`,
        "utf-8",
      );

      const treeAudit = auditDirectoryForTypeExportViolations(tempDir);
      expect(treeAudit.defectRef).toBe(DEFECT_REF);
      expect(treeAudit.resolved).toBe(false);
      expect(treeAudit.totalFiles).toBe(2);
      expect(treeAudit.validFiles).toBe(1);
      expect(treeAudit.invalidFiles).toBe(1);
      expect(treeAudit.findings.length).toBe(2);
    });
  });

  describe("8. File Reconciler", () => {
    test("reconcileSchedulerCoreIndex supports dryRun mode on fixture", () => {
      const tempDir = createTempDir();
      const fixturePath = join(tempDir, "index.ts");
      const originalCode = `export { GraphHealthIssue } from "./types.ts";`;
      writeFileSync(fixturePath, originalCode, "utf-8");

      const result = reconcileSchedulerCoreIndex(fixturePath, { dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.modified).toBe(true);
      expect(result.fixedSymbolsCount).toBe(1);
      expect(result.remediatedContent).toContain("export type {");

      // Verify file on disk was not modified
      expect(readFileSync(fixturePath, "utf-8")).toBe(originalCode);
    });

    test("reconcileSchedulerCoreIndex writes fixes to disk when not in dryRun", () => {
      const tempDir = createTempDir();
      const fixturePath = join(tempDir, "index.ts");
      const originalCode = `export { GraphHealthIssue } from "./types.ts";`;
      writeFileSync(fixturePath, originalCode, "utf-8");

      const result = reconcileSchedulerCoreIndex(fixturePath, { dryRun: false });
      expect(result.dryRun).toBe(false);
      expect(result.modified).toBe(true);
      expect(result.fixedSymbolsCount).toBe(1);

      const updatedOnDisk = readFileSync(fixturePath, "utf-8");
      expect(updatedOnDisk).toContain("export type {");
      expect(validateSchedulerCoreExportPurity(updatedOnDisk).valid).toBe(true);
    });

    test("reconcileSchedulerCoreIndex throws on non-existent file path", () => {
      expect(() => reconcileSchedulerCoreIndex("/non/existent/index.ts")).toThrow(
        SchedulerCoreExportTypeError,
      );
    });
  });

  describe("9. Defect Tracking, Proof Generation & Live Verification", () => {
    test("createSchedulerCoreExportDefectEntry produces valid DefectEntry", () => {
      const entry = createSchedulerCoreExportDefectEntry();
      expect(entry.id).toContain(DEFECT_REF);
      expect(entry.domain).toBe("engine-scheduler-tooling");
      expect(entry.error_code).toBe(ERROR_CODE);
      expect(entry.type).toBe("RUNTIME_ERROR");
      expect(entry.category).toBe("code_defect");
      expect(entry.severity).toBe("high");
      expect(entry.status).toBe("resolved");
      expect(entry.context?.file).toBe(TARGET_CORE_INDEX_PATH);
    });

    test("createSchedulerCoreResolutionProof produces valid DefectResolutionProof", () => {
      const proof = createSchedulerCoreResolutionProof();
      expect(proof.defect_ref).toBe(DEFECT_REF);
      expect(proof.error_code).toBe(ERROR_CODE);
      expect(proof.task_id).toBe("Task 1.4");
      expect(proof.verified).toBe(true);
      expect(proof.empirical_command).toContain(
        "bun test tests/unit/tooling/defect-engine-scheduler-core-export-types-as-values.test.ts",
      );
      expect(proof.explanation).toContain("Remediated barrel export in engine/scheduler/core/index.ts");
    });

    test("verifySchedulerCoreExportRemediation performs full verification on live repo", () => {
      const livePath = resolve(process.cwd(), TARGET_CORE_INDEX_PATH);
      const report = verifySchedulerCoreExportRemediation(livePath);
      expect(report.defectRef).toBe(DEFECT_REF);
      expect(report.verified).toBe(true);
      expect(report.audit.valid).toBe(true);
      expect(report.audit.invalidTypeExportsAsValuesCount).toBe(0);
      expect(report.proof.verified).toBe(true);
    });
  });
});
