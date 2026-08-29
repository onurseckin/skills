import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANONICAL_SUGIYAMA_DAG_SUBPATH,
  CANONICAL_SUGIYAMA_EXPORT_STATEMENT,
  CANONICAL_SUGIYAMA_IMPORT_STATEMENT,
  CANONICAL_TYPE_EXPORT_SPECIFIER,
  CANONICAL_WAVE_METRICS_EXPORT_SPECIFIER,
  DEFECT_REF,
  DEFECT_TITLE,
  ERROR_CODE,
  STANDARD_UNIFIED_REPORTING_MODULES,
  TARGET_UNIFIED_INDEX_PATH,
  TARGET_UNIFIED_SECTIONS_PATH,
  TARGET_UNIFIED_TYPES_PATH,
  UNEXPORTED_TYPE_DECLARATION,
  UnifiedSectionsExportError,
  assertUnifiedSectionsExportPurity,
  auditUnifiedReportingModuleGraph,
  createMockSugiyamaDagReport,
  createMockUnifiedSectionData,
  createUnifiedSectionsDefectEntry,
  extractModuleImports,
  extractNamedImports,
  extractTypeExports,
  hasSugiyamaDagReportExport,
  hasSugiyamaDagReportImport,
  isSugiyamaTypeExportMissing,
  remediateUnifiedSectionsSource,
  remediateUnifiedTypesSource,
  validateUnifiedSectionsImports,
  validateUnifiedTypesExports,
  verifyUnifiedSectionReportGeneration,
} from "../../../olt/scripts/src/tooling/defect-reporting-unified-sections-missing-sugiyama-export.ts";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = join(tmpdir(), `tooling-sugiyama-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

describe("Task 1.3: defect-reporting-unified-sections-missing-sugiyama-export", () => {
  test("1. defect constants and error codes are correctly specified", () => {
    expect(DEFECT_REF).toBe("defect-reporting-unified-sections-missing-sugiyama-export");
    expect(UNEXPORTED_TYPE_DECLARATION).toBe("UNEXPORTED_TYPE_DECLARATION");
    expect(ERROR_CODE).toBe("UNEXPORTED_TYPE_DECLARATION");
    expect(DEFECT_TITLE).toContain("SugiyamaDagReport");
    expect(TARGET_UNIFIED_TYPES_PATH).toBe("olt/scripts/src/reporting/unified/types.ts");
    expect(TARGET_UNIFIED_SECTIONS_PATH).toBe("olt/scripts/src/reporting/unified/sections.ts");
    expect(TARGET_UNIFIED_INDEX_PATH).toBe("olt/scripts/src/reporting/unified/index.ts");
    expect(CANONICAL_SUGIYAMA_DAG_SUBPATH).toBe("olt/scripts/src/reporting/sugiyama-dag/index.ts");
    expect(CANONICAL_TYPE_EXPORT_SPECIFIER).toBe("SugiyamaDagReport");
    expect(CANONICAL_WAVE_METRICS_EXPORT_SPECIFIER).toBe("SugiyamaWaveMetrics");
    expect(CANONICAL_SUGIYAMA_IMPORT_STATEMENT).toContain("SugiyamaDagReport");
    expect(CANONICAL_SUGIYAMA_EXPORT_STATEMENT).toContain("SugiyamaDagReport");
    expect(STANDARD_UNIFIED_REPORTING_MODULES.length).toBeGreaterThanOrEqual(5);
  });

  test("2. UnifiedSectionsExportError instantiates with defaults and custom options", () => {
    const defaultErr = new UnifiedSectionsExportError("Unexported type error");
    expect(defaultErr).toBeInstanceOf(Error);
    expect(defaultErr.name).toBe("UnifiedSectionsExportError");
    expect(defaultErr.code).toBe(UNEXPORTED_TYPE_DECLARATION);
    expect(defaultErr.defectRef).toBe(DEFECT_REF);
    expect(defaultErr.issues).toEqual([]);

    const customErr = new UnifiedSectionsExportError("Custom export error", {
      code: "CUSTOM_UNEXPORTED_CODE",
      defectRef: "custom-defect-ref",
      specifier: "SugiyamaDagReport",
      filePath: "/src/types.ts",
      issues: [{ code: "CUSTOM_UNEXPORTED_CODE", message: "Type not exported", specifier: "SugiyamaDagReport" }],
    });
    expect(customErr.code).toBe("CUSTOM_UNEXPORTED_CODE");
    expect(customErr.defectRef).toBe("custom-defect-ref");
    expect(customErr.specifier).toBe("SugiyamaDagReport");
    expect(customErr.filePath).toBe("/src/types.ts");
    expect(customErr.issues.length).toBe(1);
  });

  test("3. extractModuleImports and extractTypeExports parse specifiers", () => {
    const src = `
      import type { SugiyamaDagReport } from "../sugiyama-dag/index.ts";
      export type { SugiyamaDagReport, SugiyamaWaveMetrics };
      export interface LeaseMatrixRow { taskId: string; }
      const dyn = await import("./dynamic-module.ts");
    `;
    const imports = extractModuleImports(src);
    expect(imports).toContain("../sugiyama-dag/index.ts");
    expect(imports).toContain("./dynamic-module.ts");
    expect(extractModuleImports("")).toEqual([]);

    const exports = extractTypeExports(src);
    expect(exports).toContain("SugiyamaDagReport");
    expect(exports).toContain("SugiyamaWaveMetrics");
    expect(exports).toContain("LeaseMatrixRow");
    expect(extractTypeExports("")).toEqual([]);
  });

  test("4. extractNamedImports extracts imported symbols accurately", () => {
    const src = `
      import type { SugiyamaDagReport, SugiyamaWaveMetrics } from "./types.ts";
      import { formatTable } from "../../cli/formatters/line-limiter.ts";
    `;
    const allNamed = extractNamedImports(src);
    expect(allNamed).toContain("SugiyamaDagReport");
    expect(allNamed).toContain("SugiyamaWaveMetrics");
    expect(allNamed).toContain("formatTable");

    const fromTypes = extractNamedImports(src, "./types.ts");
    expect(fromTypes).toContain("SugiyamaDagReport");
    expect(fromTypes).not.toContain("formatTable");
    expect(extractNamedImports("")).toEqual([]);
  });

  test("5. hasSugiyamaDagReportExport and hasSugiyamaDagReportImport accurately detect symbols", () => {
    const validExportSrc = `export type { SugiyamaDagReport, SugiyamaWaveMetrics };`;
    expect(hasSugiyamaDagReportExport(validExportSrc)).toBe(true);
    expect(hasSugiyamaDagReportExport(`export interface SugiyamaDagReport { id: string; }`)).toBe(true);
    expect(hasSugiyamaDagReportExport(`export type { OtherType };`)).toBe(false);
    expect(hasSugiyamaDagReportExport("")).toBe(false);

    expect(hasSugiyamaDagReportImport(`import type { SugiyamaDagReport } from "./types.ts";`)).toBe(true);
    expect(hasSugiyamaDagReportImport(`import { formatTable } from "./table.ts";`)).toBe(false);
    expect(hasSugiyamaDagReportImport("")).toBe(false);

    expect(isSugiyamaTypeExportMissing(validExportSrc)).toBe(false);
    expect(isSugiyamaTypeExportMissing(`export type { OtherType };`)).toBe(true);
  });

  test("6. remediateUnifiedTypesSource and remediateUnifiedSectionsSource idempotently update sources", () => {
    const stubCode = `/**\n * Unified Run Report Type Definitions\n */\nexport interface LeaseMatrixRow { taskId: string; }`;
    const remediated = remediateUnifiedTypesSource(stubCode);
    expect(remediated).toContain(CANONICAL_SUGIYAMA_IMPORT_STATEMENT);
    expect(remediated).toContain("SugiyamaDagReport");
    expect(hasSugiyamaDagReportExport(remediated)).toBe(true);
    expect(remediateUnifiedTypesSource(remediated)).toBe(remediated);
    expect(remediateUnifiedTypesSource("")).toBe("");

    const sectionsStub = `import type {\n  CoordinatorOwnershipMetrics,\n} from "./types.ts";`;
    const remediatedSec = remediateUnifiedSectionsSource(sectionsStub);
    expect(remediatedSec).toContain("SugiyamaDagReport");
    expect(remediateUnifiedSectionsSource(remediatedSec)).toBe(remediatedSec);
    expect(remediateUnifiedSectionsSource("")).toBe("");
  });

  test("7. validateUnifiedTypesExports verifies valid types file and detects missing export", () => {
    const liveResult = validateUnifiedTypesExports();
    expect(liveResult.valid).toBe(true);
    expect(liveResult.defectRef).toBe(DEFECT_REF);
    expect(liveResult.exportsSugiyamaDagReport).toBe(true);
    expect(liveResult.exportsSugiyamaWaveMetrics).toBe(true);
    expect(liveResult.issues.length).toBe(0);

    const corruptResult = validateUnifiedTypesExports(`export interface LeaseRow { id: string; }`);
    expect(corruptResult.valid).toBe(false);
    expect(corruptResult.exportsSugiyamaDagReport).toBe(false);
    expect(corruptResult.issues.length).toBeGreaterThan(0);
    expect(corruptResult.issues[0]?.code).toBe(UNEXPORTED_TYPE_DECLARATION);

    const nonExistent = validateUnifiedTypesExports("/nonexistent/types.ts");
    expect(nonExistent.valid).toBe(false);
    expect(nonExistent.issues[0]?.message).toContain("File not found");
  });

  test("8. validateUnifiedSectionsImports checks consumer sections against types exports", () => {
    const liveResult = validateUnifiedSectionsImports();
    expect(liveResult.valid).toBe(true);
    expect(liveResult.defectRef).toBe(DEFECT_REF);
    expect(liveResult.importsSugiyamaDagReport).toBe(true);
    expect(liveResult.targetTypesExportsSugiyama).toBe(true);
    expect(liveResult.issues.length).toBe(0);

    const secSrc = `import type { SugiyamaDagReport } from "./types.ts";`;
    const corruptTypesSrc = `export interface Other {};`;
    const corruptResult = validateUnifiedSectionsImports(secSrc, corruptTypesSrc);
    expect(corruptResult.valid).toBe(false);
    expect(corruptResult.issues.length).toBeGreaterThan(0);

    const nonExistent = validateUnifiedSectionsImports("/nonexistent/sections.ts");
    expect(nonExistent.valid).toBe(false);
    expect(nonExistent.issues[0]?.message).toContain("not found");
  });

  test("9. assertUnifiedSectionsExportPurity asserts purity and throws on violation", () => {
    const validSec = `import type { SugiyamaDagReport } from "./types.ts";`;
    const validTypes = `export type { SugiyamaDagReport, SugiyamaWaveMetrics };`;
    expect(() => assertUnifiedSectionsExportPurity(validTypes, validSec)).not.toThrow();

    let thrownError: unknown;
    try {
      assertUnifiedSectionsExportPurity(`export interface Other {}`, validSec);
    } catch (e) {
      thrownError = e;
    }
    expect(thrownError).toBeInstanceOf(UnifiedSectionsExportError);
  });

  test("10. auditUnifiedReportingModuleGraph audits workspace and temp directory tree", () => {
    const audit = auditUnifiedReportingModuleGraph();
    expect(audit.defectRef).toBe(DEFECT_REF);
    expect(audit.errorCode).toBe(UNEXPORTED_TYPE_DECLARATION);
    expect(audit.resolved).toBe(true);
    expect(audit.typesFileValid).toBe(true);
    expect(audit.sectionsFileValid).toBe(true);
    expect(audit.indexFileValid).toBe(true);
    expect(audit.issues).toEqual([]);

    const tempDir = createTempDir();
    const mockReportingDir = join(tempDir, "olt", "scripts", "src", "reporting", "unified");
    mkdirSync(mockReportingDir, { recursive: true });
    writeFileSync(join(mockReportingDir, "types.ts"), `export interface Other {}`, "utf-8");
    writeFileSync(join(mockReportingDir, "sections.ts"), `import type { SugiyamaDagReport } from "./types.ts";`, "utf-8");
    writeFileSync(join(mockReportingDir, "index.ts"), `export { type Other } from "./types.ts";`, "utf-8");

    const tempAudit = auditUnifiedReportingModuleGraph(tempDir);
    expect(tempAudit.resolved).toBe(false);
    expect(tempAudit.typesFileValid).toBe(false);
  });

  test("11. createUnifiedSectionsDefectEntry creates spec-compliant DefectEntry contract", () => {
    const entry = createUnifiedSectionsDefectEntry({
      filePath: TARGET_UNIFIED_TYPES_PATH,
      issues: [{ code: UNEXPORTED_TYPE_DECLARATION, message: "SugiyamaDagReport not exported", specifier: "SugiyamaDagReport" }],
    });
    expect(entry.id).toContain(DEFECT_REF);
    expect(entry.domain).toBe("reporting-unified");
    expect(entry.error_code).toBe(UNEXPORTED_TYPE_DECLARATION);
    expect(entry.status).toBe("open");
    expect(entry.type).toBe("TYPE_DRIFT");
    expect(entry.category).toBe("code_defect");
    expect(entry.severity).toBe("high");
    expect(entry.context?.targetSymbol).toBe("SugiyamaDagReport");
    expect(entry.context?.file).toBe(TARGET_UNIFIED_TYPES_PATH);
  });

  test("12. createMockSugiyamaDagReport and verifyUnifiedSectionReportGeneration render complete markdown", () => {
    const mockDag = createMockSugiyamaDagReport({ renderedDag: "╭── WAVE 1 ──╮\n│ ● test-dag │\n╰────────────╯" });
    expect(mockDag.isCompiled).toBe(true);
    expect(mockDag.metrics.totalWaves).toBe(1);

    const mockData = createMockUnifiedSectionData({ sugiyamaReport: mockDag });
    expect(mockData.runId).toBe("run-tooling-test-01");

    const renderResult = verifyUnifiedSectionReportGeneration({ sugiyamaReport: mockDag });
    expect(renderResult.containsDagSection).toBe(true);
    expect(renderResult.markdown).toContain("#### 4. Live Sugiyama Hierarchical DAG");
    expect(renderResult.markdown).toContain("╭── WAVE 1 ──╮");
    expect(renderResult.charCount).toBeGreaterThan(500);
  });

  test("13. verifies zero TypeScript any and zero compiler suppressions across write scope", () => {
    const filesToAudit = [
      join(process.cwd(), "olt/scripts/src/tooling/defect-reporting-unified-sections-missing-sugiyama-export.ts"),
      join(process.cwd(), "tests/unit/tooling/defect-reporting-unified-sections-missing-sugiyama-export.test.ts"),
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
