import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANONICAL_ANTI_MOCK_TYPES_FROM_ROOT,
  CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR,
  CANONICAL_ANTI_MOCK_TYPES_SUBPATH,
  DEFECT_REF,
  LEGACY_ANTI_MOCK_TYPES_IMPORT,
  LEGACY_ANTI_MOCK_TYPES_RELATIVE,
  STANDARD_VALIDATION_ANTI_MOCK_MODULES,
  UNRESOLVED_MODULE_IMPORT_IN_VALIDATION,
  ValidationAntiMockImportError,
  assertValidationAntiMockImportsPurity,
  auditValidationModuleTreeForAntiMockTypes,
  createValidationAntiMockDefectEntry,
  extractModuleImports,
  isLegacyAntiMockTypesImport,
  remediateValidationAntiMockImports,
  resolveAntiMockTypesImportPath,
  validateValidationAntiMockImports,
} from "../../../olt/scripts/src/validation/defect-validation-unresolved-anti-mock-types.ts";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = join(tmpdir(), `anti-mock-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

describe("Task 1.8: defect-validation-unresolved-anti-mock-types", () => {
  test("1. defect constants and error codes are correctly specified", () => {
    expect(DEFECT_REF).toBe("defect-validation-unresolved-anti-mock-types");
    expect(UNRESOLVED_MODULE_IMPORT_IN_VALIDATION).toBe("UNRESOLVED_MODULE_IMPORT_IN_VALIDATION");
    expect(CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR).toBe("../anti-mock/anti-mock-types.ts");
    expect(CANONICAL_ANTI_MOCK_TYPES_FROM_ROOT).toBe("./anti-mock/anti-mock-types.ts");
    expect(CANONICAL_ANTI_MOCK_TYPES_SUBPATH).toBe("anti-mock/anti-mock-types.ts");
    expect(LEGACY_ANTI_MOCK_TYPES_IMPORT).toBe("../anti-mock-types.ts");
    expect(LEGACY_ANTI_MOCK_TYPES_RELATIVE).toBe("./anti-mock-types.ts");
    expect(STANDARD_VALIDATION_ANTI_MOCK_MODULES.length).toBeGreaterThanOrEqual(10);
    expect(STANDARD_VALIDATION_ANTI_MOCK_MODULES).toContain("olt/scripts/src/validation/mutation-gate/types.ts");
  });

  test("2. ValidationAntiMockImportError instantiates with defaults and custom options", () => {
    const defaultErr = new ValidationAntiMockImportError("Unresolved import");
    expect(defaultErr).toBeInstanceOf(Error);
    expect(defaultErr).toBeInstanceOf(ValidationAntiMockImportError);
    expect(defaultErr.name).toBe("ValidationAntiMockImportError");
    expect(defaultErr.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_VALIDATION);
    expect(defaultErr.defectRef).toBe(DEFECT_REF);
    expect(defaultErr.issues).toEqual([]);

    const customErr = new ValidationAntiMockImportError("Custom error", {
      code: "CUSTOM_CODE",
      defectRef: "custom-ref",
      specifier: "../anti-mock-types.ts",
      filePath: "/src/validation/types.ts",
      issues: [{ code: "CUSTOM_CODE", message: "Failed import", specifier: "../anti-mock-types.ts" }],
    });
    expect(customErr.code).toBe("CUSTOM_CODE");
    expect(customErr.defectRef).toBe("custom-ref");
    expect(customErr.specifier).toBe("../anti-mock-types.ts");
    expect(customErr.filePath).toBe("/src/validation/types.ts");
    expect(customErr.issues.length).toBe(1);
  });

  test("3. extractModuleImports parses static, dynamic, multiline, and re-export specifiers", () => {
    const src = `
      import { MutantRecord } from "../anti-mock/anti-mock-types.ts";
      import type {
        AstLinterViolation,
      } from "./anti-mock/anti-mock-types.ts";
      export { evaluateAntiMock } from "./anti-mock-engine.ts";
      const dynamicMod = await import("../anti-mock-types.ts");
    `;
    const imports = extractModuleImports(src);
    expect(imports).toContain("../anti-mock/anti-mock-types.ts");
    expect(imports).toContain("./anti-mock/anti-mock-types.ts");
    expect(imports).toContain("./anti-mock-engine.ts");
    expect(imports).toContain("../anti-mock-types.ts");
    expect(imports.length).toBe(4);

    expect(extractModuleImports("")).toEqual([]);
    expect(extractModuleImports("// comment\nconst x = 1;")).toEqual([]);
  });

  test("4. isLegacyAntiMockTypesImport distinguishes legacy paths from canonical paths", () => {
    expect(isLegacyAntiMockTypesImport("../anti-mock-types.ts")).toBe(true);
    expect(isLegacyAntiMockTypesImport("./anti-mock-types.ts")).toBe(true);
    expect(isLegacyAntiMockTypesImport("../anti-mock-types")).toBe(true);
    expect(isLegacyAntiMockTypesImport("./anti-mock-types")).toBe(true);
    expect(isLegacyAntiMockTypesImport("anti-mock-types")).toBe(true);
    expect(isLegacyAntiMockTypesImport("anti-mock-types.ts")).toBe(true);

    expect(isLegacyAntiMockTypesImport("../anti-mock/anti-mock-types.ts")).toBe(false);
    expect(isLegacyAntiMockTypesImport("./anti-mock/anti-mock-types.ts")).toBe(false);
    expect(isLegacyAntiMockTypesImport("./anti-mock/index.ts")).toBe(false);
    expect(isLegacyAntiMockTypesImport("../mutation-gate/runner.ts")).toBe(false);
    expect(isLegacyAntiMockTypesImport("")).toBe(false);
    expect(isLegacyAntiMockTypesImport("   ")).toBe(false);
  });

  test("5. resolveAntiMockTypesImportPath resolves canonical paths based on depth context", () => {
    expect(resolveAntiMockTypesImportPath("../anti-mock-types.ts", true)).toBe(CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR);
    expect(resolveAntiMockTypesImportPath("../anti-mock-types.ts", false)).toBe(CANONICAL_ANTI_MOCK_TYPES_FROM_ROOT);
    expect(resolveAntiMockTypesImportPath("./anti-mock-types", false)).toBe(CANONICAL_ANTI_MOCK_TYPES_FROM_ROOT);
    expect(resolveAntiMockTypesImportPath(CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR, true)).toBe(CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR);
    expect(resolveAntiMockTypesImportPath("../other-module.ts", true)).toBe("../other-module.ts");
  });

  test("6. remediateValidationAntiMockImports rewrites legacy imports to canonical specifiers", () => {
    const subdirCode = `import type { MutantRecord } from "../anti-mock-types.ts";\nconst a = 1;`;
    const fixedSubdir = remediateValidationAntiMockImports(subdirCode, { isSubdirectory: true });
    expect(fixedSubdir).toContain(`from "${CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR}"`);
    expect(fixedSubdir).not.toContain('"../anti-mock-types.ts"');

    const rootCode = `import type { MutantRecord } from "./anti-mock-types.ts";`;
    const fixedRoot = remediateValidationAntiMockImports(rootCode, { isSubdirectory: false });
    expect(fixedRoot).toContain(`from "${CANONICAL_ANTI_MOCK_TYPES_FROM_ROOT}"`);

    const cleanCode = `import type { MutantRecord } from "${CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR}";`;
    expect(remediateValidationAntiMockImports(cleanCode)).toBe(cleanCode);
  });

  test("7. validateValidationAntiMockImports validates clean files and flags legacy imports", () => {
    const liveResult = validateValidationAntiMockImports();
    expect(liveResult.valid).toBe(true);
    expect(liveResult.defectRef).toBe(DEFECT_REF);
    expect(liveResult.legacyImportDetected).toBe(false);

    const corruptSrc = `import type { MutantRecord } from "../anti-mock-types.ts";`;
    const corruptResult = validateValidationAntiMockImports(corruptSrc, { isSubdirectory: true, filePath: "mutation-gate/types.ts" });
    expect(corruptResult.valid).toBe(false);
    expect(corruptResult.legacyImportDetected).toBe(true);
    expect(corruptResult.issues.length).toBe(1);
    expect(corruptResult.issues[0]?.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_VALIDATION);
    expect(corruptResult.issues[0]?.suggestedRemediation).toBe(CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR);

    const missingResult = validateValidationAntiMockImports("/nonexistent/file.ts");
    expect(missingResult.valid).toBe(false);
    expect(missingResult.issues[0]?.message).toContain("File not found");
  });

  test("8. assertValidationAntiMockImportsPurity validates pure source and throws on legacy imports", () => {
    const cleanSrc = `import type { MutantRecord } from "${CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR}";`;
    expect(() => assertValidationAntiMockImportsPurity(cleanSrc)).not.toThrow();

    const legacySrc = `import { MutantRecord } from "../anti-mock-types.ts";`;
    let caught: unknown;
    try {
      assertValidationAntiMockImportsPurity(legacySrc, { filePath: "test.ts" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationAntiMockImportError);
    if (caught instanceof ValidationAntiMockImportError) {
      expect(caught.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_VALIDATION);
      expect(caught.defectRef).toBe(DEFECT_REF);
      expect(caught.specifier).toBe("../anti-mock-types.ts");
      expect(caught.filePath).toBe("test.ts");
    }
  });

  test("9. auditValidationModuleTreeForAntiMockTypes audits directory tree and handles anomalies", () => {
    const treeAudit = auditValidationModuleTreeForAntiMockTypes();
    expect(treeAudit.defectRef).toBe(DEFECT_REF);
    expect(treeAudit.errorCode).toBe(UNRESOLVED_MODULE_IMPORT_IN_VALIDATION);
    expect(treeAudit.resolved).toBe(true);
    expect(treeAudit.totalFiles).toBeGreaterThan(5);
    expect(treeAudit.invalidFiles).toBe(0);
    expect(treeAudit.issues).toEqual([]);

    const tempDir = createTempDir();
    writeFileSync(join(tempDir, "clean.ts"), `import type { X } from "${CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR}";\n`, "utf-8");
    writeFileSync(join(tempDir, "legacy.ts"), `import type { X } from "../anti-mock-types.ts";\n`, "utf-8");

    const tempAudit = auditValidationModuleTreeForAntiMockTypes(tempDir);
    expect(tempAudit.resolved).toBe(false);
    expect(tempAudit.totalFiles).toBe(2);
    expect(tempAudit.validFiles).toBe(1);
    expect(tempAudit.invalidFiles).toBe(1);
    expect(tempAudit.issues.length).toBe(1);
  });

  test("10. createValidationAntiMockDefectEntry builds compliant DefectEntry contract", () => {
    const entry = createValidationAntiMockDefectEntry({
      filePath: "olt/scripts/src/validation/mutation-gate/types.ts",
      issues: [{ code: UNRESOLVED_MODULE_IMPORT_IN_VALIDATION, message: "Unresolved import", specifier: "../anti-mock-types.ts" }],
    });
    expect(entry.id).toContain(DEFECT_REF);
    expect(entry.domain).toBe("validation-modularization");
    expect(entry.error_code).toBe(UNRESOLVED_MODULE_IMPORT_IN_VALIDATION);
    expect(entry.status).toBe("open");
    expect(entry.type).toBe("MODULARITY_VIOLATION");
    expect(entry.category).toBe("modularity_violation");
    expect(entry.severity).toBe("high");
    expect(entry.context?.file).toBe("olt/scripts/src/validation/mutation-gate/types.ts");
    expect(entry.context?.defectReference).toBe(DEFECT_REF);
  });

  test("11. verifies zero TypeScript any and zero compiler suppressions across write scope", () => {
    const filesToAudit = [
      join(process.cwd(), "olt/scripts/src/validation/defect-validation-unresolved-anti-mock-types.ts"),
      join(process.cwd(), "tests/unit/validation/defect-validation-unresolved-anti-mock-types.test.ts"),
    ];
    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(["@ts" + "-ignore", "@ts" + "-expect-error", "@ts" + "-nocheck"].join("|"));

    for (const fp of filesToAudit) {
      expect(existsSync(fp)).toBe(true);
      const content = readFileSync(fp, "utf-8");
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
