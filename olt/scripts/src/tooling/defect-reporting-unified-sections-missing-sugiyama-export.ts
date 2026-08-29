/**
 * Defect Remediation: Type 'SugiyamaDagReport' declared locally in reporting/unified/types.ts but not exported
 * Defect Ref: defect-reporting-unified-sections-missing-sugiyama-export
 * Error Code: UNEXPORTED_TYPE_DECLARATION
 *
 * Invariant:
 * The unified reporting module `olt/scripts/src/reporting/unified/types.ts` must export `SugiyamaDagReport`
 * and `SugiyamaWaveMetrics` so that consumer sections (`sections.ts`, `table-builder.ts`, `index.ts`)
 * can safely import and render live hierarchical Sugiyama DAG telemetry without compile-time or runtime export errors.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DefectEntry } from "../mind/contracts/defect-contracts.ts";
import type {
  CoordinatorOwnershipMetrics,
  DecisionAuditRow,
  ImplementerValidatorTrackingRow,
  LeaseMatrixRow,
  SugiyamaDagReport,
  SugiyamaWaveMetrics,
  UnifiedAgentRow,
  UnifiedLifecycleBreakdown,
  UnifiedReport,
  UnifiedSectionData,
} from "../reporting/unified/index.ts";
import { buildUnifiedReportMarkdown } from "../reporting/unified/sections.ts";

// ---------------------------------------------------------------------------
// Defect Constants & Error Codes
// ---------------------------------------------------------------------------

export const DEFECT_REF = "defect-reporting-unified-sections-missing-sugiyama-export" as const;
export const UNEXPORTED_TYPE_DECLARATION = "UNEXPORTED_TYPE_DECLARATION" as const;
export const ERROR_CODE = UNEXPORTED_TYPE_DECLARATION;

export const DEFECT_TITLE =
  "Type 'SugiyamaDagReport' declared locally in reporting/unified/types.ts but not exported" as const;
export const TARGET_UNIFIED_TYPES_PATH = "olt/scripts/src/reporting/unified/types.ts" as const;
export const TARGET_UNIFIED_SECTIONS_PATH = "olt/scripts/src/reporting/unified/sections.ts" as const;
export const TARGET_UNIFIED_INDEX_PATH = "olt/scripts/src/reporting/unified/index.ts" as const;
export const CANONICAL_SUGIYAMA_DAG_SUBPATH = "olt/scripts/src/reporting/sugiyama-dag/index.ts" as const;

export const CANONICAL_TYPE_EXPORT_SPECIFIER = "SugiyamaDagReport" as const;
export const CANONICAL_WAVE_METRICS_EXPORT_SPECIFIER = "SugiyamaWaveMetrics" as const;

export const CANONICAL_SUGIYAMA_IMPORT_STATEMENT =
  'import type { SugiyamaDagReport, SugiyamaWaveMetrics } from "../sugiyama-dag/index.ts";' as const;
export const CANONICAL_SUGIYAMA_EXPORT_STATEMENT =
  "export type { SugiyamaDagReport, SugiyamaWaveMetrics };" as const;

export const STANDARD_UNIFIED_REPORTING_MODULES: readonly string[] = Object.freeze([
  "olt/scripts/src/reporting/unified/types.ts",
  "olt/scripts/src/reporting/unified/sections.ts",
  "olt/scripts/src/reporting/unified/table-builder.ts",
  "olt/scripts/src/reporting/unified/lifecycle-segmenter.ts",
  "olt/scripts/src/reporting/unified/leases-decisions.ts",
  "olt/scripts/src/reporting/unified/report-builder.ts",
  "olt/scripts/src/reporting/unified/index.ts",
]);

// Re-export reporting types for consumer convenience
export type {
  CoordinatorOwnershipMetrics,
  DecisionAuditRow,
  ImplementerValidatorTrackingRow,
  LeaseMatrixRow,
  SugiyamaDagReport,
  SugiyamaWaveMetrics,
  UnifiedAgentRow,
  UnifiedLifecycleBreakdown,
  UnifiedReport,
  UnifiedSectionData,
};

// ---------------------------------------------------------------------------
// Type Definitions & Interfaces
// ---------------------------------------------------------------------------

export interface UnifiedSectionIssue {
  readonly code: typeof UNEXPORTED_TYPE_DECLARATION | string;
  readonly message: string;
  readonly specifier?: string | undefined;
  readonly filePath?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly suggestedRemediation?: string | undefined;
}

export interface UnifiedSectionsExportErrorOptions {
  readonly code?: string | undefined;
  readonly defectRef?: string | undefined;
  readonly specifier?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues?: readonly UnifiedSectionIssue[] | undefined;
  readonly cause?: unknown;
}

export class UnifiedSectionsExportError extends Error {
  readonly code: string;
  readonly defectRef: string;
  readonly specifier?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues: readonly UnifiedSectionIssue[];

  constructor(message: string, options?: UnifiedSectionsExportErrorOptions) {
    super(message);
    this.name = "UnifiedSectionsExportError";
    this.code = options?.code ?? UNEXPORTED_TYPE_DECLARATION;
    this.defectRef = options?.defectRef ?? DEFECT_REF;
    this.specifier = options?.specifier;
    this.filePath = options?.filePath;
    this.issues = options?.issues ?? [];
    Object.setPrototypeOf(this, UnifiedSectionsExportError.prototype);
  }
}

export interface UnifiedTypesValidationResult {
  readonly valid: boolean;
  readonly defectRef: typeof DEFECT_REF;
  readonly filePath?: string | undefined;
  readonly exportsSugiyamaDagReport: boolean;
  readonly exportsSugiyamaWaveMetrics: boolean;
  readonly importsSugiyamaFromModule: boolean;
  readonly exports: readonly string[];
  readonly issues: readonly UnifiedSectionIssue[];
  readonly issueCount: number;
}

export interface UnifiedSectionsValidationResult {
  readonly valid: boolean;
  readonly defectRef: typeof DEFECT_REF;
  readonly filePath?: string | undefined;
  readonly importsSugiyamaDagReport: boolean;
  readonly targetTypesExportsSugiyama: boolean;
  readonly imports: readonly string[];
  readonly issues: readonly UnifiedSectionIssue[];
  readonly issueCount: number;
}

export interface UnifiedReportingModuleGraphAuditResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly errorCode: typeof UNEXPORTED_TYPE_DECLARATION;
  readonly resolved: boolean;
  readonly typesFileValid: boolean;
  readonly sectionsFileValid: boolean;
  readonly indexFileValid: boolean;
  readonly totalFiles: number;
  readonly verifiedModules: readonly string[];
  readonly issues: readonly string[];
  readonly timestamp: string;
}

export interface CreateUnifiedSectionsDefectEntryOptions {
  readonly id?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues?: readonly UnifiedSectionIssue[] | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly status?: string | undefined;
  readonly severity?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly context?: Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// AST & Export / Import Extraction Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts all module import specifiers from source code.
 */
