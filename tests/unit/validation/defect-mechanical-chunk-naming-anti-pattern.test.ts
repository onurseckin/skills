import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFECT_REF,
  MECHANICAL_CHUNK_NAMING_BLUNDER,
  MECHANICAL_CHUNK_PATTERNS,
  MechanicalChunkNamingError,
  assertSemanticNamingPurity,
  auditRepositoryForMechanicalChunkNaming,
  createMechanicalChunkNamingDefectEntry,
  detectMechanicalChunkNaming,
  suggestSemanticModuleName,
  validatePathSemanticNaming,
} from "../../../olt/scripts/src/validation/defect-mechanical-chunk-naming-anti-pattern.ts";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = join(tmpdir(), `chunk-naming-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* cleanup */ }
  }
  tempDirs.length = 0;
});

describe("Task 1.12: defect-mechanical-chunk-naming-anti-pattern", () => {
  test("1. constants export verified", () => {
    expect(DEFECT_REF).toBe("defect-mechanical-chunk-naming-anti-pattern");
    expect(MECHANICAL_CHUNK_NAMING_BLUNDER).toBe("MECHANICAL_CHUNK_NAMING_BLUNDER");
    expect(MECHANICAL_CHUNK_PATTERNS.length).toBeGreaterThanOrEqual(4);
    for (const pat of MECHANICAL_CHUNK_PATTERNS) expect(pat).toBeInstanceOf(RegExp);
  });

  test("2. detectMechanicalChunkNaming returns empty array on clean domain-semantic names", () => {
    const semanticFiles = ["parser.ts", "types.ts", "validator.ts", "chunk-parser.ts", "multipart-form.ts", "storage.ts"];
    for (const f of semanticFiles) {
      const issues = detectMechanicalChunkNaming(f);
      expect(issues).toEqual([]);
    }
  });

  test("3. detectMechanicalChunkNaming identifies *-chunkN.ts anti-pattern variants", () => {
    const mechanical = ["pushbacks-chunk1.ts", "rotate-chunk2.ts", "proposal-chunk5.ts", "memory-chunk3.ts"];
    for (const m of mechanical) {
      const issues = detectMechanicalChunkNaming(m);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.code).toBe(MECHANICAL_CHUNK_NAMING_BLUNDER);
      expect(issues[0]?.filePath).toBe(m);
    }
  });

  test("4. detectMechanicalChunkNaming identifies *_partN.ts and *-partN.ts anti-patterns", () => {
    const partFiles = ["foo_part1.ts", "bar-part2.tsx", "service_part3.js", "data.part4.ts"];
    for (const p of partFiles) {
      const issues = detectMechanicalChunkNaming(p);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.code).toBe(MECHANICAL_CHUNK_NAMING_BLUNDER);
    }
  });

  test("5. detectMechanicalChunkNaming identifies standalone chunkN.ts and partN.js", () => {
    const standalones = ["chunk1.ts", "part2.js", "slice3.ts", "split4.mjs"];
    for (const s of standalones) {
      const issues = detectMechanicalChunkNaming(s);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.code).toBe(MECHANICAL_CHUNK_NAMING_BLUNDER);
    }
  });

  test("6. detectMechanicalChunkNaming scans code imports and detects mechanical chunk imports", () => {
    const code = `
      import { rotateCore } from "./rotate-chunk2.ts";
      import type { Proposal } from "../proposal-chunk5";
    `;
    const issues = detectMechanicalChunkNaming("clean-file.ts", code);
    expect(issues.length).toBe(2);
    expect(issues[0]?.specifier).toBe("./rotate-chunk2.ts");
    expect(issues[0]?.line).toBe(2);
    expect(issues[1]?.specifier).toBe("../proposal-chunk5");
    expect(issues[1]?.line).toBe(3);
  });

  test("7. validatePathSemanticNaming passes on clean semantic path", () => {
    const res = validatePathSemanticNaming("olt/scripts/src/engine/rotator.ts");
    expect(res.valid).toBe(true);
    expect(res.defectRef).toBe(DEFECT_REF);
    expect(res.isMechanicalChunk).toBe(false);
    expect(res.issueCount).toBe(0);
  });

  test("8. validatePathSemanticNaming fails on mechanical chunk path with suggestions", () => {
    const res = validatePathSemanticNaming("olt/scripts/src/engine/rotate-chunk2.ts");
    expect(res.valid).toBe(false);
    expect(res.defectRef).toBe(DEFECT_REF);
    expect(res.isMechanicalChunk).toBe(true);
    expect(res.issueCount).toBe(1);
    expect(res.suggestedName).toBe("olt/scripts/src/engine/rotate-rotator.ts");
  });

  test("9. suggestSemanticModuleName replaces mechanical chunk with responsibility hint", () => {
    expect(suggestSemanticModuleName("pushbacks-chunk1.ts", { responsibility: "validator" })).toBe("pushbacks-validator.ts");
    expect(suggestSemanticModuleName("rotate_part2.ts", { responsibility: "rotator" })).toBe("rotate_rotator.ts");
    expect(suggestSemanticModuleName("proposal-chunk5.ts", { responsibility: "types" })).toBe("proposal-types.ts");
  });

  test("10. suggestSemanticModuleName infers role heuristically from stem", () => {
    expect(suggestSemanticModuleName("memory-chunk3.ts")).toBe("memory-storage.ts");
    expect(suggestSemanticModuleName("ast-parse-chunk1.ts")).toBe("ast-parse-parser.ts");
    expect(suggestSemanticModuleName("auth-guard-chunk2.ts")).toBe("auth-guard-validator.ts");
    expect(suggestSemanticModuleName("contract-type-chunk4.ts")).toBe("contract-type-types.ts");
    expect(suggestSemanticModuleName("chunk1.ts")).toBe("module-core.ts");
  });

  test("11. suggestSemanticModuleName preserves directory prefix and compound extensions", () => {
    const path = "olt/scripts/src/engine/rotate-chunk2.test.ts";
    const suggested = suggestSemanticModuleName(path, { responsibility: "rotator" });
    expect(suggested).toBe("olt/scripts/src/engine/rotate-rotator.test.ts");
  });

  test("12. suggestSemanticModuleName is idempotent on semantic file names", () => {
    expect(suggestSemanticModuleName("parser.ts")).toBe("parser.ts");
    expect(suggestSemanticModuleName("olt/scripts/src/validation/index.ts")).toBe("olt/scripts/src/validation/index.ts");
  });

  test("13. assertSemanticNamingPurity does not throw on pure semantic paths", () => {
    expect(() => assertSemanticNamingPurity("olt/scripts/src/engine/validator.ts")).not.toThrow();
  });

  test("14. assertSemanticNamingPurity throws MechanicalChunkNamingError on violating path", () => {
    expect(() => assertSemanticNamingPurity("rotate-chunk2.ts")).toThrow(MechanicalChunkNamingError);
  });

  test("15. assertSemanticNamingPurity throws MechanicalChunkNamingError on mechanical chunk import", () => {
    const brokenCode = `import { parse } from "./parser-chunk1.ts";`;
    expect(() => assertSemanticNamingPurity("valid.ts", brokenCode)).toThrow(MechanicalChunkNamingError);
  });

  test("16. MechanicalChunkNamingError encapsulates code, defectRef, issues and filePath", () => {
    const issue = {
      code: MECHANICAL_CHUNK_NAMING_BLUNDER,
      message: "Violating chunk name",
      filePath: "pushbacks-chunk1.ts",
    };
    const err = new MechanicalChunkNamingError("Naming failure", {
      code: MECHANICAL_CHUNK_NAMING_BLUNDER,
      defectRef: DEFECT_REF,
      filePath: "pushbacks-chunk1.ts",
      issues: [issue],
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MechanicalChunkNamingError);
    expect(err.name).toBe("MechanicalChunkNamingError");
    expect(err.code).toBe(MECHANICAL_CHUNK_NAMING_BLUNDER);
    expect(err.defectRef).toBe(DEFECT_REF);
    expect(err.filePath).toBe("pushbacks-chunk1.ts");
    expect(err.issues).toHaveLength(1);
  });

  test("17. auditRepositoryForMechanicalChunkNaming audits validation directory successfully", () => {
    const targetDir = join(process.cwd(), "olt/scripts/src/validation");
    const audit = auditRepositoryForMechanicalChunkNaming(targetDir);
    expect(audit.compliant).toBe(true);
    expect(audit.defectRef).toBe(DEFECT_REF);
    expect(audit.errorCode).toBe(MECHANICAL_CHUNK_NAMING_BLUNDER);
    expect(audit.totalFiles).toBeGreaterThanOrEqual(1);
    expect(audit.validFiles).toBe(audit.totalFiles);
    expect(audit.mechanicalChunkFiles).toBe(0);
    expect(audit.violatingPaths).toHaveLength(0);
  });

  test("18. auditRepositoryForMechanicalChunkNaming detects violations in temp directory", () => {
    const tempDir = createTempDir();
    writeFileSync(join(tempDir, "parser.ts"), "export const a = 1;\n", "utf-8");
    writeFileSync(join(tempDir, "pushbacks-chunk1.ts"), "export const b = 2;\n", "utf-8");

    const audit = auditRepositoryForMechanicalChunkNaming(tempDir);
    expect(audit.compliant).toBe(false);
    expect(audit.totalFiles).toBe(2);
    expect(audit.validFiles).toBe(1);
    expect(audit.mechanicalChunkFiles).toBe(1);
    expect(audit.violatingPaths[0]).toContain("pushbacks-chunk1.ts");
  });

  test("19. createMechanicalChunkNamingDefectEntry generates valid structured DefectEntry", () => {
    const entry = createMechanicalChunkNamingDefectEntry({
      filePath: "olt/scripts/src/engine/rotate-chunk2.ts",
      issues: [{
        code: MECHANICAL_CHUNK_NAMING_BLUNDER,
        message: "Mechanical chunk naming blunder detected in path 'rotate-chunk2.ts'",
        filePath: "rotate-chunk2.ts",
      }],
    });
    expect(entry.id).toContain(DEFECT_REF);
    expect(entry.domain).toBe("file-modularization-semantic-naming");
    expect(entry.error_code).toBe(MECHANICAL_CHUNK_NAMING_BLUNDER);
    expect(entry.status).toBe("open");
    expect(entry.type).toBe("MODULARITY_VIOLATION");
    expect(entry.category).toBe("modularity_violation");
    expect(entry.severity).toBe("high");
    expect(entry.context?.file).toBe("olt/scripts/src/engine/rotate-chunk2.ts");
    expect(entry.context?.defectReference).toBe(DEFECT_REF);
  });

  test("20. verifies zero TypeScript any and zero compiler suppressions across write scope", () => {
    const filesToAudit = [
      join(process.cwd(), "olt/scripts/src/validation/defect-mechanical-chunk-naming-anti-pattern.ts"),
      join(process.cwd(), "tests/unit/validation/defect-mechanical-chunk-naming-anti-pattern.test.ts"),
    ];
    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(["@ts" + "-ignore", "@ts" + "-expect-error", "@ts" + "-nocheck"].join("|"));

    for (const filePath of filesToAudit) {
      expect(existsSync(filePath)).toBe(true);
      const lines = readFileSync(filePath, "utf-8").split("\n");
      for (const line of lines) {
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;
        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
