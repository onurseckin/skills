import { describe, expect, test } from "bun:test";
import {
  DEFECT_REF,
  DEFECT_ERROR_CODE,
  ERROR_CODE,
  UNRESOLVED_MODULE_IMPORT_AFTER_REFACTOR,
  INVARIANT_NUMBER,
  INVARIANT_REF,
  INVARIANT_DESCRIPTION,
  MODULAR_SUBDIRECTORIES,
  LEGACY_FLAT_FILE_MAPPINGS,
  ALL_CANONICAL_SYMBOLS,
  RunnerModelsImportResolutionError,
  extractModuleImports,
  extractImportEntries,
  isLegacyRunnerModelsImport,
  resolveRunnerModelsModularImport,
  remediateRunnerModelsImports,
  remediateRunnerModelsImportsWithReport,
  validateRunnerModelsImports,
  assertValidRunnerModelsImports,
  verifyBarrelReExports,
  auditRunnerModelsModularization,
  auditRunnerModelsCallerFiles,
  createRunnerModelsDefectProof,
  createRunnerModelsDefectEntry,
  // Facade Re-exports
  commandId,
  isBroadScopeTest,
  MAX_COMMAND_ATTEMPT_BYTES,
  MAX_COMMAND_RECORD_BYTES,
  MAX_COMMAND_INTENT_BYTES,
} from "../../../olt/scripts/src/tooling/defect-engine-runner-models-modularization-import-paths.ts";