export function extractModuleImports(sourceCode: string): readonly string[] {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) return [];
  const imports: string[] = [];
  const staticRegex =
    /(?:^|\n)\s*(?:import|export)\s+(?:(?:type\s+)?(?:(?:\*\s+as\s+[\w$]+|[\w$,\s{}]+)\s+from\s+)?|)["']([^"']+)["']/g;
  const dynRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = staticRegex.exec(sourceCode)) !== null) {
    if (m[1]) imports.push(m[1]);
  }
  while ((m = dynRegex.exec(sourceCode)) !== null) {
    if (m[1]) imports.push(m[1]);
  }
  return Object.freeze(imports);
}

/**
 * Extracts named type exports from source code.
 */
export function extractTypeExports(sourceCode: string): readonly string[] {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) return [];
  const exports: string[] = [];

  // Match: export type { A, B } or export { type A, type B } or export type { A, B } from "..."
  const bracketExportRegex = /export\s+(?:type\s+)?\{([^}]+)\}(?:\s+from\s+["'][^"']+["'])?/g;
  let m: RegExpExecArray | null;
  while ((m = bracketExportRegex.exec(sourceCode)) !== null) {
    if (m[1]) {
      const items = m[1].split(",");
      for (const rawItem of items) {
        const trimmed = rawItem.trim();
        if (!trimmed) continue;
        // Clean "type Foo as Bar" or "Foo as Bar" or "type Foo"
        const cleanName = trimmed
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (cleanName) exports.push(cleanName);
      }
    }
  }

  // Match: export interface Foo or export type Foo = ...
  const directTypeRegex = /export\s+(?:interface|type)\s+([A-Za-z0-9_$]+)/g;
  while ((m = directTypeRegex.exec(sourceCode)) !== null) {
    if (m[1] && !exports.includes(m[1])) {
      exports.push(m[1]);
    }
  }

  return Object.freeze(exports);
}

