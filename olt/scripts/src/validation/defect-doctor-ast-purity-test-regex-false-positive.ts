/**
 * Defect Remediation: Doctor AST purity engine flags regex patterns in test files as false-positive AST violations
 * Defect Ref: defect-doctor-ast-purity-test-regex-false-positive
 * Error Code: AST_PURITY_REGEX_FALSE_POSITIVE
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import type { DefectEntry, DefectSeverity } from "../mind/contracts/defect-contracts.ts";

export const DEFECT_REF = "defect-doctor-ast-purity-test-regex-false-positive" as const;
export const AST_PURITY_REGEX_FALSE_POSITIVE = "AST_PURITY_REGEX_FALSE_POSITIVE" as const;
export const CANONICAL_AST_PURITY_ENGINE_PATH = "olt/scripts/src/reporting/doctor/ast-purity-engine.ts" as const;

export const STANDARD_DOCTOR_AST_PURITY_MODULES: readonly string[] = Object.freeze([
  "olt/scripts/src/reporting/doctor/ast-purity-engine.ts",
  "olt/scripts/src/reporting/doctor/index.ts",
  "tests/unit/doctor/ast-purity-engine.test.ts",
]);

export type AstPurityViolationType = "COMPILER_SUPPRESSION_DIRECTIVE" | "EXPLICIT_ANY" | "ANY_TYPE_ASSERTION";

export interface AstPurityViolation {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
  readonly violationType: AstPurityViolationType;
  readonly nodeText: string;
  readonly message: string;
}

export interface AstPurityEvaluationErrorOptions {
  readonly code?: string | undefined;
  readonly defectRef?: string | undefined;
  readonly filePath?: string | undefined;
  readonly violations?: readonly AstPurityViolation[] | undefined;
  readonly issues?: readonly string[] | undefined;
  readonly cause?: unknown;
}

export class AstPurityEvaluationError extends Error {
  readonly code: string;
  readonly defectRef: string;
  readonly filePath: string | undefined;
  readonly violations: readonly AstPurityViolation[];
  readonly issues: readonly string[];

  constructor(message: string, options?: AstPurityEvaluationErrorOptions) {
    super(message);
    this.name = "AstPurityEvaluationError";
    this.code = options?.code ?? AST_PURITY_REGEX_FALSE_POSITIVE;
    this.defectRef = options?.defectRef ?? DEFECT_REF;
    this.filePath = options?.filePath;
    this.violations = options?.violations ?? [];
    this.issues = options?.issues ?? [];
    Object.setPrototypeOf(this, AstPurityEvaluationError.prototype);
  }
}

export interface AstPurityValidationOptions {
  readonly filePath?: string | undefined;
  readonly allowLiteralsAndRegex?: boolean | undefined;
}

export interface AstPurityValidationResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly valid: boolean;
  readonly filePath?: string | undefined;
  readonly violations: readonly AstPurityViolation[];
  readonly violationCount: number;
  readonly immunePatternsFound: number;
  readonly issues: readonly string[];
}

export interface AstPurityFileAuditResult {
  readonly filePath: string;
  readonly valid: boolean;
  readonly violations: readonly AstPurityViolation[];
  readonly immunePatternsCount: number;
  readonly issues: readonly string[];
}

export interface AstPurityAuditResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly errorCode: typeof AST_PURITY_REGEX_FALSE_POSITIVE;
  readonly resolved: boolean;
  readonly totalFiles: number;
  readonly validFiles: number;
  readonly invalidFiles: number;
  readonly totalViolations: number;
  readonly totalImmunePatterns: number;
  readonly files: readonly AstPurityFileAuditResult[];
  readonly verifiedFiles: readonly string[];
  readonly issues: readonly string[];
  readonly timestamp: string;
}

export interface AstPurityAuditOptions {
  readonly extensions?: readonly string[] | undefined;
  readonly recursive?: boolean | undefined;
}

export interface CreateAstPurityDefectEntryOptions {
  readonly id?: string | undefined;
  readonly filePath?: string | undefined;
  readonly violations?: readonly AstPurityViolation[] | undefined;
  readonly issues?: readonly string[] | undefined;
  readonly status?: string | undefined;
  readonly severity?: DefectSeverity | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly context?: Record<string, unknown> | undefined;
}

const IMMUNE_PATTERN = /(?:any|as\s+any|@ts-(?:ignore|expect-error|nocheck)|<any>)/i;

export function isAstPurityImmuneNode(node: ts.Node): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || node.kind === ts.SyntaxKind.RegularExpressionLiteral;
}

export function countImmuneAstPatterns(content: string, filePath = "anonymous.ts"): number {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  let count = 0;
  function visit(node: ts.Node): void {
    if (isAstPurityImmuneNode(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (IMMUNE_PATTERN.test(node.getText(sourceFile))) count++;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return count;
}

export function scanFileForAstPurityViolations(filePath: string, content: string): AstPurityViolation[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const violations: AstPurityViolation[] = [];
  const commentScanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, content);
  const scannedRanges = new Set<string>();
  let token = commentScanner.scan();

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    const leading = ts.getLeadingCommentRanges(content, commentScanner.getTokenPos());
    if (leading) {
      for (const c of leading) {
        const key = `${c.pos}:${c.end}`;
        if (!scannedRanges.has(key)) {
          scannedRanges.add(key);
          const raw = content.slice(c.pos, c.end);
          if (/@ts-(?:ignore|expect-error|nocheck)\b/.test(raw)) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(c.pos);
            const trimmed = raw.trim();
            violations.push({
              filePath, lineNumber: line + 1, columnNumber: character + 1,
              violationType: "COMPILER_SUPPRESSION_DIRECTIVE", nodeText: trimmed,
              message: `Banned compiler suppression directive in comment at ${filePath}:${line + 1}:${character + 1}: "${trimmed}"`,
            });
          }
        }
      }
    }
    token = commentScanner.scan();
  }

  function visit(node: ts.Node): void {
    if (isAstPurityImmuneNode(node)) return;
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const parent = node.parent;
      const isAssertion = Boolean(parent && (ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)));
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        filePath, lineNumber: line + 1, columnNumber: character + 1,
        violationType: isAssertion ? "ANY_TYPE_ASSERTION" : "EXPLICIT_ANY",
        nodeText: (isAssertion && parent ? parent : node).getText(sourceFile),
        message: isAssertion && parent
          ? `Banned 'any' type assertion at ${filePath}:${line + 1}:${character + 1} ("${parent.getText(sourceFile)}")`
          : `Explicit 'any' type prohibited at ${filePath}:${line + 1}:${character + 1}`,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

export function validateAstPurityWithoutRegexFalsePositives(sourceCodeOrFilePath?: string, options?: AstPurityValidationOptions): AstPurityValidationResult {
  let content = "";
  let targetPath = options?.filePath;

  if (sourceCodeOrFilePath === undefined) {
    targetPath = resolve(process.cwd(), CANONICAL_AST_PURITY_ENGINE_PATH);
    if (!existsSync(targetPath)) return { defectRef: DEFECT_REF, valid: false, filePath: targetPath, violations: [], violationCount: 0, immunePatternsFound: 0, issues: [`Canonical AST purity engine not found at ${targetPath}`] };
    content = readFileSync(targetPath, "utf-8");
  } else if (!sourceCodeOrFilePath.includes("\n") && (sourceCodeOrFilePath.endsWith(".ts") || sourceCodeOrFilePath.endsWith(".tsx") || existsSync(sourceCodeOrFilePath))) {
    targetPath = resolve(sourceCodeOrFilePath);
    if (!existsSync(targetPath)) return { defectRef: DEFECT_REF, valid: false, filePath: targetPath, violations: [], violationCount: 0, immunePatternsFound: 0, issues: [`File not found at ${targetPath}`] };
    content = readFileSync(targetPath, "utf-8");
  } else {
    content = sourceCodeOrFilePath;
  }

  const effectivePath = targetPath ?? "anonymous.ts";
  const violations = scanFileForAstPurityViolations(effectivePath, content);
  const immunePatternsFound = countImmuneAstPatterns(content, effectivePath);
  return { defectRef: DEFECT_REF, valid: violations.length === 0, filePath: targetPath, violations, violationCount: violations.length, immunePatternsFound, issues: violations.map((v) => v.message) };
}

export function assertAstPurityEngineCompliance(sourceCodeOrFilePath?: string, options?: AstPurityValidationOptions): void {
  const result = validateAstPurityWithoutRegexFalsePositives(sourceCodeOrFilePath, options);
  if (!result.valid) {
    throw new AstPurityEvaluationError(`AST purity engine compliance assertion failed: ${result.issues.join("; ")}`, {
      code: AST_PURITY_REGEX_FALSE_POSITIVE, defectRef: DEFECT_REF, filePath: result.filePath, violations: result.violations, issues: result.issues,
    });
  }
}

function collectTsFiles(dir: string, exts: readonly string[], rec: boolean): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory() && rec) out.push(...collectTsFiles(p, exts, rec));
    else if (e.isFile() && exts.some((ext) => e.name.endsWith(ext))) out.push(p);
  }
  return out.sort();
}

export function auditDoctorAstPurityEngine(targetDirOrFiles?: string | readonly string[], options?: AstPurityAuditOptions): AstPurityAuditResult {
  const filePaths: string[] = [];
  if (Array.isArray(targetDirOrFiles)) {
    filePaths.push(...targetDirOrFiles.map((f) => resolve(f)));
  } else if (typeof targetDirOrFiles === "string") {
    const full = resolve(targetDirOrFiles);
    if (existsSync(full)) {
      const st = statSync(full);
      if (st.isDirectory()) filePaths.push(...collectTsFiles(full, options?.extensions ?? [".ts", ".tsx"], options?.recursive ?? true));
      else filePaths.push(full);
    }
  } else {
    for (const rel of STANDARD_DOCTOR_AST_PURITY_MODULES) {
      const full = resolve(process.cwd(), rel);
      if (existsSync(full)) filePaths.push(full);
    }
  }

  const fileResults: AstPurityFileAuditResult[] = [];
  const allIssues: string[] = [];
  let validFiles = 0;
  let invalidFiles = 0;
  let totalViolations = 0;
  let totalImmunePatterns = 0;

  for (const fp of filePaths) {
    const val = validateAstPurityWithoutRegexFalsePositives(fp);
    totalImmunePatterns += val.immunePatternsFound;
    totalViolations += val.violations.length;
    if (val.valid) validFiles++;
    else {
      invalidFiles++;
      for (const issue of val.issues) allIssues.push(`[${fp}] ${issue}`);
    }
    fileResults.push({ filePath: fp, valid: val.valid, violations: val.violations, immunePatternsCount: val.immunePatternsFound, issues: val.issues });
  }

  return {
    defectRef: DEFECT_REF, errorCode: AST_PURITY_REGEX_FALSE_POSITIVE, resolved: invalidFiles === 0,
    totalFiles: filePaths.length, validFiles, invalidFiles, totalViolations, totalImmunePatterns,
    files: fileResults, verifiedFiles: filePaths, issues: allIssues, timestamp: new Date().toISOString(),
  };
}

export function createAstPurityDefectEntry(options: CreateAstPurityDefectEntryOptions = {}): DefectEntry {
  const filePath = options.filePath ?? CANONICAL_AST_PURITY_ENGINE_PATH;
  const violations = options.violations ?? [];
  const issues = options.issues ?? violations.map((v) => v.message);

  return {
    id: options.id ?? `${DEFECT_REF}-${Date.now()}`,
    domain: "doctor-ast-purity",
    error_code: AST_PURITY_REGEX_FALSE_POSITIVE,
    title: `Doctor AST purity engine flags regex patterns in test files as false-positive AST violations: ${filePath}`,
    description: "Doctor AST purity validator flags RegExp patterns and string assertions in test suites as type violations",
    message: issues[0] ?? "RegExp patterns and assertion strings in tests falsely triggered AST purity violations",
    status: options.status ?? "resolved",
    type: "DOCTOR_FINDING",
    category: "code_defect",
    severity: options.severity ?? "high",
    observation: options.observation ?? (violations.length > 0 ? `Found ${violations.length} AST violation(s) in ${filePath}` : `AST purity engine evaluated regex patterns in test files without false positives`),
    remediation: options.remediation ?? "Use native TypeScript Compiler AST tokenization ignoring string literals, template literals, and regex literals",
    context: { file: filePath, defectReference: DEFECT_REF, rule: "native-ast-compiler-tokenization", mechanism: "literal-and-regex-immunity", violationsCount: violations.length, ...options.context },
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}
