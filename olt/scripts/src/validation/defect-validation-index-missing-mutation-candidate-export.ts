/**
 * Defect Remediation: Missing 'MutationCandidate' export from engine/index.ts in validation/index.ts
 * Defect Ref: defect-validation-index-missing-mutation-candidate-export
 * Error Code: UNEXPORTED_MEMBER_IMPORT
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DefectEntry } from "../mind/contracts/defect-contracts.ts";

export const DEFECT_REF = "defect-validation-index-missing-mutation-candidate-export" as const;
export const UNEXPORTED_MEMBER_IMPORT = "UNEXPORTED_MEMBER_IMPORT" as const;
export const CANONICAL_MUTATION_CANDIDATE_MODULE = "./mutation-gate/types.ts" as const;
export const CANONICAL_VALIDATION_INDEX_PATH = "olt/scripts/src/validation/index.ts" as const;
export const CANONICAL_MUTATION_GATE_INDEX_SPECIFIER = "./mutation-gate/index.ts" as const;
export const CANONICAL_MUTATION_GATE_TYPES_PATH =
  "olt/scripts/src/validation/mutation-gate/types.ts" as const;
export const LEGACY_ENGINE_INDEX_SPECIFIER = "./engine/index.ts" as const;
export const TARGET_MEMBER = "MutationCandidate" as const;

export const KNOWN_LEGACY_ENGINE_SPECIFIERS: readonly string[] = Object.freeze([
  "./engine/index.ts",
  "./engine/index",
  "./engine",
  "../engine/index.ts",
  "../engine",
  "engine/index.ts",
  "./engine/mutation-candidate.ts",
]);

export interface ValidationIndexIssue {
  readonly code: typeof UNEXPORTED_MEMBER_IMPORT | string;
  readonly message: string;
  readonly specifier?: string | undefined;
  readonly member?: string | undefined;
  readonly filePath?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly suggestedRemediation?: string | undefined;
}
export interface ValidationIndexExportErrorOptions {
  readonly code?: string | undefined;
  readonly defectRef?: string | undefined;
  readonly specifier?: string | undefined;
  readonly missingMember?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues?: readonly ValidationIndexIssue[] | undefined;
  readonly cause?: unknown;
}

export class ValidationIndexExportError extends Error {
  readonly code: string;
  readonly defectRef: string;
  readonly specifier?: string | undefined;
  readonly missingMember?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues: readonly ValidationIndexIssue[];
  constructor(message: string, options?: ValidationIndexExportErrorOptions) {
    super(message);
    this.name = "ValidationIndexExportError";
    this.code = options?.code ?? UNEXPORTED_MEMBER_IMPORT;
    this.defectRef = options?.defectRef ?? DEFECT_REF;
    this.specifier = options?.specifier;
    this.missingMember = options?.missingMember;
    this.filePath = options?.filePath;
    this.issues = options?.issues ?? [];
    Object.setPrototypeOf(this, ValidationIndexExportError.prototype);
  }
}

export interface ValidationIndexReExportEntry {
  readonly specifier: string;
  readonly symbols: readonly string[];
  readonly typeSymbols: readonly string[];
  readonly rawText: string;
  readonly isTypeOnly: boolean;
}
export interface ValidationIndexValidationResult {
  readonly valid: boolean;
  readonly defectRef: typeof DEFECT_REF;
  readonly filePath?: string | undefined;
  readonly legacyImportDetected: boolean;
  readonly canonicalExportPresent: boolean;
  readonly reExports: readonly ValidationIndexReExportEntry[];
  readonly issues: readonly ValidationIndexIssue[];
  readonly issueCount: number;
}
export interface ValidationIndexFileAuditResult {
  readonly filePath: string;
  readonly valid: boolean;
  readonly legacyImportDetected: boolean;
  readonly canonicalExportPresent: boolean;
  readonly issues: readonly ValidationIndexIssue[];
}
export interface ValidationIndexTreeAuditResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly errorCode: typeof UNEXPORTED_MEMBER_IMPORT;
  readonly resolved: boolean;
  readonly totalFiles: number;
  readonly validFiles: number;
  readonly invalidFiles: number;
  readonly files: readonly ValidationIndexFileAuditResult[];
  readonly verifiedModules: readonly string[];
  readonly issues: readonly string[];
  readonly timestamp: string;
}
export interface ValidationIndexAuditOptions {
  readonly extensions?: readonly string[] | undefined;
  readonly recursive?: boolean | undefined;
}
export interface CreateValidationIndexDefectEntryOptions {
  readonly id?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues?: readonly ValidationIndexIssue[] | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly status?: string | undefined;
  readonly severity?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly context?: Record<string, unknown> | undefined;
}

export function extractModuleImports(sourceCode: string): readonly string[] {
  const imports: string[] = [];
  const sRegex =
    /(?:^|\n)\s*(?:import|export)\s+(?:(?:type\s+)?(?:(?:\*\s+as\s+[\w$]+|[\w$,\s{}]+)\s+from\s+)?|)["']([^"']+)["']/g;
  const dRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = sRegex.exec(sourceCode)) !== null) if (m[1]) imports.push(m[1]);
  while ((m = dRegex.exec(sourceCode)) !== null) if (m[1]) imports.push(m[1]);
  return imports;
}

export function extractBarrelReExports(
  sourceCode: string,
): readonly ValidationIndexReExportEntry[] {
  const results: ValidationIndexReExportEntry[] = [];
  const rRegex = /(?:^|\n)\s*export\s+(type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g;
  let m: RegExpExecArray | null;
  while ((m = rRegex.exec(sourceCode)) !== null) {
    const isGlobalType = Boolean(m[1]);
    const symbols: string[] = [];
    const typeSymbols: string[] = [];
    for (const it of (m[2] ?? "").split(",")) {
      const trimmed = it.trim();
      if (!trimmed) continue;
      const isItemType = trimmed.startsWith("type ");
      const name = (
        trimmed.replace(/^type\s+/, "").split(/\s+as\s+/)[1] ??
        trimmed.replace(/^type\s+/, "").split(/\s+as\s+/)[0]
      )?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name))
        (isGlobalType || isItemType ? typeSymbols : symbols).push(name);
    }
    results.push({
      specifier: m[3] ?? "",
      symbols,
      typeSymbols,
      rawText: m[0].trim(),
      isTypeOnly: isGlobalType,
    });
  }
  return results;
}

export function isLegacyMutationCandidateImport(specifier: string, member?: string): boolean {
  if (typeof specifier !== "string" || !specifier.trim()) return false;
  const n = specifier.trim().replace(/\\/g, "/");
  const isEngine =
    n.includes("engine") ||
    KNOWN_LEGACY_ENGINE_SPECIFIERS.some((s) => n === s || n.endsWith(s.replace("./", "/")));
  return member ? member === TARGET_MEMBER && isEngine : isEngine;
}

export function remediateValidationIndexExports(
  sourceCode: string,
  options?: { canonicalModule?: string },
): string {
  const targetModule = options?.canonicalModule ?? CANONICAL_MUTATION_GATE_INDEX_SPECIFIER;
  let code = sourceCode;

  const exportStmtRegex = /export\s+(type\s+)?\{([^}]+)\}\s+from\s+["']([^"']*engine[^"']*)["'];?/g;
  code = code.replace(
    exportStmtRegex,
    (fullMatch, typeKw: string | undefined, clause: string, spec: string) => {
      const isGlobalType = Boolean(typeKw);
      const items = clause
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const engineItems: string[] = [];
      const mutationItems: string[] = [];
      for (const item of items) {
        const clean = item.replace(/^type\s+/, "").trim();
        const name = (clean.split(/\s+as\s+/)[1] ?? clean.split(/\s+as\s+/)[0])?.trim();
        if (name === TARGET_MEMBER) mutationItems.push(item);
        else engineItems.push(item);
      }
      if (mutationItems.length === 0) return fullMatch;
      const parts: string[] = [];
      if (engineItems.length > 0)
        parts.push(
          `export ${isGlobalType ? "type " : ""}{\n  ${engineItems.join(",\n  ")},\n} from "${spec}";`,
        );
      parts.push(
        `export ${isGlobalType ? "type " : ""}{ ${mutationItems.join(", ")} } from "${targetModule}";`,
      );
      return parts.join("\n");
    },
  );

  const importStmtRegex = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["']([^"']*engine[^"']*)["'];?/g;
  code = code.replace(
    importStmtRegex,
    (fullMatch, typeKw: string | undefined, clause: string, spec: string) => {
      const isGlobalType = Boolean(typeKw);
      const items = clause
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const engineItems: string[] = [];
      const mutationItems: string[] = [];
      for (const item of items) {
        const clean = item.replace(/^type\s+/, "").trim();
        const name = (clean.split(/\s+as\s+/)[1] ?? clean.split(/\s+as\s+/)[0])?.trim();
        if (name === TARGET_MEMBER) mutationItems.push(item);
        else engineItems.push(item);
      }
      if (mutationItems.length === 0) return fullMatch;
      const parts: string[] = [];
      if (engineItems.length > 0)
        parts.push(
          `import ${isGlobalType ? "type " : ""}{\n  ${engineItems.join(",\n  ")},\n} from "${spec}";`,
        );
      parts.push(
        `import ${isGlobalType ? "type " : ""}{ ${mutationItems.join(", ")} } from "${CANONICAL_MUTATION_CANDIDATE_MODULE}";`,
      );
      return parts.join("\n");
    },
  );
  return code;
}

export function validateValidationIndexExports(
  sourceCodeOrFilePath?: string,
  options?: { filePath?: string },
): ValidationIndexValidationResult {
  let content = "";
  let targetPath = options?.filePath;

  if (sourceCodeOrFilePath === undefined) {
    targetPath = resolve(process.cwd(), CANONICAL_VALIDATION_INDEX_PATH);
    if (!existsSync(targetPath))
      return {
        valid: false,
        defectRef: DEFECT_REF,
        filePath: targetPath,
        legacyImportDetected: false,
        canonicalExportPresent: false,
        reExports: [],
        issues: [
          {
            code: UNEXPORTED_MEMBER_IMPORT,
            message: `Validation index not found at ${targetPath}`,
            filePath: targetPath,
          },
        ],
        issueCount: 1,
      };
    content = readFileSync(targetPath, "utf-8");
  } else if (
    !sourceCodeOrFilePath.includes("\n") &&
    (sourceCodeOrFilePath.endsWith(".ts") ||
      sourceCodeOrFilePath.endsWith(".js") ||
      existsSync(sourceCodeOrFilePath))
  ) {
    targetPath = resolve(sourceCodeOrFilePath);
    if (!existsSync(targetPath))
      return {
        valid: false,
        defectRef: DEFECT_REF,
        filePath: targetPath,
        legacyImportDetected: false,
        canonicalExportPresent: false,
        reExports: [],
        issues: [
          {
            code: UNEXPORTED_MEMBER_IMPORT,
            message: `File not found at ${targetPath}`,
            filePath: targetPath,
          },
        ],
        issueCount: 1,
      };
    content = readFileSync(targetPath, "utf-8");
  } else {
    content = sourceCodeOrFilePath;
  }

  const reExports = extractBarrelReExports(content);
  const issues: ValidationIndexIssue[] = [];
  let legacyImportDetected = false;
  let canonicalExportPresent = false;
  const lines = content.split("\n");

  for (const rx of reExports) {
    const allSymbols = [...rx.symbols, ...rx.typeSymbols];
    if (allSymbols.includes(TARGET_MEMBER)) {
      if (isLegacyMutationCandidateImport(rx.specifier, TARGET_MEMBER)) {
        legacyImportDetected = true;
        const lineIdx = lines.findIndex((l) => l.includes(rx.specifier));
        issues.push({
          code: UNEXPORTED_MEMBER_IMPORT,
          message: `Unexported member '${TARGET_MEMBER}' imported from legacy specifier '${rx.specifier}'. Remediate to canonical '${CANONICAL_MUTATION_GATE_INDEX_SPECIFIER}' or '${CANONICAL_MUTATION_CANDIDATE_MODULE}'.`,
          specifier: rx.specifier,
          member: TARGET_MEMBER,
          filePath: targetPath,
          line: lineIdx >= 0 ? lineIdx + 1 : undefined,
          suggestedRemediation: CANONICAL_MUTATION_GATE_INDEX_SPECIFIER,
        });
      } else if (
        rx.specifier === CANONICAL_MUTATION_GATE_INDEX_SPECIFIER ||
        rx.specifier === CANONICAL_MUTATION_CANDIDATE_MODULE ||
        rx.specifier.includes("mutation-gate")
      ) {
        canonicalExportPresent = true;
      }
    }
  }

  const sImports = /(?:^|\n)\s*import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g;
  let impMatch: RegExpExecArray | null;
  while ((impMatch = sImports.exec(content)) !== null) {
    const spec = impMatch[2] ?? "";
    const clause = impMatch[1] ?? "";
    if (clause.includes(TARGET_MEMBER) && isLegacyMutationCandidateImport(spec, TARGET_MEMBER)) {
      legacyImportDetected = true;
      issues.push({
        code: UNEXPORTED_MEMBER_IMPORT,
        message: `Unexported member '${TARGET_MEMBER}' imported from legacy specifier '${spec}'.`,
        specifier: spec,
        member: TARGET_MEMBER,
        filePath: targetPath,
        suggestedRemediation: CANONICAL_MUTATION_CANDIDATE_MODULE,
      });
    }
    if (
      clause.includes(TARGET_MEMBER) &&
      (spec === CANONICAL_MUTATION_CANDIDATE_MODULE || spec.includes("mutation-gate"))
    )
      canonicalExportPresent = true;
  }

  return {
    valid: !legacyImportDetected && issues.length === 0,
    defectRef: DEFECT_REF,
    filePath: targetPath,
    legacyImportDetected,
    canonicalExportPresent,
    reExports,
    issues,
    issueCount: issues.length,
  };
}

export function assertValidationIndexExportsPurity(
  sourceCodeOrFilePath?: string,
  options?: { filePath?: string },
): void {
  const result = validateValidationIndexExports(sourceCodeOrFilePath, options);
  if (!result.valid) {
    const first = result.issues[0];
    throw new ValidationIndexExportError(
      `Validation index export purity assertion failed: ${result.issues.map((i) => i.message).join("; ")}`,
      {
        code: (first?.code as string) ?? UNEXPORTED_MEMBER_IMPORT,
        defectRef: DEFECT_REF,
        filePath: result.filePath,
        missingMember: first?.member ?? TARGET_MEMBER,
        specifier: first?.specifier,
        issues: result.issues,
      },
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

export function auditValidationIndexModuleTree(
  validationDirOrFiles?: string | readonly string[],
  options?: ValidationIndexAuditOptions,
): ValidationIndexTreeAuditResult {
  const filePaths = Array.isArray(validationDirOrFiles)
    ? [...validationDirOrFiles]
    : collectFiles(
        typeof validationDirOrFiles === "string"
          ? resolve(validationDirOrFiles)
          : resolve(process.cwd(), "olt/scripts/src/validation"),
        options?.extensions ?? [".ts", ".js"],
        options?.recursive ?? true,
      );

  const fileResults: ValidationIndexFileAuditResult[] = [];
  const allIssues: string[] = [];
  let validFiles = 0;
  let invalidFiles = 0;

  for (const fp of filePaths) {
    const validation = validateValidationIndexExports(fp);
    if (validation.valid) validFiles++;
    else {
      invalidFiles++;
      for (const issue of validation.issues) allIssues.push(`[${fp}] ${issue.message}`);
    }
    fileResults.push({
      filePath: fp,
      valid: validation.valid,
      legacyImportDetected: validation.legacyImportDetected,
      canonicalExportPresent: validation.canonicalExportPresent,
      issues: validation.issues,
    });
  }

  const canonicalTypesPath = resolve(process.cwd(), CANONICAL_MUTATION_GATE_TYPES_PATH);
  if (
    existsSync(canonicalTypesPath) &&
    !readFileSync(canonicalTypesPath, "utf-8").includes("MutationCandidate")
  ) {
    invalidFiles++;
    allIssues.push(
      `Canonical module '${CANONICAL_MUTATION_GATE_TYPES_PATH}' missing MutationCandidate definition.`,
    );
  }

  return {
    defectRef: DEFECT_REF,
    errorCode: UNEXPORTED_MEMBER_IMPORT,
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

export function createValidationIndexDefectEntry(
  options: CreateValidationIndexDefectEntryOptions = {},
): DefectEntry {
  const issues = options.issues ?? [];
  const first = issues[0];
  const filePath = options.filePath ?? first?.filePath ?? CANONICAL_VALIDATION_INDEX_PATH;

  return {
    id: options.id ?? `${DEFECT_REF}-${Date.now()}`,
    domain: "validation-modularization",
    error_code: (first?.code as string) ?? UNEXPORTED_MEMBER_IMPORT,
    title: `Unexported member '${TARGET_MEMBER}' imported from engine in validation index: ${filePath}`,
    description: `Validation index previously imported MutationCandidate from './engine/index.ts', which does not export MutationCandidate. Remediated to canonical '${CANONICAL_MUTATION_CANDIDATE_MODULE}' and '${CANONICAL_MUTATION_GATE_INDEX_SPECIFIER}'.`,
    message:
      first?.message ??
      `Unexported member '${TARGET_MEMBER}' imported from legacy engine specifier in validation index`,
    status: options.status ?? "open",
    type: "MODULARITY_VIOLATION",
    category: "modularity_violation",
    severity: options.severity ?? "high",
    observation:
      options.observation ??
      (issues.length > 0
        ? `Found ${issues.length} unexported member import issue(s) in ${filePath}`
        : `Unexported member '${TARGET_MEMBER}' referenced from engine in ${filePath}`),
    remediation:
      options.remediation ??
      `Re-export '${TARGET_MEMBER}' from canonical module '${CANONICAL_MUTATION_GATE_INDEX_SPECIFIER}' or '${CANONICAL_MUTATION_CANDIDATE_MODULE}'.`,
    context: {
      file: filePath,
      member: TARGET_MEMBER,
      canonicalModule: CANONICAL_MUTATION_CANDIDATE_MODULE,
      canonicalIndexSpecifier: CANONICAL_MUTATION_GATE_INDEX_SPECIFIER,
      issuesCount: issues.length,
      defectReference: DEFECT_REF,
      ...options.context,
    },
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}