/**
 * Extracts named imported symbols from a specific module path or generally.
 */
export function extractNamedImports(sourceCode: string, fromModule?: string): readonly string[] {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) return [];
  const importedSymbols: string[] = [];

  const importRegex = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(sourceCode)) !== null) {
    const symbolBlock = m[1];
    const moduleSpecifier = m[2];
    if (symbolBlock && moduleSpecifier) {
      if (fromModule && !moduleSpecifier.includes(fromModule)) {
        continue;
      }
      const items = symbolBlock.split(",");
      for (const item of items) {
        const clean = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
        if (clean) importedSymbols.push(clean);
      }
    }
  }

  return Object.freeze(importedSymbols);
}

/**
 * Checks whether the source code exports SugiyamaDagReport.
 */
export function hasSugiyamaDagReportExport(sourceCode: string): boolean {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) return false;
  const exports = extractTypeExports(sourceCode);
  return exports.includes("SugiyamaDagReport");
}

/**
 * Checks whether the source code imports SugiyamaDagReport.
 */
export function hasSugiyamaDagReportImport(sourceCode: string): boolean {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) return false;
  const namedImports = extractNamedImports(sourceCode);
  return namedImports.includes("SugiyamaDagReport");
}

/**
 * Checks if SugiyamaDagReport type export is missing from reporting/unified/types.ts source.
 */
export function isSugiyamaTypeExportMissing(typesSourceCode: string): boolean {
  return !hasSugiyamaDagReportExport(typesSourceCode);
}

// ---------------------------------------------------------------------------
// Remediation & Validation Logic
// ---------------------------------------------------------------------------

/**
 * Remediates `types.ts` source by ensuring `SugiyamaDagReport` and `SugiyamaWaveMetrics`
 * are imported and re-exported.
 */
export function remediateUnifiedTypesSource(sourceCode: string): string {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) return sourceCode;
  let result = sourceCode;

  const hasImport =
    result.includes('from "../sugiyama-dag/index.ts"') ||
    result.includes("from '../sugiyama-dag/index.ts'") ||
    result.includes("from '../sugiyama-dag'") ||
    result.includes('from "../sugiyama-dag"');

  const hasExport = hasSugiyamaDagReportExport(result);

  if (hasExport && hasImport) {
    return result;
  }

  if (!hasImport) {
    // Insert import after header comment or at top
    const headerMatch = result.match(/^\/\*\*[\s\S]*?\*\/\n/);
    if (headerMatch) {
      const idx = headerMatch[0].length;
      result = `${result.slice(0, idx)}${CANONICAL_SUGIYAMA_IMPORT_STATEMENT}\n${result.slice(idx)}`;
    } else {
      result = `${CANONICAL_SUGIYAMA_IMPORT_STATEMENT}\n${result}`;
    }
  }

  if (!hasExport) {
    // Check if export type { ... } statement exists to append to, or add new statement
    const existingExportTypeMatch = result.match(/export\s+type\s*\{([^}]+)\};/);
    if (existingExportTypeMatch && !existingExportTypeMatch[1]?.includes("SugiyamaDagReport")) {
      const updated = existingExportTypeMatch[0].replace(
        "}",
        `, ${CANONICAL_TYPE_EXPORT_SPECIFIER}, ${CANONICAL_WAVE_METRICS_EXPORT_SPECIFIER} }`,
      );
      result = result.replace(existingExportTypeMatch[0], updated);
    } else {
      // Append standalone export statement after imports
      result = `${result}\n${CANONICAL_SUGIYAMA_EXPORT_STATEMENT}\n`;
    }
  }

  return result;
}

