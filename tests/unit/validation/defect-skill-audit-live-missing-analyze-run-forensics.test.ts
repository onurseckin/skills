import { describe, expect, test } from "bun:test";
import {
  analyzeRunForensics,
  assertSkillAuditLiveForensicsPurity,
  auditSkillAuditLiveModuleTree,
  CANONICAL_SKILL_AUDIT_MODULE_PATH,
  createSkillAuditLiveDefectEntry,
  DEFECT_REF,
  extractDeclaredSymbols,
  REQUIRED_SKILL_AUDIT_FORENSICS_SYMBOLS,
  SkillAuditLiveSymbolError,
  UNDEFINED_FUNCTION_REFERENCE,
  validateSkillAuditLiveForensicsSymbols,
} from "../../../olt/scripts/src/validation/defect-skill-audit-live-missing-analyze-run-forensics.ts";

describe("Task 1.11: defect-skill-audit-live-missing-analyze-run-forensics", () => {
  test("1. defect constants, paths, and required symbol definitions are accurately specified", () => {
    expect(DEFECT_REF).toBe("defect-skill-audit-live-missing-analyze-run-forensics");
    expect(UNDEFINED_FUNCTION_REFERENCE).toBe("UNDEFINED_FUNCTION_REFERENCE");
    expect(CANONICAL_SKILL_AUDIT_MODULE_PATH).toBe("olt/scripts/src/mind/auditing/cognitive/skill-auditor.ts");
    expect(REQUIRED_SKILL_AUDIT_FORENSICS_SYMBOLS).toContain("analyzeRunForensics");
    expect(REQUIRED_SKILL_AUDIT_FORENSICS_SYMBOLS).toContain("SkillAuditorEngine");
    expect(REQUIRED_SKILL_AUDIT_FORENSICS_SYMBOLS).toContain("SKILL_AUDIT_FORENSICS_CATEGORIES");
  });

  test("2. SkillAuditLiveSymbolError instantiates with default and custom options", () => {
    const defaultErr = new SkillAuditLiveSymbolError("Missing analyzeRunForensics in live audit");
    expect(defaultErr).toBeInstanceOf(Error);
    expect(defaultErr).toBeInstanceOf(SkillAuditLiveSymbolError);
    expect(defaultErr.name).toBe("SkillAuditLiveSymbolError");
    expect(defaultErr.code).toBe(UNDEFINED_FUNCTION_REFERENCE);
    expect(defaultErr.defectRef).toBe(DEFECT_REF);
    expect(defaultErr.symbolName).toBeUndefined();

    const customErr = new SkillAuditLiveSymbolError("Custom failure", {
      code: "CUSTOM_ERR_CODE",
      defectRef: "custom-defect-ref",
      symbolName: "analyzeRunForensics",
      filePath: "/path/to/skill-auditor.ts",
      issues: ["Symbol missing"],
    });
    expect(customErr.code).toBe("CUSTOM_ERR_CODE");
    expect(customErr.defectRef).toBe("custom-defect-ref");
    expect(customErr.symbolName).toBe("analyzeRunForensics");
    expect(customErr.filePath).toBe("/path/to/skill-auditor.ts");
    expect(customErr.issues).toEqual(["Symbol missing"]);
  });

  test("3. analyzeRunForensics handles empty or clean event streams correctly", () => {
    const emptyResult = analyzeRunForensics([]);
    expect(emptyResult.totalEvents).toBe(0);
    expect(emptyResult.incidents).toEqual([]);
    expect(emptyResult.anomaliesDetected).toBe(0);
    expect(emptyResult.efficiencyScore).toBe(100);
    expect(emptyResult.clean).toBe(true);

    const normalResult = analyzeRunForensics([
      {
        timestamp: "2026-08-29T12:00:00.000Z",
        agentId: "agent-alpha",
        agentRole: "implementer",
        tool: "view_file",
        durationMs: 50,
        tokens: { prompt: 1000, completion: 200, total: 1200 },
      },
    ]);
    expect(normalResult.totalEvents).toBe(1);
    expect(normalResult.clean).toBe(true);
    expect(normalResult.efficiencyScore).toBe(100);
    expect(normalResult.metrics.promptTokens).toBe(1000);
    expect(normalResult.metrics.completionTokens).toBe(200);
    expect(normalResult.metrics.totalTokens).toBe(1200);
    expect(normalResult.metrics.totalDurationMs).toBe(50);
  });

  test("4. analyzeRunForensics detects errors, token burning, false serialization, and role boundary deviations", () => {
    const complexResult = analyzeRunForensics([
      {
        timestamp: "2026-08-29T12:00:01.000Z",
        agentId: "agent-1",
        error: "Uncaught ReferenceError: analyzeRunForensics is not defined",
      },
      {
        timestamp: "2026-08-29T12:00:02.000Z",
        agentId: "agent-2",
        category: "TOKEN_BURNING",
        tokens: { prompt: 60000, completion: 500, total: 60500 },
      },
      {
        timestamp: "2026-08-29T12:00:03.000Z",
        agentId: "agent-3",
        kind: "FALSE_SERIALIZATION",
      },
      {
        timestamp: "2026-08-29T12:00:04.000Z",
        agentId: "agent-4",
        category: "ROLE_BOUNDARY_DEVIATION",
        tool: "orchestrate_cluster",
      },
    ]);

    expect(complexResult.totalEvents).toBe(4);
    expect(complexResult.clean).toBe(false);
    expect(complexResult.anomaliesDetected).toBe(4);
    expect(complexResult.categoriesDetected).toContain("ERROR_BURST");
    expect(complexResult.categoriesDetected).toContain("TOKEN_BURNING");
    expect(complexResult.categoriesDetected).toContain("FALSE_SERIALIZATION");
    expect(complexResult.categoriesDetected).toContain("ROLE_BOUNDARY_DEVIATION");
    expect(complexResult.efficiencyScore).toBeLessThan(100);
    expect(complexResult.metrics.errorCount).toBe(1);
    expect(complexResult.metrics.tokenBurnIncidents).toBe(1);
    expect(complexResult.metrics.falseSerializationIncidents).toBe(1);
    expect(complexResult.metrics.roleBoundaryIncidents).toBe(1);
  });

  test("5. extractDeclaredSymbols parses functions, classes, consts, and import/export blocks", () => {
    const snippet = `
      import { analyzeRunForensics, type ForensicsIncident } from "../meta/index.ts";
      const SKILL_AUDIT_FORENSICS_CATEGORIES = new Set();
      export class SkillAuditorEngine {
        static runAudit() {}
      }
      export function validateExtra() {}
      export { someHelper as aliasHelper };
    `;
    const symbols = extractDeclaredSymbols(snippet);
    expect(symbols).toContain("analyzeRunForensics");
    expect(symbols).toContain("ForensicsIncident");
    expect(symbols).toContain("SKILL_AUDIT_FORENSICS_CATEGORIES");
    expect(symbols).toContain("SkillAuditorEngine");
    expect(symbols).toContain("validateExtra");
    expect(symbols).toContain("someHelper");
    expect(extractDeclaredSymbols("")).toEqual([]);
  });

  test("6. validateSkillAuditLiveForensicsSymbols validates canonical skill-auditor module successfully", () => {
    const result = validateSkillAuditLiveForensicsSymbols();
    expect(result.defectRef).toBe(DEFECT_REF);
    expect(result.valid).toBe(true);
    expect(result.hasAnalyzeRunForensics).toBe(true);
    expect(result.missingSymbols).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.exportedSymbols).toContain("analyzeRunForensics");
    expect(result.exportedSymbols).toContain("SkillAuditorEngine");
    expect(result.exportedSymbols).toContain("SKILL_AUDIT_FORENSICS_CATEGORIES");
  });

  test("7. validateSkillAuditLiveForensicsSymbols detects missing symbols in snippet and handles non-existent paths", () => {
    const brokenSnippet = `export class OtherEngine {}`;
    const result = validateSkillAuditLiveForensicsSymbols(brokenSnippet);
    expect(result.valid).toBe(false);
    expect(result.hasAnalyzeRunForensics).toBe(false);
    expect(result.missingSymbols).toContain("analyzeRunForensics");
    expect(result.missingSymbols).toContain("SkillAuditorEngine");
    expect(result.missingSymbols).toContain("SKILL_AUDIT_FORENSICS_CATEGORIES");
    expect(result.issues.length).toBe(3);

    const nonExistentResult = validateSkillAuditLiveForensicsSymbols("/nonexistent/skill-auditor.ts");
    expect(nonExistentResult.valid).toBe(false);
    expect(nonExistentResult.issues[0]).toContain("File not found");
  });

  test("8. assertSkillAuditLiveForensicsPurity passes on valid module and throws SkillAuditLiveSymbolError on failure", () => {
    expect(() => assertSkillAuditLiveForensicsPurity()).not.toThrow();

    const brokenSource = `export function incompleteOnly() {}`;
    let thrownError: unknown;
    try {
      assertSkillAuditLiveForensicsPurity(brokenSource);
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).toBeInstanceOf(SkillAuditLiveSymbolError);
    if (thrownError instanceof SkillAuditLiveSymbolError) {
      expect(thrownError.code).toBe(UNDEFINED_FUNCTION_REFERENCE);
      expect(thrownError.defectRef).toBe(DEFECT_REF);
      expect(thrownError.symbolName).toBe("analyzeRunForensics");
    }
  });

  test("9. auditSkillAuditLiveModuleTree executes module audit and confirms resolution", () => {
    const audit = auditSkillAuditLiveModuleTree();
    expect(audit.defectRef).toBe(DEFECT_REF);
    expect(audit.errorCode).toBe(UNDEFINED_FUNCTION_REFERENCE);
    expect(audit.resolved).toBe(true);
    expect(audit.totalFiles).toBe(1);
    expect(audit.validFiles).toBe(1);
    expect(audit.invalidFiles).toBe(0);
    expect(audit.verifiedSymbols).toEqual(REQUIRED_SKILL_AUDIT_FORENSICS_SYMBOLS);
    expect(audit.sampleForensicsAnalysis.clean).toBe(true);
    expect(audit.issues).toEqual([]);
    expect(typeof audit.timestamp).toBe("string");
  });

  test("10. createSkillAuditLiveDefectEntry creates structured DefectEntry with metadata", () => {
    const defaultEntry = createSkillAuditLiveDefectEntry();
    expect(defaultEntry.domain).toBe("cognitive-auditor");
    expect(defaultEntry.error_code).toBe(UNDEFINED_FUNCTION_REFERENCE);
    expect(defaultEntry.category).toBe("code_defect");
    expect(defaultEntry.type).toBe("RUNTIME_ERROR");
    expect(defaultEntry.status).toBe("resolved");
    expect(defaultEntry.severity).toBe("high");
    expect(defaultEntry.title).toContain("analyzeRunForensics");
    expect(defaultEntry.context?.defectReference).toBe(DEFECT_REF);
    expect(defaultEntry.context?.command).toBe("skill:audit:live");

    const customEntry = createSkillAuditLiveDefectEntry({
      id: "CUSTOM-SKILL-AUDIT-DEFECT-1",
      missingSymbol: "customForensicFunc",
      status: "open",
      severity: "critical",
      observation: "Forensics function missing at runtime",
      remediation: "Add import to skill-auditor",
    });
    expect(customEntry.id).toBe("CUSTOM-SKILL-AUDIT-DEFECT-1");
    expect(customEntry.status).toBe("open");
    expect(customEntry.severity).toBe("critical");
    expect(customEntry.title).toContain("customForensicFunc");
    expect(customEntry.observation).toBe("Forensics function missing at runtime");
    expect(customEntry.remediation).toBe("Add import to skill-auditor");
  });
});
