import { describe, expect, test } from "bun:test";
import {
  assertAuthoritySessionImportsPurity,
  auditAuthoritySessionModuleTree,
  AuthoritySessionImportError,
  CANONICAL_SESSION_IO_SPECIFIER,
  CANONICAL_SESSION_PATHS_SPECIFIER,
  createAuthoritySessionDefectEntry,
  DEFECT_REF,
  extractModuleImports,
  IO_EXPORT_SYMBOLS,
  isLegacyPathsAndIoImport,
  KNOWN_AUTHORITY_SESSION_ENTRY,
  LEGACY_SESSION_PATHS_AND_IO_SPECIFIER,
  PATHS_EXPORT_SYMBOLS,
  remediateAuthoritySessionImports,
  UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY,
  validateAuthoritySessionImports,
} from "../../../olt/scripts/src/validation/defect-authority-session-unresolved-paths-and-io.ts";

describe("Task 1.7: defect-authority-session-unresolved-paths-and-io", () => {
  test("1. defect constants and export symbols are correctly specified", () => {
    expect(DEFECT_REF).toBe("defect-authority-session-unresolved-paths-and-io");
    expect(UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY).toBe("UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY");
    expect(CANONICAL_SESSION_PATHS_SPECIFIER).toBe("./paths.ts");
    expect(CANONICAL_SESSION_IO_SPECIFIER).toBe("./io.ts");
    expect(LEGACY_SESSION_PATHS_AND_IO_SPECIFIER).toBe("./paths-and-io.ts");
    expect(KNOWN_AUTHORITY_SESSION_ENTRY).toBe("olt/scripts/src/authority/session/index.ts");
    expect(PATHS_EXPORT_SYMBOLS.length).toBe(9);
    expect(PATHS_EXPORT_SYMBOLS).toContain("assertRealDirectory");
    expect(PATHS_EXPORT_SYMBOLS).toContain("resolveGlobalSessionsDir");
    expect(IO_EXPORT_SYMBOLS.length).toBe(9);
    expect(IO_EXPORT_SYMBOLS).toContain("atomicSessionWrite");
    expect(IO_EXPORT_SYMBOLS).toContain("secureReadSession");
  });

  test("2. AuthoritySessionImportError instantiates with default code and defectRef", () => {
    const error = new AuthoritySessionImportError("Unresolved import encountered");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AuthoritySessionImportError);
    expect(error.name).toBe("AuthoritySessionImportError");
    expect(error.message).toBe("Unresolved import encountered");
    expect(error.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY);
    expect(error.defectRef).toBe(DEFECT_REF);
    expect(error.specifier).toBeUndefined();
    expect(error.filePath).toBeUndefined();
  });

  test("3. AuthoritySessionImportError preserves custom options", () => {
    const error = new AuthoritySessionImportError("Custom error", {
      code: "CUSTOM_AUTH_CODE",
      defectRef: "custom-ref",
      specifier: "./paths-and-io.ts",
      filePath: "/path/to/session/index.ts",
    });
    expect(error.code).toBe("CUSTOM_AUTH_CODE");
    expect(error.defectRef).toBe("custom-ref");
    expect(error.specifier).toBe("./paths-and-io.ts");
    expect(error.filePath).toBe("/path/to/session/index.ts");
  });

  test("4. extractModuleImports extracts static, dynamic, and re-export specifiers", () => {
    const source = `
      import { resolveGlobalSessionsDir } from "./paths.ts";
      import { atomicSessionWrite } from "./io.ts";
      export { registerSessionGrant } from "./grants.ts";
      async function load() {
        const mod = await import("./resolver.ts");
      }
    `;
    const imports = extractModuleImports(source);
    expect(imports).toContain("./paths.ts");
    expect(imports).toContain("./io.ts");
    expect(imports).toContain("./grants.ts");
    expect(imports).toContain("./resolver.ts");
    expect(imports.length).toBe(4);
    expect(extractModuleImports("")).toEqual([]);
  });

  test("5. isLegacyPathsAndIoImport correctly identifies legacy imports", () => {
    expect(isLegacyPathsAndIoImport("./paths-and-io.ts")).toBe(true);
    expect(isLegacyPathsAndIoImport("./paths-and-io")).toBe(true);
    expect(isLegacyPathsAndIoImport("../paths-and-io.ts")).toBe(true);
    expect(isLegacyPathsAndIoImport("authority/session/paths-and-io.ts")).toBe(true);
    expect(isLegacyPathsAndIoImport("./paths.ts")).toBe(false);
    expect(isLegacyPathsAndIoImport("./io.ts")).toBe(false);
    expect(isLegacyPathsAndIoImport("")).toBe(false);
  });

  test("6. remediateAuthoritySessionImports separates mixed legacy exports into canonical paths and io imports", () => {
    const legacyMixed = `export { assertRealDirectory, atomicSessionWrite } from "./paths-and-io.ts";`;
    const remediated = remediateAuthoritySessionImports(legacyMixed);
    expect(remediated).toContain('export { assertRealDirectory } from "./paths.ts";');
    expect(remediated).toContain('export { atomicSessionWrite } from "./io.ts";');
    expect(remediated).not.toContain("paths-and-io");
  });

  test("7. remediateAuthoritySessionImports handles path-only and io-only imports accurately", () => {
    const legacyPath = `import { resolveGlobalSessionsDir, sameInode } from "./paths-and-io.ts";`;
    const remediatedPath = remediateAuthoritySessionImports(legacyPath);
    expect(remediatedPath).toContain('import { resolveGlobalSessionsDir, sameInode } from "./paths.ts";');
    expect(remediatedPath).not.toContain("io.ts");

    const legacyIo = `import { secureReadSession, snapshotSession } from "./paths-and-io.ts";`;
    const remediatedIo = remediateAuthoritySessionImports(legacyIo);
    expect(remediatedIo).toContain('import { secureReadSession, snapshotSession } from "./io.ts";');
    expect(remediatedIo).not.toContain("paths.ts");
  });

  test("8. remediateAuthoritySessionImports handles wildcard and bare imports", () => {
    const wildcard = `export * from "./paths-and-io.ts";`;
    const remediatedWildcard = remediateAuthoritySessionImports(wildcard);
    expect(remediatedWildcard).toContain('export * from "./paths.ts";');
    expect(remediatedWildcard).toContain('export * from "./io.ts";');

    const bare = `import "./paths-and-io.ts";`;
    const remediatedBare = remediateAuthoritySessionImports(bare);
    expect(remediatedBare).toContain('import "./paths.ts";');
    expect(remediatedBare).toContain('import "./io.ts";');
  });

  test("9. validateAuthoritySessionImports validates live repository session index successfully", () => {
    const result = validateAuthoritySessionImports();
    expect(result.defectRef).toBe(DEFECT_REF);
    expect(result.valid).toBe(true);
    expect(result.legacyImportDetected).toBe(false);
    expect(result.canonicalPathsPresent).toBe(true);
    expect(result.canonicalIoPresent).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.imports).toContain(CANONICAL_SESSION_PATHS_SPECIFIER);
    expect(result.imports).toContain(CANONICAL_SESSION_IO_SPECIFIER);
  });

  test("10. validateAuthoritySessionImports detects legacy import issues in corrupt snippet", () => {
    const corruptSnippet = `export { assertRealDirectory } from "./paths-and-io.ts";`;
    const result = validateAuthoritySessionImports(corruptSnippet);
    expect(result.valid).toBe(false);
    expect(result.legacyImportDetected).toBe(true);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0]).toContain("Unresolved legacy paths-and-io import");

    const nonExistent = validateAuthoritySessionImports("/nonexistent/file.ts");
    expect(nonExistent.valid).toBe(false);
    expect(nonExistent.issues[0]).toContain("File not found");
  });

  test("11. assertAuthoritySessionImportsPurity succeeds on canonical source and throws on defect", () => {
    expect(() => assertAuthoritySessionImportsPurity()).not.toThrow();

    const corruptSnippet = `export { assertRealDirectory } from "./paths-and-io.ts";`;
    let thrownError: unknown;
    try {
      assertAuthoritySessionImportsPurity(corruptSnippet);
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).toBeInstanceOf(AuthoritySessionImportError);
    if (thrownError instanceof AuthoritySessionImportError) {
      expect(thrownError.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY);
      expect(thrownError.defectRef).toBe(DEFECT_REF);
      expect(thrownError.specifier).toBe(LEGACY_SESSION_PATHS_AND_IO_SPECIFIER);
    }
  });

  test("12. auditAuthoritySessionModuleTree audits the authority session directory and modules", () => {
    const audit = auditAuthoritySessionModuleTree();
    expect(audit.defectRef).toBe(DEFECT_REF);
    expect(audit.errorCode).toBe(UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY);
    expect(audit.resolved).toBe(true);
    expect(audit.canonicalPathsFound).toBe(true);
    expect(audit.canonicalIoFound).toBe(true);
    expect(audit.legacyModuleDetected).toBe(false);
    expect(audit.pathsSymbolsCount).toBe(9);
    expect(audit.ioSymbolsCount).toBe(9);
    expect(audit.totalExportedSymbols).toBe(18);
    expect(audit.verifiedModules.length).toBeGreaterThanOrEqual(5);
    expect(audit.issues).toEqual([]);
  });

  test("13. createAuthoritySessionDefectEntry creates fully typed DefectEntry structure", () => {
    const defect = createAuthoritySessionDefectEntry();
    expect(defect.domain).toBe("authority-session");
    expect(defect.error_code).toBe(UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY);
    expect(defect.status).toBe("open");
    expect(defect.type).toBe("CODE_HEALTH");
    expect(defect.category).toBe("code_defect");
    expect(defect.severity).toBe("high");
    expect(defect.title).toContain(LEGACY_SESSION_PATHS_AND_IO_SPECIFIER);

    const customDefect = createAuthoritySessionDefectEntry({
      id: "custom-defect-id-123",
      filePath: "custom/path.ts",
      issues: ["Issue 1", "Issue 2"],
      status: "resolved",
      severity: "critical",
    });
    expect(customDefect.id).toBe("custom-defect-id-123");
    expect(customDefect.status).toBe("resolved");
    expect(customDefect.severity).toBe("critical");
    expect(customDefect.message).toBe("Issue 1; Issue 2");
  });
});