/**
 * Remediates `sections.ts` source to ensure it correctly imports `SugiyamaDagReport` from `./types.ts`.
 */
export function remediateUnifiedSectionsSource(sourceCode: string): string {
  if (typeof sourceCode !== "string") return "";
  let result = sourceCode;

  const imports = extractNamedImports(result, "./types.ts");
  if (!imports.includes("SugiyamaDagReport")) {
    const importTypesBlockRegex = /import\s+type\s*\{([^}]+)\}\s+from\s+["']\.\/types\.ts["'];/;
    const match = result.match(importTypesBlockRegex);
    if (match && match[1]) {
      const updatedBlock = `import type {\n  ${CANONICAL_TYPE_EXPORT_SPECIFIER},\n${match[1]}\n} from "./types.ts";`;
      result = result.replace(match[0], updatedBlock);
    }
  }

  return result;
}

/**
 * Validates whether `types.ts` exports `SugiyamaDagReport` and `SugiyamaWaveMetrics`.
 */
export function validateUnifiedTypesExports(
  sourceCodeOrFilePath?: string,
): UnifiedTypesValidationResult {
  let content = "";
  let targetPath: string | undefined;

  if (sourceCodeOrFilePath === undefined) {
    targetPath = resolve(process.cwd(), TARGET_UNIFIED_TYPES_PATH);
    if (!existsSync(targetPath)) {
      return {
        valid: false,
        defectRef: DEFECT_REF,
        filePath: targetPath,
        exportsSugiyamaDagReport: false,
        exportsSugiyamaWaveMetrics: false,
        importsSugiyamaFromModule: false,
        exports: [],
        issues: [
          {
            code: UNEXPORTED_TYPE_DECLARATION,
            message: `Target types file not found at ${targetPath}`,
            filePath: targetPath,
          },
        ],
        issueCount: 1,
      };
    }
    content = readFileSync(targetPath, "utf-8");
  } else if (
    !sourceCodeOrFilePath.includes("\n") &&
    (sourceCodeOrFilePath.endsWith(".ts") ||
      sourceCodeOrFilePath.endsWith(".js") ||
      existsSync(sourceCodeOrFilePath))
  ) {
    targetPath = resolve(sourceCodeOrFilePath);
    if (!existsSync(targetPath)) {
      return {
        valid: false,
        defectRef: DEFECT_REF,
        filePath: targetPath,
        exportsSugiyamaDagReport: false,
        exportsSugiyamaWaveMetrics: false,
        importsSugiyamaFromModule: false,
        exports: [],
        issues: [
          {
            code: UNEXPORTED_TYPE_DECLARATION,
            message: `File not found at ${targetPath}`,
            filePath: targetPath,
          },
        ],
        issueCount: 1,
      };
    }
    content = readFileSync(targetPath, "utf-8");
  } else {
    content = sourceCodeOrFilePath;
  }

  const exports = extractTypeExports(content);
  const imports = extractModuleImports(content);
  const issues: UnifiedSectionIssue[] = [];

  const exportsSugiyamaDagReport = exports.includes("SugiyamaDagReport");
  const exportsSugiyamaWaveMetrics = exports.includes("SugiyamaWaveMetrics");
  const importsSugiyamaFromModule = imports.some(
    (imp) => imp.includes("sugiyama-dag") || imp === "../sugiyama-dag/index.ts",
  );

  if (!exportsSugiyamaDagReport) {
    issues.push({
      code: UNEXPORTED_TYPE_DECLARATION,
      message: `Type 'SugiyamaDagReport' is not exported by '${targetPath ?? "types.ts"}'.`,
      specifier: "SugiyamaDagReport",
      filePath: targetPath,
      suggestedRemediation: CANONICAL_SUGIYAMA_EXPORT_STATEMENT,
    });
  }

  if (!exportsSugiyamaWaveMetrics) {
    issues.push({
      code: UNEXPORTED_TYPE_DECLARATION,
      message: `Type 'SugiyamaWaveMetrics' is not exported by '${targetPath ?? "types.ts"}'.`,
      specifier: "SugiyamaWaveMetrics",
      filePath: targetPath,
      suggestedRemediation: CANONICAL_SUGIYAMA_EXPORT_STATEMENT,
    });
  }

  return {
    valid: issues.length === 0,
    defectRef: DEFECT_REF,
    filePath: targetPath,
    exportsSugiyamaDagReport,
    exportsSugiyamaWaveMetrics,
    importsSugiyamaFromModule,
    exports,
    issues: Object.freeze(issues),
    issueCount: issues.length,
  };
}