describe("defect-engine-runner-models-modularization-import-paths", () => {
  describe("Defect Metadata & Invariants", () => {
    test("exposes canonical defect identification constants", () => {
      expect(DEFECT_REF).toBe("defect-engine-runner-models-modularization-import-paths");
      expect(DEFECT_ERROR_CODE).toBe("UNRESOLVED_MODULE_IMPORT_AFTER_REFACTOR");
      expect(ERROR_CODE).toBe("UNRESOLVED_MODULE_IMPORT_AFTER_REFACTOR");
      expect(UNRESOLVED_MODULE_IMPORT_AFTER_REFACTOR).toBe("UNRESOLVED_MODULE_IMPORT_AFTER_REFACTOR");
      expect(INVARIANT_NUMBER).toBe(1);
      expect(INVARIANT_REF).toBe("Invariant 1.8");
      expect(typeof INVARIANT_DESCRIPTION).toBe("string");
      expect(INVARIANT_DESCRIPTION.length).toBeGreaterThan(0);
    });

    test("defines exact modular subdirectories", () => {
      expect(MODULAR_SUBDIRECTORIES).toEqual(["attempt", "command", "execution"]);
    });

    test("maps all known legacy flat files to modular subdirectories", () => {
      expect(LEGACY_FLAT_FILE_MAPPINGS["command-shape.ts"]).toEqual({
        submodule: "command",
        relativePath: "command/command-shape.ts",
      });
      expect(LEGACY_FLAT_FILE_MAPPINGS["run-attempt.ts"]).toEqual({
        submodule: "attempt",
        relativePath: "attempt/run-attempt.ts",
      });
      expect(LEGACY_FLAT_FILE_MAPPINGS["run-command.ts"]).toEqual({
        submodule: "execution",
        relativePath: "execution/run-command.ts",
      });
      expect(LEGACY_FLAT_FILE_MAPPINGS["internal-command-runner.ts"]).toEqual({
        submodule: "execution",
        relativePath: "execution/internal-command-runner.ts",
      });
      expect(LEGACY_FLAT_FILE_MAPPINGS["attempt-support.ts"]).toEqual({
        submodule: "attempt",
        relativePath: "attempt/attempt-support.ts",
      });
    });

    test("contains canonical symbols mapping for all 3 submodules", () => {
      expect(ALL_CANONICAL_SYMBOLS.attempt).toContain("runAttempt");
      expect(ALL_CANONICAL_SYMBOLS.attempt).toContain("finalizeGateAttempt");
      expect(ALL_CANONICAL_SYMBOLS.command).toContain("commandId");
      expect(ALL_CANONICAL_SYMBOLS.command).toContain("embeddedCommandIssues");
      expect(ALL_CANONICAL_SYMBOLS.execution).toContain("createInternalCommandRunner");
      expect(ALL_CANONICAL_SYMBOLS.execution).toContain("runCommand");
    });
  });

  describe("RunnerModelsImportResolutionError", () => {
    test("constructs error instance with defaults", () => {
      const error = new RunnerModelsImportResolutionError("Test error");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RunnerModelsImportResolutionError);
      expect(error.name).toBe("RunnerModelsImportResolutionError");
      expect(error.code).toBe(DEFECT_ERROR_CODE);
      expect(error.defectRef).toBe(DEFECT_REF);
      expect(error.issues).toEqual([]);
    });

    test("constructs error instance with custom details", () => {
      const issue = {
        code: DEFECT_ERROR_CODE,
        message: "Legacy import detected",
        specifier: "../../engine/runner/models/command-shape.ts",
        filePath: "src/test.ts",
        line: 5,
        suggestedRemediation: "../../engine/runner/models/command/command-shape.ts",
        targetSubmodule: "command" as const,
      };

      const error = new RunnerModelsImportResolutionError("Custom message", {
        code: "CUSTOM_CODE",
        defectRef: "custom-ref",
        specifier: issue.specifier,
        filePath: issue.filePath,
        issues: [issue],
      });

      expect(error.code).toBe("CUSTOM_CODE");
      expect(error.defectRef).toBe("custom-ref");
      expect(error.specifier).toBe("../../engine/runner/models/command-shape.ts");
      expect(error.filePath).toBe("src/test.ts");
      expect(error.issues.length).toBe(1);
      expect(error.issues[0]?.targetSubmodule).toBe("command");
    });
  });

  describe("Import Extraction", () => {
    test("extractModuleImports extracts all static and dynamic imports", () => {
      const source = `
        import { runAttempt } from "../engine/runner/models/run-attempt.ts";
        import * as models from "../../engine/runner/models/index.ts";
        export { commandId } from "./command/command-id.ts";
        const dyn = await import("../engine/runner/models/execution/run-command.ts");
      `;

      const imports = extractModuleImports(source);
      expect(imports).toContain("../engine/runner/models/run-attempt.ts");
      expect(imports).toContain("../../engine/runner/models/index.ts");
      expect(imports).toContain("./command/command-id.ts");
      expect(imports).toContain("../engine/runner/models/execution/run-command.ts");
    });

    test("extractModuleImports returns empty array for empty or whitespace source", () => {
      expect(extractModuleImports("")).toEqual([]);
      expect(extractModuleImports("   \n\t  ")).toEqual([]);
    });

    test("extractImportEntries parses line numbers and symbols accurately", () => {
      const source = [
        'import { commandId, canonicalCommandFingerprint } from "../engine/runner/models/command/command-id.ts";',
        'import type { InternalCommandRunner } from "../engine/runner/models/execution/internal-command-runner.ts";',
        'import "../engine/runner/models/attempt/attempt-support.ts";',
      ].join("\n");

      const entries = extractImportEntries(source);
      expect(entries.length).toBe(3);

      expect(entries[0]?.specifier).toBe("../engine/runner/models/command/command-id.ts");
      expect(entries[0]?.namedSymbols).toContain("commandId");
      expect(entries[0]?.namedSymbols).toContain("canonicalCommandFingerprint");
      expect(entries[0]?.isTypeOnly).toBe(false);
      expect(entries[0]?.line).toBe(1);

      expect(entries[1]?.specifier).toBe("../engine/runner/models/execution/internal-command-runner.ts");
      expect(entries[1]?.namedSymbols).toContain("InternalCommandRunner");
      expect(entries[1]?.isTypeOnly).toBe(true);
      expect(entries[1]?.line).toBe(2);

      expect(entries[2]?.specifier).toBe("../engine/runner/models/attempt/attempt-support.ts");
      expect(entries[2]?.line).toBe(3);
    });
  });

  describe("Legacy Import Detection (isLegacyRunnerModelsImport)", () => {
    test("detects flat legacy imports as true", () => {
      expect(isLegacyRunnerModelsImport("../../engine/runner/models/command-shape.ts")).toBe(true);
      expect(isLegacyRunnerModelsImport("../engine/runner/models/run-attempt.ts")).toBe(true);
      expect(isLegacyRunnerModelsImport("engine/runner/models/command-id.ts")).toBe(true);
      expect(isLegacyRunnerModelsImport("../../engine/runner/models/internal-command-runner.ts")).toBe(true);
      expect(isLegacyRunnerModelsImport("../../engine/runner/models/command-aggregate")).toBe(true);
      expect(isLegacyRunnerModelsImport("../../engine/runner/models/run-command-lock.ts")).toBe(true);
      expect(isLegacyRunnerModelsImport("models/attempt-support.ts")).toBe(true);
    });

    test("identifies modularized paths and barrel imports as non-legacy (false)", () => {
      expect(isLegacyRunnerModelsImport("../../engine/runner/models/command/command-shape.ts")).toBe(false);
      expect(isLegacyRunnerModelsImport("../../engine/runner/models/attempt/run-attempt.ts")).toBe(false);
      expect(isLegacyRunnerModelsImport("../../engine/runner/models/execution/run-command.ts")).toBe(false);
      expect(isLegacyRunnerModelsImport("../../engine/runner/models/index.ts")).toBe(false);
      expect(isLegacyRunnerModelsImport("../../engine/runner/models/index")).toBe(false);
      expect(isLegacyRunnerModelsImport("../../engine/runner/models/attempt/index.ts")).toBe(false);
      expect(isLegacyRunnerModelsImport("../../engine/runner/models/command/index.ts")).toBe(false);
      expect(isLegacyRunnerModelsImport("../../engine/runner/models/execution/index.ts")).toBe(false);
      expect(isLegacyRunnerModelsImport("./attempt/index.ts")).toBe(false);
      expect(isLegacyRunnerModelsImport("./command/index.ts")).toBe(false);
      expect(isLegacyRunnerModelsImport("./execution/index.ts")).toBe(false);
      expect(isLegacyRunnerModelsImport("../engine/scheduler/index.ts")).toBe(false);
      expect(isLegacyRunnerModelsImport("")).toBe(false);
    });
  });

  describe("Import Resolution (resolveRunnerModelsModularImport)", () => {
    test("resolves legacy flat paths to correct modular subdirectories", () => {
      expect(
        resolveRunnerModelsModularImport("../../engine/runner/models/command-shape.ts"),
      ).toBe("../../engine/runner/models/command/command-shape.ts");

      expect(
        resolveRunnerModelsModularImport("../engine/runner/models/run-attempt.ts"),
      ).toBe("../engine/runner/models/attempt/run-attempt.ts");

      expect(
        resolveRunnerModelsModularImport("../../engine/runner/models/internal-command-runner.ts"),
      ).toBe("../../engine/runner/models/execution/internal-command-runner.ts");

      expect(
        resolveRunnerModelsModularImport("models/gate-attempt-finalization.ts"),
      ).toBe("models/attempt/gate-attempt-finalization.ts");
    });

    test("returns non-legacy specifiers unchanged", () => {
      const canonical = "../../engine/runner/models/command/command-shape.ts";
      expect(resolveRunnerModelsModularImport(canonical)).toBe(canonical);

      const barrel = "../../engine/runner/models/index.ts";
      expect(resolveRunnerModelsModularImport(barrel)).toBe(barrel);
    });
  });

  describe("Source Remediation (remediateRunnerModelsImports)", () => {
    test("replaces flat legacy imports with modular subdirectories", () => {
      const legacySource = `
import { commandId } from "../../engine/runner/models/command-id.ts";
import { runAttempt } from "../engine/runner/models/run-attempt.ts";
import { runCommand } from "./models/run-command.ts";
`;

      const remediated = remediateRunnerModelsImports(legacySource);

      expect(remediated).toContain('from "../../engine/runner/models/command/command-id.ts"');
      expect(remediated).toContain('from "../engine/runner/models/attempt/run-attempt.ts"');
      expect(remediated).toContain('from "./models/execution/run-command.ts"');
      expect(isLegacyRunnerModelsImport(extractModuleImports(remediated)[0]!)).toBe(false);
      expect(isLegacyRunnerModelsImport(extractModuleImports(remediated)[1]!)).toBe(false);
      expect(isLegacyRunnerModelsImport(extractModuleImports(remediated)[2]!)).toBe(false);
    });

    test("remediates with preferBarrels option to direct to index.ts barrels", () => {
      const legacySource = `import { commandId } from "../../engine/runner/models/command-id.ts";`;
      const remediated = remediateRunnerModelsImports(legacySource, { preferBarrels: true });
      expect(remediated).toContain('from "../../engine/runner/models/index.ts"');
    });

    test("remediateRunnerModelsImportsWithReport provides full reporting metrics", () => {
      const legacySource = `
import { commandId } from "../../engine/runner/models/command-id.ts";
import { runAttempt } from "../../engine/runner/models/run-attempt.ts";
`;

      const report = remediateRunnerModelsImportsWithReport(legacySource);
      expect(report.defectRef).toBe(DEFECT_REF);
      expect(report.success).toBe(true);
      expect(report.replacementsCount).toBe(2);
      expect(report.originalSource).toBe(legacySource);
      expect(report.remediatedSource).toContain("command/command-id.ts");
      expect(report.remediatedSource).toContain("attempt/run-attempt.ts");
    });
  });

  describe("Validation & Assertion", () => {
    test("validateRunnerModelsImports flags legacy imports as invalid", () => {
      const legacyCode = 'import { sameCommandJson } from "../../engine/runner/models/command-shape.ts";';
      const result = validateRunnerModelsImports(legacyCode);

      expect(result.valid).toBe(false);
      expect(result.defectRef).toBe(DEFECT_REF);
      expect(result.legacyImportsDetected).toBe(true);
      expect(result.legacyImportsCount).toBe(1);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0]?.code).toBe(DEFECT_ERROR_CODE);
      expect(result.issues[0]?.targetSubmodule).toBe("command");
      expect(result.issues[0]?.suggestedRemediation).toBe("../../engine/runner/models/command/command-shape.ts");
    });

    test("validateRunnerModelsImports accepts valid modular imports", () => {
      const validCode = 'import { sameCommandJson } from "../../engine/runner/models/command/command-shape.ts";';
      const result = validateRunnerModelsImports(validCode);

      expect(result.valid).toBe(true);
      expect(result.legacyImportsDetected).toBe(false);
      expect(result.legacyImportsCount).toBe(0);
      expect(result.issues.length).toBe(0);
    });

    test("validateRunnerModelsImports handles non-existent file gracefully", () => {
      const result = validateRunnerModelsImports("non_existent_file_path_xyz.ts");
      expect(result.valid).toBe(false);
      expect(result.issues[0]?.message).toContain("does not exist");
    });

    test("validateRunnerModelsImports returns valid for empty input", () => {
      const result = validateRunnerModelsImports();
      expect(result.valid).toBe(true);
      expect(result.issueCount).toBe(0);
    });

    test("assertValidRunnerModelsImports throws RunnerModelsImportResolutionError on legacy imports", () => {
      const legacyCode = 'import { runAttempt } from "../../engine/runner/models/run-attempt.ts";';
      expect(() => assertValidRunnerModelsImports(legacyCode)).toThrow(
        RunnerModelsImportResolutionError,
      );
    });

    test("assertValidRunnerModelsImports succeeds on clean modular code", () => {
      const validCode = 'import { runAttempt } from "../../engine/runner/models/attempt/run-attempt.ts";';
      expect(() => assertValidRunnerModelsImports(validCode)).not.toThrow();
    });
  });

  describe("Live Barrels & Repository Auditing", () => {
    test("verifyBarrelReExports verifies live runner models barrel structure", () => {
      const report = verifyBarrelReExports();
      expect(report.verified).toBe(true);
      expect(report.missingBarrels.length).toBe(0);
      expect(report.missingSymbols.length).toBe(0);
      expect(report.issues.length).toBe(0);
      expect(report.exportedSymbolsCount).toBeGreaterThan(20);
      expect(report.barrelsChecked.length).toBe(4); // main + 3 submodules
    });

    test("auditRunnerModelsModularization validates models directory integrity", () => {
      const report = auditRunnerModelsModularization();
      expect(report.defectRef).toBe(DEFECT_REF);
      expect(report.errorCode).toBe(DEFECT_ERROR_CODE);
      expect(report.resolved).toBe(true);
      expect(report.invalidFilesCount).toBe(0);
      expect(report.totalFilesScanned).toBeGreaterThan(15);
      expect(report.issues.length).toBe(0);
    });

    test("auditRunnerModelsCallerFiles validates caller files in workflow and integration", () => {
      const report = auditRunnerModelsCallerFiles();
      expect(report.defectRef).toBe(DEFECT_REF);
      expect(report.errorCode).toBe(DEFECT_ERROR_CODE);
      expect(report.resolved).toBe(true);
      expect(report.invalidFilesCount).toBe(0);
      expect(report.scannedFilesCount).toBeGreaterThan(0);
      expect(report.issues.length).toBe(0);
    });
  });

  describe("Defect Entry & Proof Generation", () => {
    test("createRunnerModelsDefectProof builds complete verification proof", () => {
      const proof = createRunnerModelsDefectProof();
      expect(proof.task_id).toBe(`task-remediate-${DEFECT_REF}`);
      expect(proof.verified).toBe(true);
      expect(proof.empirical_command).toBe(
        "bun test tests/unit/tooling/defect-engine-runner-models-modularization-import-paths.test.ts",
      );
      expect(typeof proof.resolved_at).toBe("string");
      expect(proof.commit_sha).toBeDefined();
    });

    test("createRunnerModelsDefectEntry creates structured defect entry", () => {
      const entry = createRunnerModelsDefectEntry({
        severity: "high",
        status: "resolved",
      });

      expect(entry.domain).toBe("tooling");
      expect(entry.error_code).toBe(DEFECT_ERROR_CODE);
      expect(entry.category).toBe("modularity_violation");
      expect(entry.status).toBe("resolved");
      expect(entry.severity).toBe("high");
      expect(entry.resolution?.verified).toBe(true);
    });
  });

  describe("Canonical Facade Re-export Integrity", () => {
    test("re-exported functions and values are directly accessible and operational", () => {
      // Command facade
      const id = commandId("test-task", 1);
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);

      expect(typeof MAX_COMMAND_ATTEMPT_BYTES).toBe("number");
      expect(typeof MAX_COMMAND_RECORD_BYTES).toBe("number");
      expect(typeof MAX_COMMAND_INTENT_BYTES).toBe("number");

      // Execution facade
      expect(isBroadScopeTest(["bun", "test"])).toBe(true);
      expect(isBroadScopeTest(["bun", "test", "my-file.test.ts"])).toBe(false);
    });
  });
});
