import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANONICAL_MUTATION_CANDIDATE_MODULE,
  CANONICAL_MUTATION_GATE_INDEX_SPECIFIER,
  CANONICAL_MUTATION_GATE_TYPES_PATH,
  CANONICAL_VALIDATION_INDEX_PATH,
  DEFECT_REF,
  KNOWN_LEGACY_ENGINE_SPECIFIERS,
  LEGACY_ENGINE_INDEX_SPECIFIER,
  TARGET_MEMBER,
  UNEXPORTED_MEMBER_IMPORT,
  ValidationIndexExportError,
  assertValidationIndexExportsPurity,
  auditValidationIndexModuleTree,
  createValidationIndexDefectEntry,
  extractBarrelReExports,
  extractModuleImports,
  isLegacyMutationCandidateImport,
  remediateValidationIndexExports,
  validateValidationIndexExports,
} from "../../../olt/scripts/src/validation/defect-validation-index-missing-mutation-candidate-export.ts";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `val-index-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  }
  tempDirs.length = 0;
});

describe("Task 1.9: defect-validation-index-missing-mutation-candidate-export", () => {
  test("1. defect constants and specifiers are correctly defined", () => {
    expect(DEFECT_REF).toBe("defect-validation-index-missing-mutation-candidate-export");
    expect(UNEXPORTED_MEMBER_IMPORT).toBe("UNEXPORTED_MEMBER_IMPORT");
    expect(CANONICAL_MUTATION_CANDIDATE_MODULE).toBe("./mutation-gate/types.ts");
    expect(CANONICAL_VALIDATION_INDEX_PATH).toBe("olt/scripts/src/validation/index.ts");
    expect(CANONICAL_MUTATION_GATE_INDEX_SPECIFIER).toBe("./mutation-gate/index.ts");
    expect(CANONICAL_MUTATION_GATE_TYPES_PATH).toBe(
      "olt/scripts/src/validation/mutation-gate/types.ts",
    );
    expect(LEGACY_ENGINE_INDEX_SPECIFIER).toBe("./engine/index.ts");
    expect(TARGET_MEMBER).toBe("MutationCandidate");
    expect(KNOWN_LEGACY_ENGINE_SPECIFIERS).toContain("./engine/index.ts");
    expect(KNOWN_LEGACY_ENGINE_SPECIFIERS).toContain("../engine/index.ts");
  });

  test("2. ValidationIndexExportError instantiates with defaults and custom options", () => {
    const defaultErr = new ValidationIndexExportError("Missing export");
    expect(defaultErr).toBeInstanceOf(Error);
    expect(defaultErr).toBeInstanceOf(ValidationIndexExportError);
    expect(defaultErr.name).toBe("ValidationIndexExportError");
    expect(defaultErr.code).toBe(UNEXPORTED_MEMBER_IMPORT);
    expect(defaultErr.defectRef).toBe(DEFECT_REF);
    expect(defaultErr.issues).toEqual([]);

    const customErr = new ValidationIndexExportError("Custom issue", {
      code: "CUSTOM_CODE",
      defectRef: "custom-ref",
      specifier: "./engine/index.ts",
      missingMember: "MutationCandidate",
      filePath: "/path/to/index.ts",
      issues: [
        {
          code: "CUSTOM_CODE",
          message: "Unexported symbol",
          specifier: "./engine/index.ts",
          member: "MutationCandidate",
        },
      ],
    });
    expect(customErr.code).toBe("CUSTOM_CODE");
    expect(customErr.defectRef).toBe("custom-ref");
    expect(customErr.specifier).toBe("./engine/index.ts");
    expect(customErr.missingMember).toBe("MutationCandidate");
    expect(customErr.filePath).toBe("/path/to/index.ts");
    expect(customErr.issues.length).toBe(1);
  });

  test("3. extractModuleImports and extractBarrelReExports parse export blocks and specifiers", () => {
    const src = `
      export {
        generateMutants,
        type MutationCandidate,
      } from "./mutation-gate/index.ts";
      export type { BlobWriteResult } from "./engine/store/index.ts";
      import { something } from "./other.ts";
    `;
    const imports = extractModuleImports(src);
    expect(imports).toContain("./mutation-gate/index.ts");
    expect(imports).toContain("./engine/store/index.ts");
    expect(imports).toContain("./other.ts");

    const reExports = extractBarrelReExports(src);
    expect(reExports.length).toBe(2);
    expect(reExports[0]?.specifier).toBe("./mutation-gate/index.ts");
    expect(reExports[0]?.symbols).toContain("generateMutants");
    expect(reExports[0]?.typeSymbols).toContain("MutationCandidate");
    expect(reExports[1]?.specifier).toBe("./engine/store/index.ts");
    expect(reExports[1]?.isTypeOnly).toBe(true);

    expect(extractModuleImports("")).toEqual([]);
    expect(extractBarrelReExports("")).toEqual([]);
  });

  test("4. isLegacyMutationCandidateImport identifies legacy engine specifiers", () => {
    expect(isLegacyMutationCandidateImport("./engine/index.ts", "MutationCandidate")).toBe(true);
    expect(isLegacyMutationCandidateImport("../engine/index.ts", "MutationCandidate")).toBe(true);
    expect(isLegacyMutationCandidateImport("./engine", "MutationCandidate")).toBe(true);
    expect(isLegacyMutationCandidateImport("engine/index.ts", "MutationCandidate")).toBe(true);
    expect(
      isLegacyMutationCandidateImport("./engine/mutation-candidate.ts", "MutationCandidate"),
    ).toBe(true);

    expect(isLegacyMutationCandidateImport("./mutation-gate/index.ts", "MutationCandidate")).toBe(
      false,
    );
    expect(isLegacyMutationCandidateImport("./mutation-gate/types.ts", "MutationCandidate")).toBe(
      false,
    );
    expect(isLegacyMutationCandidateImport("./other-module.ts", "MutationCandidate")).toBe(false);
    expect(isLegacyMutationCandidateImport("", "MutationCandidate")).toBe(false);
  });

  test("5. remediateValidationIndexExports rewrites unexported engine imports to canonical mutation-gate specifiers", () => {
    const legacyExportSrc = `export { type MutationCandidate } from "./engine/index.ts";`;
    const remediated1 = remediateValidationIndexExports(legacyExportSrc);
    expect(remediated1).toContain(`from "${CANONICAL_MUTATION_GATE_INDEX_SPECIFIER}"`);
    expect(remediated1).not.toContain('"./engine/index.ts"');

    const mixedExportSrc = `export {\n  someEngineFn,\n  type MutationCandidate,\n} from "./engine/index.ts";`;
    const remediated2 = remediateValidationIndexExports(mixedExportSrc);
    expect(remediated2).toContain(`from "${CANONICAL_MUTATION_GATE_INDEX_SPECIFIER}"`);
    expect(remediated2).toContain("someEngineFn");
    expect(remediated2).toContain("MutationCandidate");

    const legacyImportSrc = `import { type MutationCandidate } from "./engine/index.ts";`;
    const remediated3 = remediateValidationIndexExports(legacyImportSrc);
    expect(remediated3).toContain(`from "${CANONICAL_MUTATION_CANDIDATE_MODULE}"`);

    const canonicalSrc = `export { type MutationCandidate } from "./mutation-gate/index.ts";`;
    expect(remediateValidationIndexExports(canonicalSrc)).toBe(canonicalSrc);
  });

  test("6. validateValidationIndexExports validates live codebase and flags unexported imports", () => {
    const liveResult = validateValidationIndexExports();
    expect(liveResult.valid).toBe(true);
    expect(liveResult.defectRef).toBe(DEFECT_REF);
    expect(liveResult.legacyImportDetected).toBe(false);
    expect(liveResult.canonicalExportPresent).toBe(true);
    expect(liveResult.issues.length).toBe(0);

    const corruptSrc = `export { type MutationCandidate } from "./engine/index.ts";`;
    const corruptResult = validateValidationIndexExports(corruptSrc, { filePath: "test-index.ts" });
    expect(corruptResult.valid).toBe(false);
    expect(corruptResult.legacyImportDetected).toBe(true);
    expect(corruptResult.issues.length).toBe(1);
    expect(corruptResult.issues[0]?.code).toBe(UNEXPORTED_MEMBER_IMPORT);
    expect(corruptResult.issues[0]?.member).toBe("MutationCandidate");

    const missingResult = validateValidationIndexExports("/nonexistent/validation/index.ts");
    expect(missingResult.valid).toBe(false);
    expect(missingResult.issues[0]?.message).toContain("File not found");
  });

  test("7. assertValidationIndexExportsPurity succeeds on pure sources and throws on legacy engine imports", () => {
    const cleanSrc = `export { type MutationCandidate } from "./mutation-gate/index.ts";`;
    expect(() => assertValidationIndexExportsPurity(cleanSrc)).not.toThrow();

    const corruptSrc = `export { type MutationCandidate } from "./engine/index.ts";`;
    let caught: unknown;
    try {
      assertValidationIndexExportsPurity(corruptSrc, { filePath: "index.ts" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationIndexExportError);
    if (caught instanceof ValidationIndexExportError) {
      expect(caught.code).toBe(UNEXPORTED_MEMBER_IMPORT);
      expect(caught.defectRef).toBe(DEFECT_REF);
      expect(caught.missingMember).toBe("MutationCandidate");
      expect(caught.specifier).toBe("./engine/index.ts");
    }
  });

  test("8. auditValidationIndexModuleTree audits repository tree and custom directory trees", () => {
    const treeAudit = auditValidationIndexModuleTree();
    expect(treeAudit.defectRef).toBe(DEFECT_REF);
    expect(treeAudit.errorCode).toBe(UNEXPORTED_MEMBER_IMPORT);
    expect(treeAudit.resolved).toBe(true);
    expect(treeAudit.totalFiles).toBeGreaterThan(5);
    expect(treeAudit.invalidFiles).toBe(0);
    expect(treeAudit.issues).toEqual([]);

    const tempDir = createTempDir();
    writeFileSync(
      join(tempDir, "clean.ts"),
      `export { type MutationCandidate } from "./mutation-gate/index.ts";\n`,
      "utf-8",
    );
    writeFileSync(
      join(tempDir, "legacy.ts"),
      `export { type MutationCandidate } from "./engine/index.ts";\n`,
      "utf-8",
    );

    const tempAudit = auditValidationIndexModuleTree(tempDir);
    expect(tempAudit.resolved).toBe(false);
    expect(tempAudit.totalFiles).toBe(2);
    expect(tempAudit.validFiles).toBe(1);
    expect(tempAudit.invalidFiles).toBe(1);
    expect(tempAudit.issues.length).toBe(1);
  });

  test("9. createValidationIndexDefectEntry generates compliant DefectEntry contract", () => {
    const entry = createValidationIndexDefectEntry({
      filePath: "olt/scripts/src/validation/index.ts",
      issues: [
        {
          code: UNEXPORTED_MEMBER_IMPORT,
          message: "Unexported member MutationCandidate",
          specifier: "./engine/index.ts",
          member: "MutationCandidate",
        },
      ],
    });
    expect(entry.id).toContain(DEFECT_REF);
    expect(entry.domain).toBe("validation-modularization");
    expect(entry.error_code).toBe(UNEXPORTED_MEMBER_IMPORT);
    expect(entry.status).toBe("open");
    expect(entry.type).toBe("MODULARITY_VIOLATION");
    expect(entry.category).toBe("modularity_violation");
    expect(entry.severity).toBe("high");
    expect(entry.context?.file).toBe("olt/scripts/src/validation/index.ts");
    expect(entry.context?.defectReference).toBe(DEFECT_REF);
    expect(entry.context?.member).toBe("MutationCandidate");
    expect(entry.context?.canonicalModule).toBe(CANONICAL_MUTATION_CANDIDATE_MODULE);
  });

  test("10. verifies zero TypeScript any and zero compiler suppressions across write scope", () => {
    const filesToAudit = [
      join(
        process.cwd(),
        "olt/scripts/src/validation/defect-validation-index-missing-mutation-candidate-export.ts",
      ),
      join(
        process.cwd(),
        "tests/unit/validation/defect-validation-index-missing-mutation-candidate-export.test.ts",
      ),
    ];
    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      ["@ts" + "-ignore", "@ts" + "-expect-error", "@ts" + "-nocheck"].join("|"),
    );

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