/**
 * Validates whether `sections.ts` imports `SugiyamaDagReport` from `types.ts` and types.ts exports it.
 */
export function validateUnifiedSectionsImports(
  sectionsSourceOrPath?: string,
  typesSourceOrPath?: string,
): UnifiedSectionsValidationResult {
  let secContent = "";
  let secPath: string | undefined;

  if (sectionsSourceOrPath === undefined) {
    secPath = resolve(process.cwd(), TARGET_UNIFIED_SECTIONS_PATH);
    if (!existsSync(secPath)) {
      return {
        valid: false,
        defectRef: DEFECT_REF,
        filePath: secPath,
        importsSugiyamaDagReport: false,
        targetTypesExportsSugiyama: false,
        imports: [],
        issues: [
          {
            code: UNEXPORTED_TYPE_DECLARATION,
            message: `Sections file not found at ${secPath}`,
            filePath: secPath,
          },
        ],
        issueCount: 1,
      };
    }
    secContent = readFileSync(secPath, "utf-8");
  } else if (
    !sectionsSourceOrPath.includes("\n") &&
    (sectionsSourceOrPath.endsWith(".ts") || existsSync(sectionsSourceOrPath))
  ) {
    secPath = resolve(sectionsSourceOrPath);
    if (!existsSync(secPath)) {
      return {
        valid: false,
        defectRef: DEFECT_REF,
        filePath: secPath,
        importsSugiyamaDagReport: false,
        targetTypesExportsSugiyama: false,
        imports: [],
        issues: [
          {
            code: UNEXPORTED_TYPE_DECLARATION,
            message: `Sections file not found at ${secPath}`,
            filePath: secPath,
          },
        ],
        issueCount: 1,
      };
    }
    secContent = readFileSync(secPath, "utf-8");
  } else {
    secContent = sectionsSourceOrPath;
  }

  const typesValidation = validateUnifiedTypesExports(typesSourceOrPath);
  const namedImports = extractNamedImports(secContent, "./types.ts");
  const importsSugiyamaDagReport = namedImports.includes("SugiyamaDagReport");
  const issues: UnifiedSectionIssue[] = [];

  if (importsSugiyamaDagReport && !typesValidation.exportsSugiyamaDagReport) {
    issues.push({
      code: UNEXPORTED_TYPE_DECLARATION,
      message: `sections.ts imports 'SugiyamaDagReport' from './types.ts', but types.ts does not export it.`,
      specifier: "SugiyamaDagReport",
      filePath: secPath,
      suggestedRemediation: `Export 'SugiyamaDagReport' from ${typesValidation.filePath ?? "types.ts"}.`,
    });
  }

  return {
    valid: issues.length === 0 && typesValidation.valid,
    defectRef: DEFECT_REF,
    filePath: secPath,
    importsSugiyamaDagReport,
    targetTypesExportsSugiyama: typesValidation.exportsSugiyamaDagReport,
    imports: namedImports,
    issues: Object.freeze(issues),
    issueCount: issues.length,
  };
}

