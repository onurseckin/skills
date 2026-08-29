/**
 * Defect Remediation: Missing module '../anti-mock-types.ts' imported across validation engine and rules
 * Defect Ref: defect-validation-unresolved-anti-mock-types
 * Error Code: UNRESOLVED_MODULE_IMPORT_IN_VALIDATION
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DefectEntry } from "../mind/contracts/defect-contracts.ts";

export const DEFECT_REF = "defect-validation-unresolved-anti-mock-types" as const;
export const UNRESOLVED_MODULE_IMPORT_IN_VALIDATION = "UNRESOLVED_MODULE_IMPORT_IN_VALIDATION" as const;
export const CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR = "../anti-mock/anti-mock-types.ts" as const;
export const CANONICAL_ANTI_MOCK_TYPES_FROM_ROOT = "./anti-mock/anti-mock-types.ts" as const;
export const CANONICAL_ANTI_MOCK_TYPES_SUBPATH = "anti-mock/anti-mock-types.ts" as const;
export const LEGACY_ANTI_MOCK_TYPES_IMPORT = "../anti-mock-types.ts" as const;
export const LEGACY_ANTI_MOCK_TYPES_RELATIVE = "./anti-mock-types.ts" as const;

export const STANDARD_VALIDATION_ANTI_MOCK_MODULES: readonly string[] = Object.freeze([
  "olt/scripts/src/validation/anti-mock/anti-mock-types.ts",
  "olt/scripts/src/validation/anti-mock/anti-mock-engine.ts",
  "olt/scripts/src/validation/anti-mock/assertion-floor.ts",
  "olt/scripts/src/validation/anti-mock/index.ts",
  "olt/scripts/src/validation/ast-linter/types.ts",
  "olt/scripts/src/validation/ast-linter/visitor.ts",
  "olt/scripts/src/validation/ast-linter/assertion-detectors.ts",
  "olt/scripts/src/validation/ast-linter/mock-detectors.ts",
  "olt/scripts/src/validation/mutation-gate/types.ts",
  "olt/scripts/src/validation/mutation-gate/runner.ts",
  "olt/scripts/src/validation/index.ts",
]);

export interface ValidationAntiMockIssue {
  readonly code: typeof UNRESOLVED_MODULE_IMPORT_IN_VALIDATION | string;
  readonly message: string;
  readonly specifier?: string | undefined;
  readonly filePath?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly suggestedRemediation?: string | undefined;
}

export interface ValidationAntiMockErrorOptions {
  readonly code?: string | undefined;
  readonly defectRef?: string | undefined;
  readonly specifier?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues?: readonly ValidationAntiMockIssue[] | undefined;
  readonly cause?: unknown;
}

export class ValidationAntiMockImportError extends Error {
  readonly code: string;
  readonly defectRef: string;
  readonly specifier?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues: readonly ValidationAntiMockIssue[];

  constructor(message: string, options?: ValidationAntiMockErrorOptions) {
    super(message);
    this.name = "ValidationAntiMockImportError";
    this.code = options?.code ?? UNRESOLVED_MODULE_IMPORT_IN_VALIDATION;
    this.defectRef = options?.defectRef ?? DEFECT_REF;
    this.specifier = options?.specifier;
    this.filePath = options?.filePath;
    this.issues = options?.issues ?? [];
    Object.setPrototypeOf(this, ValidationAntiMockImportError.prototype);
  }
}

export interface ValidationAntiMockValidationResult {
  readonly valid: boolean;
  readonly defectRef: typeof DEFECT_REF;
  readonly filePath?: string | undefined;
  readonly legacyImportDetected: boolean;
  readonly canonicalImportPresent: boolean;
  readonly imports: readonly string[];
  readonly issues: readonly ValidationAntiMockIssue[];
  readonly issueCount: number;
}

export interface ValidationFileAuditResult {
  readonly filePath: string;
  readonly valid: boolean;
  readonly legacyImportDetected: boolean;
  readonly canonicalImportPresent: boolean;
  readonly issues: readonly ValidationAntiMockIssue[];
}

export interface ValidationTreeAuditResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly errorCode: typeof UNRESOLVED_MODULE_IMPORT_IN_VALIDATION;
  readonly resolved: boolean;
  readonly totalFiles: number;
  readonly validFiles: number;
  readonly invalidFiles: number;
  readonly files: readonly ValidationFileAuditResult[];
  readonly verifiedModules: readonly string[];
  readonly issues: readonly string[];
  readonly timestamp: string;
}

export interface ValidationAntiMockAuditOptions {
  readonly extensions?: readonly string[] | undefined;
  readonly recursive?: boolean | undefined;
}

export interface CreateValidationAntiMockDefectEntryOptions {
  readonly id?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues?: readonly ValidationAntiMockIssue[] | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly status?: string | undefined;
  readonly severity?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly context?: Record<string, unknown> | undefined;
}

export function extractModuleImports(sourceCode: string): readonly string[] {
  const imports: string[] = [];
  const staticRegex = /(?:^|\n)\s*(?:import|export)\s+(?:(?:type\s+)?(?:(?:\*\s+as\s+[\w$]+|[\w$,\s{}]+)\s+from\s+)?|)["']([^"']+)["']/g;
  const dynRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = staticRegex.exec(sourceCode)) !== null) if (m[1]) imports.push(m[1]);
  while ((m = dynRegex.exec(sourceCode)) !== null) if (m[1]) imports.push(m[1]);
  return imports;
}

export function isLegacyAntiMockTypesImport(specifier: string, contextPath?: string): boolean {
  if (typeof specifier !== "string" || !specifier.trim()) return false;
  const n = specifier.trim().replace(/\\/g, "/");
  if (n.includes("anti-mock/anti-mock-types") || n.includes("anti-mock/index")) return false;
  if (contextPath) {
    const normCtx = contextPath.replace(/\\/g, "/");
    if ((normCtx.includes("/anti-mock/") || normCtx.endsWith("/anti-mock")) && (n === "./anti-mock-types.ts" || n === "./anti-mock-types")) return false;
  }
  return n === LEGACY_ANTI_MOCK_TYPES_IMPORT || n === LEGACY_ANTI_MOCK_TYPES_RELATIVE ||
    n === "../anti-mock-types" || n === "./anti-mock-types" || n === "anti-mock-types" || n === "anti-mock-types.ts" ||
    /(?:^|\/)\.\.?\/anti-mock-types(?:\.ts)?$/.test(n);
}

export function resolveAntiMockTypesImportPath(specifier: string, isSubdirectory = true): string {
  if (!isLegacyAntiMockTypesImport(specifier)) return specifier;
  return isSubdirectory ? CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR : CANONICAL_ANTI_MOCK_TYPES_FROM_ROOT;
}

export function remediateValidationAntiMockImports(sourceCode: string, options?: { isSubdirectory?: boolean; filePath?: string }): string {
  const target = (options?.isSubdirectory ?? true) ? CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR : CANONICAL_ANTI_MOCK_TYPES_FROM_ROOT;
  return sourceCode.replace(/(['"])((?:\.\.?\/)*anti-mock-types(?:\.ts)?)\1/g, (m, q, s: string) => (isLegacyAntiMockTypesImport(s, options?.filePath) ? `${q}${target}${q}` : m));
}

export function validateValidationAntiMockImports(sourceCodeOrFilePath?: string, options?: { isSubdirectory?: boolean; filePath?: string }): ValidationAntiMockValidationResult {
  let content = "";
  let targetPath = options?.filePath;

  if (sourceCodeOrFilePath === undefined) {
    targetPath = resolve(process.cwd(), "olt/scripts/src/validation/mutation-gate/types.ts");
    if (!existsSync(targetPath)) {
      return { valid: false, defectRef: DEFECT_REF, filePath: targetPath, legacyImportDetected: false, canonicalImportPresent: false, imports: [], issues: [{ code: UNRESOLVED_MODULE_IMPORT_IN_VALIDATION, message: `File not found at ${targetPath}`, filePath: targetPath }], issueCount: 1 };
    }
    content = readFileSync(targetPath, "utf-8");
  } else if (!sourceCodeOrFilePath.includes("\n") && (sourceCodeOrFilePath.endsWith(".ts") || sourceCodeOrFilePath.endsWith(".js") || existsSync(sourceCodeOrFilePath))) {
    targetPath = resolve(sourceCodeOrFilePath);
    if (!existsSync(targetPath)) {
      return { valid: false, defectRef: DEFECT_REF, filePath: targetPath, legacyImportDetected: false, canonicalImportPresent: false, imports: [], issues: [{ code: UNRESOLVED_MODULE_IMPORT_IN_VALIDATION, message: `File not found at ${targetPath}`, filePath: targetPath }], issueCount: 1 };
    }
    content = readFileSync(targetPath, "utf-8");
  } else {
    content = sourceCodeOrFilePath;
  }

  const imports = extractModuleImports(content);
  const issues: ValidationAntiMockIssue[] = [];
  let legacyImportDetected = false;
  let canonicalImportPresent = false;
  const lines = content.split("\n");

  for (const imp of imports) {
    if (isLegacyAntiMockTypesImport(imp, targetPath)) {
      legacyImportDetected = true;
      const lineIdx = lines.findIndex((l) => l.includes(imp));
      issues.push({
        code: UNRESOLVED_MODULE_IMPORT_IN_VALIDATION,
        message: `Unresolved legacy anti-mock-types import '${imp}' detected. Remediate to canonical '${CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR}' or '${CANONICAL_ANTI_MOCK_TYPES_FROM_ROOT}'.`,
        specifier: imp,
        filePath: targetPath,
        line: lineIdx >= 0 ? lineIdx + 1 : undefined,
        suggestedRemediation: resolveAntiMockTypesImportPath(imp, options?.isSubdirectory ?? (targetPath ? targetPath.split("/").length > 4 : true)),
      });
    }
    if (
      imp === CANONICAL_ANTI_MOCK_TYPES_FROM_SUBDIR || imp === CANONICAL_ANTI_MOCK_TYPES_FROM_ROOT ||
      imp.includes(CANONICAL_ANTI_MOCK_TYPES_SUBPATH) || (targetPath?.includes("/anti-mock/") && (imp === "./anti-mock-types.ts" || imp === "./anti-mock-types"))
    ) {
      canonicalImportPresent = true;
    }
  }

  return { valid: !legacyImportDetected && issues.length === 0, defectRef: DEFECT_REF, filePath: targetPath, legacyImportDetected, canonicalImportPresent, imports, issues, issueCount: issues.length };
}

export function assertValidationAntiMockImportsPurity(sourceCodeOrFilePath?: string, options?: { isSubdirectory?: boolean; filePath?: string }): void {
  const result = validateValidationAntiMockImports(sourceCodeOrFilePath, options);
  if (!result.valid) {
    const first = result.issues[0];
    throw new ValidationAntiMockImportError(
      `Validation anti-mock import purity assertion failed: ${result.issues.map((i) => i.message).join("; ")}`,
      { code: (first?.code as string) ?? UNRESOLVED_MODULE_IMPORT_IN_VALIDATION, defectRef: DEFECT_REF, filePath: result.filePath, specifier: first?.specifier, issues: result.issues },
    );
  }
}

function collectFiles(dir: string, exts: readonly string[], rec: boolean): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory() && rec) out.push(...collectFiles(p, exts, rec));
    else if (e.isFile() && exts.some((ext) => e.name.endsWith(ext))) out.push(p);
  }
  return out.sort();
}

export function auditValidationModuleTreeForAntiMockTypes(targetDirOrFiles?: string | readonly string[], options?: ValidationAntiMockAuditOptions): ValidationTreeAuditResult {
  const filePaths = Array.isArray(targetDirOrFiles)
    ? [...targetDirOrFiles]
    : collectFiles(
        typeof targetDirOrFiles === "string" ? resolve(targetDirOrFiles) : resolve(process.cwd(), "olt/scripts/src/validation"),
        options?.extensions ?? [".ts", ".js"],
        options?.recursive ?? true,
      );

  const fileResults: ValidationFileAuditResult[] = [];
  const allIssues: string[] = [];
  let validFiles = 0;
  let invalidFiles = 0;

  for (const fp of filePaths) {
    const validation = validateValidationAntiMockImports(fp);
    if (validation.valid) validFiles++;
    else {
      invalidFiles++;
      for (const issue of validation.issues) allIssues.push(`[${fp}] ${issue.message}`);
    }
    fileResults.push({ filePath: fp, valid: validation.valid, legacyImportDetected: validation.legacyImportDetected, canonicalImportPresent: validation.canonicalImportPresent, issues: validation.issues });
  }

  return {
    defectRef: DEFECT_REF,
    errorCode: UNRESOLVED_MODULE_IMPORT_IN_VALIDATION,
    resolved: invalidFiles === 0,
    totalFiles: filePaths.length,
    validFiles,
    invalidFiles,
    files: fileResults,
    verifiedModules: filePaths,
    issues: allIssues,
    timestamp: new Date().toISOString(),
  };
}

export function createValidationAntiMockDefectEntry(options: CreateValidationAntiMockDefectEntryOptions = {}): DefectEntry {
  const issues = options.issues ?? [];
  const first = issues[0];
  const filePath = options.filePath ?? first?.filePath ?? "olt/scripts/src/validation";

  return {
    id: options.id ?? `${DEFECT_REF}-${Date.now()}`,
    domain: "validation-modularization",
    error_code: (first?.code as string) ?? UNRESOLVED_MODULE_IMPORT_IN_VALIDATION,
    title: `Unresolved anti-mock-types module import across validation engine: ${filePath}`,
    description: "Validation modules fail to resolve '../anti-mock-types.ts' due to directory modularization into 'anti-mock/anti-mock-types.ts'",
    message: first?.message ?? "Legacy unmodularized anti-mock-types import detected in validation module graph",
    status: options.status ?? "open",
    type: "MODULARITY_VIOLATION",
    category: "modularity_violation",
    severity: options.severity ?? "high",
    observation: options.observation ?? (issues.length > 0 ? `Found ${issues.length} unresolved anti-mock import issue(s) in ${filePath}` : `Unresolved anti-mock-types import detected in ${filePath}`),
    remediation: options.remediation ?? "Update import specifiers from legacy '../anti-mock-types.ts' to canonical subpath 'anti-mock/anti-mock-types.ts'",
    context: { file: filePath, issuesCount: issues.length, defectReference: DEFECT_REF, ...options.context },
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}
