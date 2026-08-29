import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertValidWorkflowIntegrityImports,
  auditWorkflowIntegrityModuleGraph,
  CANONICAL_STORE_BARREL_PATH,
  CANONICAL_STORE_BARREL_SPECIFIER_FROM_WORKFLOW,
  CANONICAL_STORE_INTEGRITY_BARREL_PATH,
  CANONICAL_STORE_INTEGRITY_SPECIFIER_FROM_WORKFLOW,
  CANONICAL_WORKFLOW_INTEGRITY_EVIDENCE_PATH,
  CANONICAL_WORKFLOW_INTEGRITY_SYMBOLS,
  classifyStoreImport,
  createWorkflowIntegrityDefectEntry,
  createWorkflowIntegrityDefectProof,
  DEFECT_ERROR_CODE,
  DEFECT_REF,
  ERROR_CODE,
  extractImportEntries,
  extractModuleImports,
  INVARIANT_DESCRIPTION,
  INVARIANT_NUMBER,
  INVARIANT_REF,
  isCanonicalStoreImport,
  isCapsuleIntegrityEvidence,
  isLegacyStoreImport,
  LEGACY_STORE_IMPORT_PATTERNS,
  LEGACY_STORE_INTEGRITY_SPECIFIER,
  observeCapsuleIntegrity,
  remediateWorkflowIntegrityImports,
  remediateWorkflowIntegrityImportsWithReport,
  resolveStoreIntegrityImportPath,
  UNRESOLVED_MODULE_IMPORT_IN_WORKFLOW,
  UnresolvedWorkflowStoreImportError,
  validateWorkflowIntegrityImports,
  verifyCapsuleDeep,
  verifyIntegrity,
  verifyWorkflowIntegrityStoreResolution,
  WorkflowImportResolutionError,
  WorkflowIntegrityImportError,
} from "../../../olt/scripts/src/tooling/defect-workflow-integrity-evidence-unresolved-store-import.ts";

const tempDirs: string[] = [];

function createTempDir(prefix = "workflow-integrity-test-"): string {
  const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
  tempDirs.length = 0;
});