/**
 * Asserts purity of SugiyamaDagReport export across unified reporting modules.
 */
export function assertUnifiedSectionsExportPurity(
  typesSourceOrPath?: string,
  sectionsSourceOrPath?: string,
): void {
  const validation = validateUnifiedSectionsImports(sectionsSourceOrPath, typesSourceOrPath);
  if (!validation.valid) {
    const firstIssue = validation.issues[0];
    throw new UnifiedSectionsExportError(
      `Unified sections export purity assertion failed: ${validation.issues.map((i) => i.message).join("; ")}`,
      {
        code: (firstIssue?.code as string) ?? UNEXPORTED_TYPE_DECLARATION,
        defectRef: DEFECT_REF,
        filePath: validation.filePath,
        specifier: firstIssue?.specifier,
        issues: validation.issues,
      },
    );
  }
}

/**
 * Audits all unified reporting module graphs.
 */
export function auditUnifiedReportingModuleGraph(
  repoRoot?: string,
): UnifiedReportingModuleGraphAuditResult {
  const root = resolve(repoRoot ?? process.cwd());
  const typesPath = join(root, TARGET_UNIFIED_TYPES_PATH);
  const sectionsPath = join(root, TARGET_UNIFIED_SECTIONS_PATH);
  const indexPath = join(root, TARGET_UNIFIED_INDEX_PATH);

  const checkedFiles: string[] = [];
  const issues: string[] = [];

  let typesFileValid = false;
  let sectionsFileValid = false;
  let indexFileValid = false;

  // 1. Audit types.ts
  if (existsSync(typesPath)) {
    checkedFiles.push(typesPath);
    const typesRes = validateUnifiedTypesExports(typesPath);
    typesFileValid = typesRes.valid;
    if (!typesRes.valid) {
      issues.push(...typesRes.issues.map((i) => `[types.ts] ${i.message}`));
    }
  } else {
    issues.push(`types.ts not found at ${typesPath}`);
  }

  // 2. Audit sections.ts
  if (existsSync(sectionsPath)) {
    checkedFiles.push(sectionsPath);
    const secRes = validateUnifiedSectionsImports(sectionsPath, typesPath);
    sectionsFileValid = secRes.valid;
    if (!secRes.valid) {
      issues.push(...secRes.issues.map((i) => `[sections.ts] ${i.message}`));
    }
  } else {
    issues.push(`sections.ts not found at ${sectionsPath}`);
  }

  // 3. Audit index.ts re-exporting SugiyamaDagReport
  if (existsSync(indexPath)) {
    checkedFiles.push(indexPath);
    try {
      const idxContent = readFileSync(indexPath, "utf-8");
      const idxExports = extractTypeExports(idxContent);
      if (idxExports.includes("SugiyamaDagReport")) {
        indexFileValid = true;
      } else {
        issues.push(`index.ts does not re-export SugiyamaDagReport`);
        indexFileValid = false;
      }
    } catch (err) {
      issues.push(`Failed to read index.ts: ${err instanceof Error ? err.message : String(err)}`);
      indexFileValid = false;
    }
  } else {
    issues.push(`index.ts not found at ${indexPath}`);
  }

  return {
    defectRef: DEFECT_REF,
    errorCode: UNEXPORTED_TYPE_DECLARATION,
    resolved: typesFileValid && sectionsFileValid && indexFileValid && issues.length === 0,
    typesFileValid,
    sectionsFileValid,
    indexFileValid,
    totalFiles: checkedFiles.length,
    verifiedModules: Object.freeze(checkedFiles),
    issues: Object.freeze(issues),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Constructs a spec-compliant DefectEntry.
 */
export function createUnifiedSectionsDefectEntry(
  options: CreateUnifiedSectionsDefectEntryOptions = {},
): DefectEntry {
  const issues = options.issues ?? [];
  const first = issues[0];
  const filePath = options.filePath ?? first?.filePath ?? TARGET_UNIFIED_TYPES_PATH;

  return {
    id: options.id ?? `${DEFECT_REF}-${Date.now()}`,
    domain: "reporting-unified",
    error_code: (first?.code as string) ?? UNEXPORTED_TYPE_DECLARATION,
    title: DEFECT_TITLE,
    description:
      "olt/scripts/src/reporting/unified/sections.ts imports SugiyamaDagReport from './types.ts', but types.ts does not export SugiyamaDagReport",
    message:
      first?.message ??
      "Type 'SugiyamaDagReport' is declared locally in reporting/unified/types.ts but not exported",
    status: options.status ?? "open",
    type: "TYPE_DRIFT",
    category: "code_defect",
    severity: options.severity ?? "high",
    observation:
      options.observation ??
      (issues.length > 0
        ? `Found ${issues.length} unexported type issue(s) in ${filePath}`
        : `Unexported type declaration 'SugiyamaDagReport' detected in ${filePath}`),
    remediation:
      options.remediation ??
      "Add 'export type { SugiyamaDagReport, SugiyamaWaveMetrics };' in reporting/unified/types.ts",
    context: {
      file: filePath,
      issuesCount: issues.length,
      defectReference: DEFECT_REF,
      targetSymbol: "SugiyamaDagReport",
      ...options.context,
    },
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mock Generation & Live Diagnostic Render Verifier
// ---------------------------------------------------------------------------

/**
 * Creates a mock SugiyamaDagReport with valid defaults.
 */
export function createMockSugiyamaDagReport(
  overrides?: Partial<SugiyamaDagReport>,
): SugiyamaDagReport {
  return {
    markdown: overrides?.markdown ?? "### DAG Visualization\n```text\n[A] ──► [B]\n```",
    renderedDag: overrides?.renderedDag ?? "╭── WAVE 1 ──╮\n│ ● task-1   │\n╰────────────╯",
    layers: overrides?.layers ?? [
      {
        rank: 0,
        nodes: [
          {
            id: "task-1",
            label: "task-1",
            status: "running",
            dependencies: [],
            rank: 0,
            order: 0,
          },
        ],
      },
    ],
    nodes: overrides?.nodes ?? [
      { id: "task-1", label: "task-1", status: "running", dependencies: [], rank: 0, order: 0 },
    ],
    cycleDiagnostic: overrides?.cycleDiagnostic ?? {
      hasCycle: false,
      cyclePaths: [],
      cycleEdges: [],
      alert: "",
      remediation: [],
      cycleNodeIds: [],
    },
    bypassDiagnostic: overrides?.bypassDiagnostic ?? {
      hasBypass: false,
      bypasses: [],
      alert: "",
      warnings: [],
    },
    metrics: overrides?.metrics ?? {
      totalWaves: 1,
      maxParallelLanes: 1,
      criticalPathLength: 1,
      averageWaveConcurrency: 1,
      serialBottlenecks: 0,
      parallelEligibleChains: 0,
      totalWork: 1,
      span: 1,
      parallelismFactor: 1,
      optimalConcurrency: 1,
    },
    isCompiled: overrides?.isCompiled ?? true,
    graphRevision: overrides?.graphRevision ?? 1,
    totalTasks: overrides?.totalTasks ?? 1,
  };
}

/**
 * Creates mock UnifiedSectionData with full telemetry.
 */
export function createMockUnifiedSectionData(
  overrides?: Partial<UnifiedSectionData>,
): UnifiedSectionData {
  const sugiyamaReport = overrides?.sugiyamaReport ?? createMockSugiyamaDagReport();

  const coordinatorMetrics: CoordinatorOwnershipMetrics = overrides?.coordinatorMetrics ?? {
    coordinatorId: "coord-test-1",
    totalTasks: 1,
    ownedTasks: 1,
    ownershipPct: 100,
    activeLeaseTimers: [{ taskId: "task-1", agentId: "impl-1", remainingSeconds: 180 }],
  };

  return {
    runId: overrides?.runId ?? "run-tooling-test-01",
    phase: overrides?.phase ?? "Phase 1 - Implementation",
    totalTasks: overrides?.totalTasks ?? 1,
    satisfiedCount: overrides?.satisfiedCount ?? 0,
    occupancySummary: overrides?.occupancySummary ?? "1 active slot (100% capacity)",
    doctorHealthy: overrides?.doctorHealthy ?? true,
    bunSupported: overrides?.bunSupported ?? true,
    gitignored: overrides?.gitignored ?? true,
    doctorCriticalIssues: overrides?.doctorCriticalIssues ?? [],
    doctorCosmeticIssues: overrides?.doctorCosmeticIssues ?? [],
    agentRows: overrides?.agentRows ?? [
      {
        agentId: "coord-test-1",
        tier: 1,
        tierName: "Tier 1",
        role: "coordinator",
        status: "active",
        taskId: null,
        attempt: null,
      },
    ],
    implementersActive: overrides?.implementersActive ?? [
      {
        taskId: "task-1",
        agentId: "impl-1",
        role: "implementer",
        attempt: 1,
        expiresAt: "2026-08-30T10:00:00Z",
      },
    ],
    validatorsActive: overrides?.validatorsActive ?? [],
    submittedTaskIds: overrides?.submittedTaskIds ?? [],
    standbyTaskIds: overrides?.standbyTaskIds ?? [],
    blockedTaskIds: overrides?.blockedTaskIds ?? [],
    satisfiedTaskIds: overrides?.satisfiedTaskIds ?? [],
    repairTaskIds: overrides?.repairTaskIds ?? [],
    sugiyamaReport,
    tasks: overrides?.tasks ?? [
      {
        id: "task-1",
        label: "Task One",
        status: "running",
        write_scope: ["olt/scripts/src/tooling/"],
      },
    ],
    trackingRows: overrides?.trackingRows ?? [
      {
        taskId: "task-1",
        lane: "Lane 1",
        implementerId: "impl-1",
        validatorId: "val-1",
        pushes: "Pushes: 1/3",
        probes: "Probes: 0/3",
        microCycles: "Attempts: 1/3, In-Lease Repairs: 0/3",
        coordinator: "coord-test-1 (100%)",
        leaseTimer: "180s remaining",
      },
    ],
    coordinatorMetrics,
    decisions: overrides?.decisions ?? [
      {
        requirementId: "REQ-01",
        decision: "approved",
        actor: "lead-architect",
        timestamp: "2026-08-29T10:00:00Z",
        rationale: "Remediation verified",
      },
    ],
    detailed: overrides?.detailed ?? true,
  };
}

/**
 * Renders unified report markdown using the unified section generator.
 */
export function verifyUnifiedSectionReportGeneration(data?: Partial<UnifiedSectionData>): {
  readonly markdown: string;
  readonly containsDagSection: boolean;
  readonly charCount: number;
} {
  const fullData = createMockUnifiedSectionData(data);
  const md = buildUnifiedReportMarkdown(fullData);
  return {
    markdown: md,
    containsDagSection: md.includes("#### 4. Live Sugiyama Hierarchical DAG"),
    charCount: md.length,
  };
}
