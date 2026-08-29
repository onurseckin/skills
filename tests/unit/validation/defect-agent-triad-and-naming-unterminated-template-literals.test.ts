import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFECT_REF_AGENT_TRIAD_AND_NAMING,
  ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR,
  AgentTriadSyntaxError,
  TS1127_ERROR_CODE,
  TS1136_ERROR_CODE,
  TS1160_ERROR_CODE,
  assertAgentTriadSyntaxPurity,
  auditAgentTriadDirectory,
  createAgentTriadSyntaxDefectEntry,
  detectAgentTriadSyntaxErrors,
  sanitizeAgentTriadSource,
  validateAgentTriadSyntax,
} from "../../../olt/scripts/src/validation/defect-agent-triad-and-naming-unterminated-template-literals.ts";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `agent-triad-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
  tempDirs.length = 0;
});

describe("Task 1.5: defect-agent-triad-and-naming-unterminated-template-literals", () => {
  test("1. constants export verified", () => {
    expect(DEFECT_REF_AGENT_TRIAD_AND_NAMING).toBe(
      "defect-agent-triad-and-naming-unterminated-template-literals",
    );
    expect(ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR).toBe("ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR");
    expect(TS1160_ERROR_CODE).toBe("TS1160");
    expect(TS1127_ERROR_CODE).toBe("TS1127");
    expect(TS1136_ERROR_CODE).toBe("TS1136");
  });

  test("2. detectAgentTriadSyntaxErrors returns empty array on clean agent template", () => {
    const clean = `
      export function buildAgentName(role: string, taskId: string): string {
        return \`\${role}_\${taskId}\`;
      }
    `;
    const issues = detectAgentTriadSyntaxErrors(clean, "naming.ts");
    expect(issues).toEqual([]);
  });

  test("3. detectAgentTriadSyntaxErrors identifies TS1160 unterminated template literal", () => {
    const broken = "export function agentTriad() {\n  return `agent_triad_ref\n}";
    const issues = detectAgentTriadSyntaxErrors(broken, "agent-triad-references.ts");
    expect(issues.length).toBeGreaterThan(0);
    const ts1160 = issues.find((i) => i.code === TS1160_ERROR_CODE);
    expect(ts1160).toBeDefined();
    expect(ts1160?.filePath).toBe("agent-triad-references.ts");
    expect(ts1160?.line).toBeGreaterThan(0);
  });

  test("4. detectAgentTriadSyntaxErrors identifies TS1127 invalid character on stray backticks", () => {
    const stray = "const agentId = \\`worker_task_123\\`;";
    const issues = detectAgentTriadSyntaxErrors(stray, "stray.ts");
    expect(issues.length).toBeGreaterThan(0);
    const hasSyntaxIssue = issues.some(
      (i) => i.code === TS1127_ERROR_CODE || i.code === TS1160_ERROR_CODE,
    );
    expect(hasSyntaxIssue).toBe(true);
  });

  test("5. detectAgentTriadSyntaxErrors identifies TS1136 / syntax errors in broken interpolation", () => {
    const brokenInterp = "const s = `agent: ${1 +`;";
    const issues = detectAgentTriadSyntaxErrors(brokenInterp, "interp.ts");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.line).toBe(1);
    expect(issues[0]?.snippet).toContain("agent:");
  });

  test("6. validateAgentTriadSyntax passes on valid agent code with clean flags", () => {
    const validSrc = "export function formatRole(role: string): string {\n  return `role:${role}`;\n}";
    const res = validateAgentTriadSyntax(validSrc, "valid.ts");
    expect(res.valid).toBe(true);
    expect(res.defectRef).toBe(DEFECT_REF_AGENT_TRIAD_AND_NAMING);
    expect(res.filePath).toBe("valid.ts");
    expect(res.issueCount).toBe(0);
    expect(res.hasUnterminatedLiterals).toBe(false);
    expect(res.hasInvalidCharacters).toBe(false);
  });

  test("7. validateAgentTriadSyntax fails with diagnostic flags on unclosed template", () => {
    const invalidSrc = "const name = `agent_worker";
    const res = validateAgentTriadSyntax(invalidSrc, "invalid.ts");
    expect(res.valid).toBe(false);
    expect(res.hasUnterminatedLiterals).toBe(true);
    expect(res.issueCount).toBeGreaterThan(0);
    expect(res.issues[0]?.code).toBe(TS1160_ERROR_CODE);
  });

  test("8. sanitizeAgentTriadSource normalizes escaped backticks in return statement", () => {
    const corrupted = "export function getRef() {\n  return \\`agent-triad-ref\\`;\n}";
    const sanitized = sanitizeAgentTriadSource(corrupted);
    expect(sanitized).toContain("return `agent-triad-ref`;");
    const val = validateAgentTriadSyntax(sanitized);
    expect(val.valid).toBe(true);
  });

  test("9. sanitizeAgentTriadSource normalizes escaped backticks in variable assignments and parens", () => {
    const corrupted = 'const ref = \\`agent_worker_42\\`;';
    const sanitized = sanitizeAgentTriadSource(corrupted);
    expect(sanitized).toBe('const ref = `agent_worker_42`;');
    const val = validateAgentTriadSyntax(sanitized);
    expect(val.valid).toBe(true);
  });

  test("10. sanitizeAgentTriadSource closes unterminated template literal before block closure", () => {
    const corrupted = "export function getValidator() {\n  return `validator_result\n}\n";
    const sanitized = sanitizeAgentTriadSource(corrupted);
    expect(sanitized).toContain("`;");
    const val = validateAgentTriadSyntax(sanitized);
    expect(val.valid).toBe(true);
  });

  test("11. sanitizeAgentTriadSource is idempotent on clean source", () => {
    const clean = "export function getName(id: string): string {\n  return `agent_${id}`;\n}";
    const sanitized = sanitizeAgentTriadSource(clean);
    expect(sanitized).toBe(clean);
    expect(validateAgentTriadSyntax(sanitized).valid).toBe(true);
  });

  test("12. assertAgentTriadSyntaxPurity does not throw on pure syntax source", () => {
    const clean = "export const agentName = `implementer_task-1.5`;";
    expect(() => assertAgentTriadSyntaxPurity(clean, "pure.ts")).not.toThrow();
  });

  test("13. assertAgentTriadSyntaxPurity throws AgentTriadSyntaxError on impure syntax", () => {
    const broken = "const agentId = `unclosed template string";
    expect(() => assertAgentTriadSyntaxPurity(broken, "impure.ts")).toThrow(
      AgentTriadSyntaxError,
    );
  });

  test("14. AgentTriadSyntaxError encapsulates code, issues, and filePath correctly", () => {
    const issue = {
      code: TS1160_ERROR_CODE,
      message: "Unterminated literal",
      line: 4,
      column: 10,
      filePath: "test.ts",
    };
    const err = new AgentTriadSyntaxError(
      "Failed validation",
      [issue],
      TS1160_ERROR_CODE,
      "test.ts",
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AgentTriadSyntaxError);
    expect(err.name).toBe("AgentTriadSyntaxError");
    expect(err.code).toBe(TS1160_ERROR_CODE);
    expect(err.filePath).toBe("test.ts");
    expect(err.issues).toHaveLength(1);
  });

  test("15. auditAgentTriadDirectory audits authority thread directory successfully", () => {
    const targetDir = join(process.cwd(), "olt/scripts/src/authority/thread");
    const audit = auditAgentTriadDirectory(targetDir);
    expect(audit.compliant).toBe(true);
    expect(audit.summary.defectRef).toBe(DEFECT_REF_AGENT_TRIAD_AND_NAMING);
    expect(audit.summary.totalFiles).toBeGreaterThanOrEqual(1);
    expect(audit.summary.validFiles).toBe(audit.summary.totalFiles);
    expect(audit.summary.invalidFiles).toBe(0);
    expect(audit.summary.totalIssues).toBe(0);
  });

  test("16. auditAgentTriadDirectory detects errors and reports non-compliant in temp directory with corrupt file", () => {
    const tempDir = createTempDir();
    writeFileSync(join(tempDir, "valid.ts"), "export const a = `ok`;\n", "utf-8");
    writeFileSync(join(tempDir, "broken.ts"), "export const b = `unterminated;\n", "utf-8");

    const audit = auditAgentTriadDirectory(tempDir);
    expect(audit.compliant).toBe(false);
    expect(audit.summary.totalFiles).toBe(2);
    expect(audit.summary.validFiles).toBe(1);
    expect(audit.summary.invalidFiles).toBe(1);
    expect(audit.summary.totalIssues).toBeGreaterThan(0);
  });

  test("17. createAgentTriadSyntaxDefectEntry generates valid structured DefectEntry", () => {
    const entry = createAgentTriadSyntaxDefectEntry({
      filePath: "olt/scripts/src/authority/thread/naming.ts",
      issues: [
        {
          code: TS1160_ERROR_CODE,
          message: "Unterminated literal",
          line: 12,
          column: 5,
          filePath: "naming.ts",
        },
      ],
    });
    expect(entry.id).toContain(DEFECT_REF_AGENT_TRIAD_AND_NAMING);
    expect(entry.domain).toBe("agent-triad-and-naming-syntax");
    expect(entry.error_code).toBe(TS1160_ERROR_CODE);
    expect(entry.status).toBe("open");
    expect(entry.type).toBe("CODE_HEALTH");
    expect(entry.category).toBe("code_defect");
    expect(entry.severity).toBe("high");
    expect(entry.context?.file).toBe("olt/scripts/src/authority/thread/naming.ts");
    expect(entry.context?.defectReference).toBe(DEFECT_REF_AGENT_TRIAD_AND_NAMING);
  });

  test("18. verifies zero TypeScript any and zero compiler suppressions across write scope", () => {
    const filesToAudit = [
      join(
        process.cwd(),
        "olt/scripts/src/validation/defect-agent-triad-and-naming-unterminated-template-literals.ts",
      ),
      join(
        process.cwd(),
        "tests/unit/validation/defect-agent-triad-and-naming-unterminated-template-literals.test.ts",
      ),
    ];

    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      ["@ts" + "-ignore", "@ts" + "-expect-error", "@ts" + "-nocheck"].join("|"),
    );

    for (const filePath of filesToAudit) {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
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
