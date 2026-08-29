import { describe, expect, test } from "bun:test";
import {
  assertValidCliDiagnosticsImports,
  auditCliRegistryModuleGraph,
  CANONICAL_CERTIFY_IMPORT_PATH,
  CANONICAL_CERTIFY_MODULE_SUBPATH,
  CliImportResolutionError,
  DEFECT_REF,
  extractModuleImports,
  isLegacyCertifyCommandImport,
  LEGACY_CERTIFY_IMPORT_PATH,
  LEGACY_CERTIFY_MODULE_SUBPATH,
  remediateCliDiagnosticsImports,
  resolveCertifyCommandImportPath,
  UNRESOLVED_MODULE_IMPORT_IN_CLI,
  validateCliDiagnosticsImports,
} from "../../../olt/scripts/src/validation/defect-cli-diagnostics-unresolved-certify-import.ts";

describe("Task 1.2: defect-cli-diagnostics-unresolved-certify-import", () => {
  test("1. defect constants and error codes are correctly specified", () => {
    expect(DEFECT_REF).toBe("defect-cli-diagnostics-unresolved-certify-import");
    expect(UNRESOLVED_MODULE_IMPORT_IN_CLI).toBe("UNRESOLVED_MODULE_IMPORT_IN_CLI");
    expect(CANONICAL_CERTIFY_IMPORT_PATH).toBe("../../reporting/doctor/certify-command.ts");
    expect(CANONICAL_CERTIFY_MODULE_SUBPATH).toBe("reporting/doctor/certify-command.ts");
    expect(LEGACY_CERTIFY_MODULE_SUBPATH).toBe("reporting/core/certify-command");
    expect(LEGACY_CERTIFY_IMPORT_PATH).toBe("../../reporting/core/certify-command.ts");
  });

  test("2. CliImportResolutionError instantiates with default code and defectRef", () => {
    const error = new CliImportResolutionError("Module failed to resolve");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CliImportResolutionError);
    expect(error.name).toBe("CliImportResolutionError");
    expect(error.message).toBe("Module failed to resolve");
    expect(error.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_CLI);
    expect(error.defectRef).toBe(DEFECT_REF);
    expect(error.specifier).toBeUndefined();
    expect(error.filePath).toBeUndefined();
  });

  test("3. CliImportResolutionError preserves custom options (specifier, filePath, custom code)", () => {
    const error = new CliImportResolutionError("Custom resolution failure", {
      code: "CUSTOM_CLI_ERR",
      defectRef: "custom-defect-ref",
      specifier: "../../reporting/core/certify-command",
      filePath: "/path/to/diagnostics.ts",
    });
    expect(error.code).toBe("CUSTOM_CLI_ERR");
    expect(error.defectRef).toBe("custom-defect-ref");
    expect(error.specifier).toBe("../../reporting/core/certify-command");
    expect(error.filePath).toBe("/path/to/diagnostics.ts");
  });

  test("4. extractModuleImports parses single-line, multiline, static, and dynamic imports accurately", () => {
    const source = `
      import { defectAuditCommand } from "../commands/defect-audit.ts";
      import {
        doctorCommand,
        healthCommand,
      } from "../commands/diagnostics-ops.ts";
      import { doctorCertifyCommand } from "../../reporting/doctor/certify-command.ts";
      import "./side-effect.ts";
      export { someUtil } from "./util.ts";

      async function run() {
        const mod = await import("../commands/meta-audit.ts");
      }
    `;
    const imports = extractModuleImports(source);
    expect(imports).toContain("../commands/defect-audit.ts");
    expect(imports).toContain("../commands/diagnostics-ops.ts");
    expect(imports).toContain("../../reporting/doctor/certify-command.ts");
    expect(imports).toContain("./side-effect.ts");
    expect(imports).toContain("./util.ts");
    expect(imports).toContain("../commands/meta-audit.ts");
    expect(imports.length).toBe(6);
  });

  test("5. extractModuleImports returns empty array on empty source or source without imports", () => {
    expect(extractModuleImports("")).toEqual([]);
    expect(extractModuleImports("// comment only\nconst x = 42;\nconsole.log(x);")).toEqual([]);
  });

  test("6. isLegacyCertifyCommandImport correctly identifies legacy certify import variants", () => {
    expect(isLegacyCertifyCommandImport("../../reporting/core/certify-command")).toBe(true);
    expect(isLegacyCertifyCommandImport("../../reporting/core/certify-command.ts")).toBe(true);
    expect(isLegacyCertifyCommandImport("reporting/core/certify-command")).toBe(true);
    expect(isLegacyCertifyCommandImport("reporting/core/certify-command.ts")).toBe(true);
    expect(isLegacyCertifyCommandImport("../reporting/core/certify-command")).toBe(true);
    expect(isLegacyCertifyCommandImport("./reporting/core/certify-command")).toBe(true);
  });

  test("7. isLegacyCertifyCommandImport returns false for canonical paths, unrelated modules, and empty input", () => {
    expect(isLegacyCertifyCommandImport("../../reporting/doctor/certify-command.ts")).toBe(false);
    expect(isLegacyCertifyCommandImport("reporting/doctor/certify-command.ts")).toBe(false);
    expect(isLegacyCertifyCommandImport("../commands/defect-audit.ts")).toBe(false);
    expect(isLegacyCertifyCommandImport("")).toBe(false);
    expect(isLegacyCertifyCommandImport("   ")).toBe(false);
  });

  test("8. resolveCertifyCommandImportPath transforms legacy paths to canonical paths", () => {
    expect(resolveCertifyCommandImportPath("../../reporting/core/certify-command")).toBe(
      CANONICAL_CERTIFY_IMPORT_PATH,
    );
    expect(resolveCertifyCommandImportPath("../../reporting/core/certify-command.ts")).toBe(
      CANONICAL_CERTIFY_IMPORT_PATH,
    );
    expect(resolveCertifyCommandImportPath("reporting/core/certify-command")).toBe(
      CANONICAL_CERTIFY_MODULE_SUBPATH,
    );
  });

  test("9. resolveCertifyCommandImportPath retains already canonical and unrelated import paths", () => {
    expect(resolveCertifyCommandImportPath(CANONICAL_CERTIFY_IMPORT_PATH)).toBe(
      CANONICAL_CERTIFY_IMPORT_PATH,
    );
    expect(resolveCertifyCommandImportPath("../commands/defect-audit.ts")).toBe(
      "../commands/defect-audit.ts",
    );
  });

  test("10. remediateCliDiagnosticsImports rewrites legacy import paths across source code content", () => {
    const legacySource = `import { doctorCertifyCommand } from "../../reporting/core/certify-command";`;
    const remediated = remediateCliDiagnosticsImports(legacySource);
    expect(remediated).toBe(
      `import { doctorCertifyCommand } from "${CANONICAL_CERTIFY_IMPORT_PATH}";`,
    );

    const legacyWithTsExt = `import { doctorCertifyCommand } from "../../reporting/core/certify-command.ts";`;
    const remediatedWithTs = remediateCliDiagnosticsImports(legacyWithTsExt);
    expect(remediatedWithTs).toBe(
      `import { doctorCertifyCommand } from "${CANONICAL_CERTIFY_IMPORT_PATH}";`,
    );
  });

  test("11. validateCliDiagnosticsImports validates current codebase diagnostics.ts successfully", () => {
    const result = validateCliDiagnosticsImports();
    expect(result.valid).toBe(true);
    expect(result.defectRef).toBe(DEFECT_REF);
    expect(result.legacyImportDetected).toBe(false);
    expect(result.canonicalImportPresent).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.imports).toContain(CANONICAL_CERTIFY_IMPORT_PATH);
  });

  test("12. validateCliDiagnosticsImports detects legacy imports and reports validation issues for corrupted content", () => {
    const corruptedSnippet = `import { doctorCertifyCommand } from "../../reporting/core/certify-command";`;
    const result = validateCliDiagnosticsImports(corruptedSnippet);
    expect(result.valid).toBe(false);
    expect(result.legacyImportDetected).toBe(true);
    expect(result.canonicalImportPresent).toBe(false);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0]).toContain("Unresolved legacy certify-command import");

    const nonExistentResult = validateCliDiagnosticsImports("/nonexistent/diagnostics.ts");
    expect(nonExistentResult.valid).toBe(false);
    expect(nonExistentResult.issues[0]).toContain("File not found");
  });

  test("13. assertValidCliDiagnosticsImports succeeds on canonical source and throws CliImportResolutionError on legacy imports", () => {
    expect(() => assertValidCliDiagnosticsImports()).not.toThrow();

    const legacySnippet = `import { doctorCertifyCommand } from "../../reporting/core/certify-command";`;
    let caughtError: unknown;
    try {
      assertValidCliDiagnosticsImports(legacySnippet);
    } catch (err) {
      caughtError = err;
    }
    expect(caughtError).toBeInstanceOf(CliImportResolutionError);
    if (caughtError instanceof CliImportResolutionError) {
      expect(caughtError.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_CLI);
      expect(caughtError.defectRef).toBe(DEFECT_REF);
      expect(caughtError.specifier).toBe(LEGACY_CERTIFY_IMPORT_PATH);
    }
  });

  test("14. auditCliRegistryModuleGraph verifies live diagnostics registry, doctor:certify command binding, and module graph", () => {
    const audit = auditCliRegistryModuleGraph();
    expect(audit.defectRef).toBe(DEFECT_REF);
    expect(audit.resolved).toBe(true);
    expect(audit.canonicalCertifyPath).toBe(CANONICAL_CERTIFY_IMPORT_PATH);
    expect(audit.commandCount).toBeGreaterThan(0);
    expect(audit.certifiedCommandRegistered).toBe(true);
    expect(audit.issues).toEqual([]);
    expect(audit.importedModules).toContain(CANONICAL_CERTIFY_IMPORT_PATH);
  });
});