describe("Task 1.6: Defect Remediation - Unresolved store import in workflow completion integrity evidence", () => {
  describe("1. Defect Metadata, Constants & Canonical Path Contracts", () => {
    test("defect identifiers and error codes match architectural specifications", () => {
      expect(DEFECT_REF).toBe("defect-workflow-integrity-evidence-unresolved-store-import");
      expect(DEFECT_ERROR_CODE).toBe("UNRESOLVED_MODULE_IMPORT_IN_WORKFLOW");
      expect(ERROR_CODE).toBe("UNRESOLVED_MODULE_IMPORT_IN_WORKFLOW");
      expect(UNRESOLVED_MODULE_IMPORT_IN_WORKFLOW).toBe("UNRESOLVED_MODULE_IMPORT_IN_WORKFLOW");
      expect(INVARIANT_NUMBER).toBe(6);
      expect(INVARIANT_REF).toBe("Invariant 1.6");
      expect(INVARIANT_DESCRIPTION).toContain("integrity-evidence.ts");
    });

    test("canonical paths and specifiers are accurately declared", () => {
      expect(CANONICAL_WORKFLOW_INTEGRITY_EVIDENCE_PATH).toBe(
        "olt/scripts/src/workflow/completion/integrity-evidence.ts",
      );
      expect(CANONICAL_STORE_BARREL_PATH).toBe("olt/scripts/src/engine/store/index.ts");
      expect(CANONICAL_STORE_INTEGRITY_BARREL_PATH).toBe(
        "olt/scripts/src/engine/store/integrity/integrity.ts",
      );
      expect(CANONICAL_STORE_BARREL_SPECIFIER_FROM_WORKFLOW).toBe("../../engine/store/index.ts");
      expect(CANONICAL_STORE_INTEGRITY_SPECIFIER_FROM_WORKFLOW).toBe(
        "../../engine/store/integrity/integrity.ts",
      );
      expect(LEGACY_STORE_INTEGRITY_SPECIFIER).toBe("../../engine/store/integrity.ts");
    });

    test("frozen catalog of legacy patterns and workflow integrity symbols are non-empty", () => {
      expect(Object.isFrozen(LEGACY_STORE_IMPORT_PATTERNS)).toBe(true);
      expect(LEGACY_STORE_IMPORT_PATTERNS).toContain("../../engine/store/integrity.ts");
      expect(LEGACY_STORE_IMPORT_PATTERNS).toContain("./integrity.ts");
      expect(LEGACY_STORE_IMPORT_PATTERNS).toContain("engine/store/integrity.ts");

      expect(Object.isFrozen(CANONICAL_WORKFLOW_INTEGRITY_SYMBOLS)).toBe(true);
      expect(CANONICAL_WORKFLOW_INTEGRITY_SYMBOLS).toContain("verifyIntegrity");
      expect(CANONICAL_WORKFLOW_INTEGRITY_SYMBOLS).toContain("verifyCapsuleDeep");
      expect(CANONICAL_WORKFLOW_INTEGRITY_SYMBOLS).toContain("observeCapsuleIntegrity");
      expect(CANONICAL_WORKFLOW_INTEGRITY_SYMBOLS).toContain("CapsuleIntegrityEvidence");
    });
  });

  describe("2. Custom Error Classes & Error Invariants", () => {
    test("WorkflowImportResolutionError instantiates with defaults and proper prototype chain", () => {
      const defaultErr = new WorkflowImportResolutionError("Default import failure");
      expect(defaultErr).toBeInstanceOf(Error);
      expect(defaultErr).toBeInstanceOf(WorkflowImportResolutionError);
      expect(defaultErr.name).toBe("WorkflowImportResolutionError");
      expect(defaultErr.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_WORKFLOW);
      expect(defaultErr.defectRef).toBe(DEFECT_REF);
      expect(defaultErr.issues).toEqual([]);
      expect(defaultErr.specifier).toBeUndefined();
      expect(defaultErr.filePath).toBeUndefined();
    });

    test("WorkflowImportResolutionError retains custom options and metadata", () => {
      const customErr = new WorkflowImportResolutionError("Detailed failure", {
        code: "CUSTOM_WORKFLOW_ERR",
        defectRef: "custom-ref-456",
        specifier: "../../engine/store/integrity.ts",
        filePath: "/path/to/workflow/completion/integrity-evidence.ts",
        issues: [
          {
            code: "CUSTOM_WORKFLOW_ERR",
            message: "Legacy store import detected",
            specifier: "../../engine/store/integrity.ts",
            filePath: "/path/to/workflow/completion/integrity-evidence.ts",
            line: 3,
            suggestedRemediation: "../../engine/store/integrity/integrity.ts",
          },
        ],
      });

      expect(customErr.code).toBe("CUSTOM_WORKFLOW_ERR");
      expect(customErr.defectRef).toBe("custom-ref-456");
      expect(customErr.specifier).toBe("../../engine/store/integrity.ts");
      expect(customErr.filePath).toBe("/path/to/workflow/completion/integrity-evidence.ts");
      expect(customErr.issues.length).toBe(1);
      expect(customErr.issues[0]?.line).toBe(3);
    });

    test("aliases point to the same constructor", () => {
      expect(WorkflowIntegrityImportError).toBe(WorkflowImportResolutionError);
      expect(UnresolvedWorkflowStoreImportError).toBe(WorkflowImportResolutionError);
      const aliasErr = new WorkflowIntegrityImportError("Via alias");
      expect(aliasErr).toBeInstanceOf(WorkflowImportResolutionError);
    });
  });

  describe("3. AST Extraction & Import Parsing", () => {
    test("extractModuleImports extracts all static, multiline, dynamic, and re-export specifiers", () => {
      const source = `
        import type { EvidenceClass, JsonObject } from "../../core/contracts/index.ts";
        import {
          verifyIntegrity,
          verifyCapsuleDeep,
        } from "../../engine/store/integrity/integrity.ts";
        import * as Store from "../../engine/store/index.ts";
        import "./side-effects.ts";
        export { observeCapsuleIntegrity } from "./integrity-evidence.ts";

        async function lazyLoad() {
          const mod = await import("../../engine/store/dynamic.ts");
        }
      `;

      const imports = extractModuleImports(source);
      expect(imports).toContain("../../core/contracts/index.ts");
      expect(imports).toContain("../../engine/store/integrity/integrity.ts");
      expect(imports).toContain("../../engine/store/index.ts");
      expect(imports).toContain("./side-effects.ts");
      expect(imports).toContain("./integrity-evidence.ts");
      expect(imports).toContain("../../engine/store/dynamic.ts");
      expect(imports.length).toBe(6);
    });

    test("extractModuleImports handles blank source and pure comments", () => {
      expect(extractModuleImports("")).toEqual([]);
      expect(extractModuleImports("// comment only\nconst val = 42;")).toEqual([]);
    });

    test("extractImportEntries parses detailed AST entries with line numbers and symbols", () => {
      const source = [
        'import type { EvidenceClass } from "../../core/contracts/index.ts";',
        'import { verifyIntegrity } from "../../engine/store/integrity/integrity.ts";',
        'import * as Store from "./store.ts";',
        'import DefaultRunner from "./runner.ts";',
        'export { observeCapsuleIntegrity } from "./integrity-evidence.ts";',
        'const dyn = await import("./async-store.ts");',
      ].join("\n");

      const entries = extractImportEntries(source);
      expect(entries.length).toBe(6);

      const typeEntry = entries.find((e) => e.specifier === "../../core/contracts/index.ts");
      expect(typeEntry).toBeDefined();
      expect(typeEntry?.isTypeOnly).toBe(true);
      expect(typeEntry?.namedSymbols).toContain("EvidenceClass");
      expect(typeEntry?.line).toBe(1);

      const integrityEntry = entries.find(
        (e) => e.specifier === "../../engine/store/integrity/integrity.ts",
      );
      expect(integrityEntry).toBeDefined();
      expect(integrityEntry?.isTypeOnly).toBe(false);
      expect(integrityEntry?.namedSymbols).toContain("verifyIntegrity");
      expect(integrityEntry?.line).toBe(2);

      const nsEntry = entries.find((e) => e.specifier === "./store.ts");
      expect(nsEntry?.namespaceImport).toBe("Store");

      const defEntry = entries.find((e) => e.specifier === "./runner.ts");
      expect(defEntry?.defaultImport).toBe("DefaultRunner");

      const exportEntry = entries.find((e) => e.specifier === "./integrity-evidence.ts");
      expect(exportEntry?.isReExport).toBe(true);

      const dynEntry = entries.find((e) => e.specifier === "./async-store.ts");
      expect(dynEntry?.isDynamic).toBe(true);
    });
  });

  describe("4. Classification & Predicates", () => {
    test("isLegacyStoreImport accurately detects legacy specifiers", () => {
      expect(isLegacyStoreImport("../../engine/store/integrity.ts")).toBe(true);
      expect(isLegacyStoreImport("../../engine/store/integrity")).toBe(true);
      expect(isLegacyStoreImport("../engine/store/integrity.ts")).toBe(true);
      expect(isLegacyStoreImport("./engine/store/integrity.ts")).toBe(true);
      expect(isLegacyStoreImport("engine/store/integrity.ts")).toBe(true);
      expect(isLegacyStoreImport("../../store/integrity.ts")).toBe(true);
      expect(isLegacyStoreImport("../store/integrity.ts")).toBe(true);
      expect(isLegacyStoreImport("./integrity.ts")).toBe(true);
      expect(isLegacyStoreImport("../integrity.ts")).toBe(true);
      expect(isLegacyStoreImport("../integrity")).toBe(true);
      expect(isLegacyStoreImport("../../engine/store/store.ts")).toBe(true);
      expect(isLegacyStoreImport("../../engine/store/capsule-integrity.ts")).toBe(true);

      // Should not flag canonical barrels or other modules
      expect(isLegacyStoreImport("../../engine/store/index.ts")).toBe(false);
      expect(isLegacyStoreImport("../../engine/store/integrity/integrity.ts")).toBe(false);
      expect(isLegacyStoreImport("../../engine/store/integrity/layout-integrity.ts")).toBe(false);
      expect(isLegacyStoreImport("./integrity/integrity.ts")).toBe(false);
      expect(
        isLegacyStoreImport(
          "./integrity.ts",
          "olt/scripts/src/engine/store/integrity/layout-integrity.ts",
        ),
      ).toBe(false);
      expect(isLegacyStoreImport("node:fs")).toBe(false);
      expect(isLegacyStoreImport("")).toBe(false);
      expect(isLegacyStoreImport("   ")).toBe(false);
    });

    test("isCanonicalStoreImport identifies canonical store import specifiers", () => {
      expect(isCanonicalStoreImport("../../engine/store/index.ts")).toBe(true);
      expect(isCanonicalStoreImport("../../engine/store/integrity/integrity.ts")).toBe(true);
      expect(isCanonicalStoreImport("./index.ts")).toBe(true);
      expect(isCanonicalStoreImport("./integrity/integrity.ts")).toBe(true);

      expect(isCanonicalStoreImport("../../engine/store/integrity.ts")).toBe(false);
      expect(isCanonicalStoreImport("")).toBe(false);
    });

    test("resolveStoreIntegrityImportPath resolves appropriate canonical target based on caller location", () => {
      expect(
        resolveStoreIntegrityImportPath(
          "../../engine/store/integrity.ts",
          "olt/scripts/src/workflow/completion/integrity-evidence.ts",
        ),
      ).toBe(CANONICAL_STORE_INTEGRITY_SPECIFIER_FROM_WORKFLOW);

      expect(
        resolveStoreIntegrityImportPath(
          "../integrity.ts",
          "olt/scripts/src/engine/store/integrity/layout-integrity.ts",
        ),
      ).toBe("./integrity.ts");

      expect(
        resolveStoreIntegrityImportPath("./integrity.ts", "olt/scripts/src/engine/store/index.ts"),
      ).toBe("./integrity/integrity.ts");

      // Non-legacy paths are preserved untouched
      expect(resolveStoreIntegrityImportPath("../../engine/store/index.ts")).toBe(
        "../../engine/store/index.ts",
      );
    });

    test("classifyStoreImport provides full classification metadata", () => {
      const legacyClass = classifyStoreImport("../../engine/store/integrity.ts");
      expect(legacyClass.isLegacy).toBe(true);
      expect(legacyClass.isCanonical).toBe(false);
      expect(legacyClass.resolvedSpecifier).toBe(CANONICAL_STORE_INTEGRITY_SPECIFIER_FROM_WORKFLOW);

      const canonicalClass = classifyStoreImport("../../engine/store/integrity/integrity.ts");
      expect(canonicalClass.isLegacy).toBe(false);
      expect(canonicalClass.isCanonical).toBe(true);
      expect(canonicalClass.isStoreBarrel).toBe(false);

      const storeBarrelClass = classifyStoreImport("../../engine/store/index.ts");
      expect(storeBarrelClass.isCanonical).toBe(true);
      expect(storeBarrelClass.isStoreBarrel).toBe(true);
    });
  });

  describe("5. Source Code Remediation & Diagnostics", () => {
    test("remediateWorkflowIntegrityImports rewrites legacy imports to canonical barrel imports", () => {
      const corrupted = `
import type { EvidenceClass, JsonObject } from "../../core/contracts/index.ts";
import { verifyIntegrity } from "../../engine/store/integrity.ts";

export interface CapsuleIntegrityEvidence extends JsonObject {
  kind: "capsule_integrity";
}
`;

      const remediated = remediateWorkflowIntegrityImports(corrupted, {
        fromFilePath: "olt/scripts/src/workflow/completion/integrity-evidence.ts",
      });

      expect(remediated).toContain(`from "${CANONICAL_STORE_INTEGRITY_SPECIFIER_FROM_WORKFLOW}";`);
      expect(remediated).not.toContain("../../engine/store/integrity.ts");
      expect(remediated).toContain(
        `import type { EvidenceClass, JsonObject } from "../../core/contracts/index.ts";`,
      );
    });

    test("remediateWorkflowIntegrityImportsWithReport outputs replacement metrics and status", () => {
      const source = `
import { a } from "../../engine/store/integrity.ts";
import { b } from "../engine/store/integrity.ts";
`;
      const report = remediateWorkflowIntegrityImportsWithReport(source);
      expect(report.defectRef).toBe(DEFECT_REF);
      expect(report.success).toBe(true);
      expect(report.replacementsCount).toBe(2);
      expect(report.remediatedSource).toContain(CANONICAL_STORE_INTEGRITY_SPECIFIER_FROM_WORKFLOW);
    });

    test("remediateWorkflowIntegrityImports leaves clean code unchanged", () => {
      const clean = `import { verifyIntegrity } from "${CANONICAL_STORE_INTEGRITY_SPECIFIER_FROM_WORKFLOW}";`;
      expect(remediateWorkflowIntegrityImports(clean)).toBe(clean);
    });
  });

  describe("6. Validation & Assertions", () => {
    test("validateWorkflowIntegrityImports validates the live integrity-evidence.ts file cleanly", () => {
      const result = validateWorkflowIntegrityImports();
      expect(result.defectRef).toBe(DEFECT_REF);
      expect(result.valid).toBe(true);
      expect(result.legacyImportDetected).toBe(false);
      expect(result.canonicalImportPresent).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.imports).toContain(CANONICAL_STORE_INTEGRITY_SPECIFIER_FROM_WORKFLOW);
    });

    test("validateWorkflowIntegrityImports flags legacy imports in corrupted snippet", () => {
      const corruptedSnippet = `import { verifyIntegrity } from "../../engine/store/integrity.ts";`;
      const result = validateWorkflowIntegrityImports(corruptedSnippet, {
        filePath: "olt/scripts/src/workflow/completion/integrity-evidence.ts",
      });

      expect(result.valid).toBe(false);
      expect(result.legacyImportDetected).toBe(true);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0]?.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_WORKFLOW);
      expect(result.issues[0]?.suggestedRemediation).toBe(
        CANONICAL_STORE_INTEGRITY_SPECIFIER_FROM_WORKFLOW,
      );
    });

    test("validateWorkflowIntegrityImports reports issue for missing file", () => {
      const result = validateWorkflowIntegrityImports("/non/existent/integrity-evidence.ts");
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0]?.message).toContain("File not found");
    });

    test("assertValidWorkflowIntegrityImports succeeds on live file and throws on corrupted code", () => {
      expect(() => assertValidWorkflowIntegrityImports()).not.toThrow();

      const corrupted = `import { verifyIntegrity } from "../../engine/store/integrity.ts";`;
      let caught: unknown;
      try {
        assertValidWorkflowIntegrityImports(corrupted, { filePath: "integrity-evidence.ts" });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(WorkflowImportResolutionError);
      if (caught instanceof WorkflowImportResolutionError) {
        expect(caught.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_WORKFLOW);
        expect(caught.defectRef).toBe(DEFECT_REF);
        expect(caught.specifier).toBe("../../engine/store/integrity.ts");
      }
    });
  });

  describe("7. Directory Audits & Multi-File Verification", () => {
    test("auditWorkflowIntegrityModuleGraph audits live workflow completion directory", () => {
      const audit = auditWorkflowIntegrityModuleGraph();
      expect(audit.defectRef).toBe(DEFECT_REF);
      expect(audit.errorCode).toBe(UNRESOLVED_MODULE_IMPORT_IN_WORKFLOW);
      expect(audit.resolved).toBe(true);
      expect(audit.totalFilesScanned).toBeGreaterThanOrEqual(10);
      expect(audit.invalidFilesCount).toBe(0);
      expect(audit.issues).toEqual([]);
    });

    test("auditWorkflowIntegrityModuleGraph catches corrupted fixture in temporary directory", () => {
      const tempDir = createTempDir();
      writeFileSync(
        join(tempDir, "clean.ts"),
        `import { verifyIntegrity } from "../../engine/store/integrity/integrity.ts";`,
        "utf-8",
      );
      writeFileSync(
        join(tempDir, "corrupted.ts"),
        `import { verifyIntegrity } from "../../engine/store/integrity.ts";`,
        "utf-8",
      );

      const audit = auditWorkflowIntegrityModuleGraph(tempDir);
      expect(audit.resolved).toBe(false);
      expect(audit.totalFilesScanned).toBe(2);
      expect(audit.validFilesCount).toBe(1);
      expect(audit.invalidFilesCount).toBe(1);
      expect(audit.issues.length).toBe(1);
    });
  });

  describe("8. Type Guards & Contract Predicates", () => {
    test("isCapsuleIntegrityEvidence validates conforming CapsuleIntegrityEvidence objects", () => {
      const validEvidence = {
        kind: "capsule_integrity",
        status: "passed",
        evidence_class: "harness_observed",
        event_head: "abc123def456",
        issues: [],
      };
      expect(isCapsuleIntegrityEvidence(validEvidence)).toBe(true);

      const failedEvidence = {
        kind: "capsule_integrity",
        status: "failed",
        evidence_class: "harness_observed",
        event_head: null,
        issues: [{ code: "RUN_ROOT", message: "Directory missing" }],
      };
      expect(isCapsuleIntegrityEvidence(failedEvidence)).toBe(true);
    });

    test("isCapsuleIntegrityEvidence rejects non-conforming objects", () => {
      expect(isCapsuleIntegrityEvidence(null)).toBe(false);
      expect(isCapsuleIntegrityEvidence(undefined)).toBe(false);
      expect(isCapsuleIntegrityEvidence("string")).toBe(false);
      expect(isCapsuleIntegrityEvidence({})).toBe(false);
      expect(
        isCapsuleIntegrityEvidence({
          kind: "wrong_kind",
          status: "passed",
          evidence_class: "harness_observed",
          event_head: null,
          issues: [],
        }),
      ).toBe(false);
      expect(
        isCapsuleIntegrityEvidence({
          kind: "capsule_integrity",
          status: "unknown_status",
          evidence_class: "harness_observed",
          event_head: null,
          issues: [],
        }),
      ).toBe(false);
      expect(
        isCapsuleIntegrityEvidence({
          kind: "capsule_integrity",
          status: "passed",
          evidence_class: "",
          event_head: null,
          issues: [],
        }),
      ).toBe(false);
      expect(
        isCapsuleIntegrityEvidence({
          kind: "capsule_integrity",
          status: "passed",
          evidence_class: "harness_observed",
          event_head: 123,
          issues: [],
        }),
      ).toBe(false);
      expect(
        isCapsuleIntegrityEvidence({
          kind: "capsule_integrity",
          status: "passed",
          evidence_class: "harness_observed",
          event_head: null,
          issues: "not-an-array",
        }),
      ).toBe(false);
      expect(
        isCapsuleIntegrityEvidence({
          kind: "capsule_integrity",
          status: "passed",
          evidence_class: "harness_observed",
          event_head: null,
          issues: [{ code: 123, message: "bad code" }],
        }),
      ).toBe(false);
    });
  });

  describe("9. Defect Entry, Resolution Proof & Live System Integrity", () => {
    test("createWorkflowIntegrityDefectProof builds valid resolution proof contract", () => {
      const proof = createWorkflowIntegrityDefectProof();
      expect(proof.task_id).toContain(DEFECT_REF);
      expect(proof.verified).toBe(true);
      expect(proof.empirical_command).toContain(
        "bun test tests/unit/tooling/defect-workflow-integrity-evidence-unresolved-store-import.test.ts",
      );
      expect(proof.explanation).toContain("remediated unresolved store imports");
    });

    test("createWorkflowIntegrityDefectEntry builds compliant DefectEntry contract", () => {
      const entry = createWorkflowIntegrityDefectEntry();
      expect(entry.id).toContain(DEFECT_REF);
      expect(entry.domain).toBe("tooling");
      expect(entry.error_code).toBe(UNRESOLVED_MODULE_IMPORT_IN_WORKFLOW);
      expect(entry.status).toBe("resolved");
      expect(entry.type).toBe("CODE_HEALTH");
      expect(entry.category).toBe("modularity_violation");
      expect(entry.severity).toBe("high");
      expect(entry.resolution?.verified).toBe(true);
    });

    test("verifyWorkflowIntegrityStoreResolution verifies live subsystem health and execution readiness", async () => {
      const integrity = await verifyWorkflowIntegrityStoreResolution();
      expect(integrity.verified).toBe(true);
      expect(integrity.integrityEvidenceExists).toBe(true);
      expect(integrity.storeBarrelExists).toBe(true);
      expect(integrity.storeIntegrityBarrelExists).toBe(true);
      expect(integrity.verifyIntegrityCallable).toBe(true);
      expect(integrity.verifyCapsuleDeepCallable).toBe(true);
      expect(integrity.observeCapsuleIntegrityCallable).toBe(true);
    });
  });

  describe("10. Functional Facade Re-exports", () => {
    test("re-exported store integrity functions are callable and functional", () => {
      const nonExistentDir = "/non/existent/test/capsule/dir";
      const issues = verifyIntegrity(nonExistentDir);
      expect(Array.isArray(issues)).toBe(true);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.code).toBe("RUN_ROOT");

      const deepIssues = verifyCapsuleDeep(nonExistentDir);
      expect(Array.isArray(deepIssues)).toBe(true);

      const evidence = observeCapsuleIntegrity(nonExistentDir, "head-123");
      expect(isCapsuleIntegrityEvidence(evidence)).toBe(true);
      expect(evidence.kind).toBe("capsule_integrity");
      expect(evidence.status).toBe("failed");
      expect(evidence.event_head).toBe("head-123");
      expect(evidence.issues.length).toBeGreaterThan(0);
    });
  });

  describe("11. Zero TypeScript any and Zero Compiler Suppressions Across Write Scope", () => {
    test("verifies zero TypeScript any and zero compiler suppressions across implementation and test files", () => {
      const filesToAudit = [
        join(
          process.cwd(),
          "olt/scripts/src/tooling/defect-workflow-integrity-evidence-unresolved-store-import.ts",
        ),
        join(
          process.cwd(),
          "tests/unit/tooling/defect-workflow-integrity-evidence-unresolved-store-import.test.ts",
        ),
      ];

      const anyRegex = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
      const suppressionRegex = new RegExp(
        ["@ts" + "-ignore", "@ts" + "-expect-error", "@ts" + "-nocheck"].join("|"),
      );

      for (const filePath of filesToAudit) {
        expect(existsSync(filePath)).toBe(true);
        const fileContent = readFileSync(filePath, "utf-8");
        const lines = fileContent.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          // Skip regex definition lines in the test itself
          if (line.includes("anyRegex") || line.includes("suppressionRegex")) {
            continue;
          }

          expect(anyRegex.test(line)).toBe(false);
          expect(suppressionRegex.test(line)).toBe(false);
        }
      }
    });
  });
});
