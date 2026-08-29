/**
 * Defect Remediation: Type 'SugiyamaDagReport' declared locally in reporting/unified/types.ts but not exported
 * Defect Ref: defect-reporting-unified-sections-missing-sugiyama-export
 * Error Code: UNEXPORTED_TYPE_DECLARATION
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DefectEntry } from "../mind/contracts/defect-contracts.ts";
import type { CoordinatorOwnershipMetrics, DecisionAuditRow, ImplementerValidatorTrackingRow, LeaseMatrixRow, SugiyamaDagReport, SugiyamaWaveMetrics, UnifiedAgentRow, UnifiedLifecycleBreakdown, UnifiedReport, UnifiedSectionData } from "../reporting/unified/index.ts";
import { buildUnifiedReportMarkdown } from "../reporting/unified/sections.ts";

export const DEFECT_REF = "defect-reporting-unified-sections-missing-sugiyama-export" as const;
export const UNEXPORTED_TYPE_DECLARATION = "UNEXPORTED_TYPE_DECLARATION" as const;
export const ERROR_CODE = UNEXPORTED_TYPE_DECLARATION;
export const DEFECT_TITLE = "Type 'SugiyamaDagReport' declared locally in reporting/unified/types.ts but not exported" as const;
export const TARGET_UNIFIED_TYPES_PATH = "olt/scripts/src/reporting/unified/types.ts" as const;
export const TARGET_UNIFIED_SECTIONS_PATH = "olt/scripts/src/reporting/unified/sections.ts" as const;
export const TARGET_UNIFIED_INDEX_PATH = "olt/scripts/src/reporting/unified/index.ts" as const;
export const CANONICAL_SUGIYAMA_DAG_SUBPATH = "olt/scripts/src/reporting/sugiyama-dag/index.ts" as const;
export const CANONICAL_TYPE_EXPORT_SPECIFIER = "SugiyamaDagReport" as const;
export const CANONICAL_WAVE_METRICS_EXPORT_SPECIFIER = "SugiyamaWaveMetrics" as const;
export const CANONICAL_SUGIYAMA_IMPORT_STATEMENT = 'import type { SugiyamaDagReport, SugiyamaWaveMetrics } from "../sugiyama-dag/index.ts";' as const;
export const CANONICAL_SUGIYAMA_EXPORT_STATEMENT = "export type { SugiyamaDagReport, SugiyamaWaveMetrics };" as const;

export const STANDARD_UNIFIED_REPORTING_MODULES: readonly string[] = Object.freeze([
  "olt/scripts/src/reporting/unified/types.ts",
  "olt/scripts/src/reporting/unified/sections.ts",
  "olt/scripts/src/reporting/unified/table-builder.ts",
  "olt/scripts/src/reporting/unified/lifecycle-segmenter.ts",
  "olt/scripts/src/reporting/unified/leases-decisions.ts",
  "olt/scripts/src/reporting/unified/report-builder.ts",
  "olt/scripts/src/reporting/unified/index.ts",
]);

export type { CoordinatorOwnershipMetrics, DecisionAuditRow, ImplementerValidatorTrackingRow, LeaseMatrixRow, SugiyamaDagReport, SugiyamaWaveMetrics, UnifiedAgentRow, UnifiedLifecycleBreakdown, UnifiedReport, UnifiedSectionData };

export interface UnifiedSectionIssue { readonly code: typeof UNEXPORTED_TYPE_DECLARATION | string; readonly message: string; readonly specifier?: string | undefined; readonly filePath?: string | undefined; readonly suggestedRemediation?: string | undefined; }
export interface UnifiedSectionsExportErrorOptions { readonly code?: string | undefined; readonly defectRef?: string | undefined; readonly specifier?: string | undefined; readonly filePath?: string | undefined; readonly issues?: readonly UnifiedSectionIssue[] | undefined; }

export class UnifiedSectionsExportError extends Error {
  readonly code: string; readonly defectRef: string; readonly specifier?: string | undefined; readonly filePath?: string | undefined; readonly issues: readonly UnifiedSectionIssue[];
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

export interface UnifiedTypesValidationResult { readonly valid: boolean; readonly defectRef: typeof DEFECT_REF; readonly filePath?: string | undefined; readonly exportsSugiyamaDagReport: boolean; readonly exportsSugiyamaWaveMetrics: boolean; readonly importsSugiyamaFromModule: boolean; readonly exports: readonly string[]; readonly issues: readonly UnifiedSectionIssue[]; readonly issueCount: number; }
export interface UnifiedSectionsValidationResult { readonly valid: boolean; readonly defectRef: typeof DEFECT_REF; readonly filePath?: string | undefined; readonly importsSugiyamaDagReport: boolean; readonly targetTypesExportsSugiyama: boolean; readonly imports: readonly string[]; readonly issues: readonly UnifiedSectionIssue[]; readonly issueCount: number; }
export interface UnifiedReportingModuleGraphAuditResult { readonly defectRef: typeof DEFECT_REF; readonly errorCode: typeof UNEXPORTED_TYPE_DECLARATION; readonly resolved: boolean; readonly typesFileValid: boolean; readonly sectionsFileValid: boolean; readonly indexFileValid: boolean; readonly totalFiles: number; readonly verifiedModules: readonly string[]; readonly issues: readonly string[]; readonly timestamp: string; }

export function extractModuleImports(sourceCode: string): readonly string[] {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) return [];
  const imports: string[] = [];
  const staticRegex = /(?:^|\n)\s*(?:import|export)\s+(?:(?:type\s+)?(?:(?:\*\s+as\s+[\w$]+|[\w$,\s{}]+)\s+from\s+)?|)["']([^"']+)["']/g;
  const dynRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = staticRegex.exec(sourceCode)) !== null) if (m[1]) imports.push(m[1]);
  while ((m = dynRegex.exec(sourceCode)) !== null) if (m[1]) imports.push(m[1]);
  return Object.freeze(imports);
}

export function extractTypeExports(sourceCode: string): readonly string[] {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) return [];
  const exports: string[] = [];
  const bracketExportRegex = /export\s+(?:type\s+)?\{([^}]+)\}(?:\s+from\s+["'][^"']+["'])?/g;
  let m: RegExpExecArray | null;
  while ((m = bracketExportRegex.exec(sourceCode)) !== null) {
    if (m[1]) {
      for (const item of m[1].split(",")) {
        const clean = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
        if (clean) exports.push(clean);
      }
    }
  }
  const directTypeRegex = /export\s+(?:interface|type)\s+([A-Za-z0-9_$]+)/g;
  while ((m = directTypeRegex.exec(sourceCode)) !== null) {
    if (m[1] && !exports.includes(m[1])) exports.push(m[1]);
  }
  return Object.freeze(exports);
}

export function extractNamedImports(sourceCode: string, fromModule?: string): readonly string[] {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) return [];
  const importedSymbols: string[] = [];
  const importRegex = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(sourceCode)) !== null) {
    if (m[1] && m[2] && (!fromModule || m[2].includes(fromModule))) {
      for (const item of m[1].split(",")) {
        const clean = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
        if (clean) importedSymbols.push(clean);
      }
    }
  }
  return Object.freeze(importedSymbols);
}

export function hasSugiyamaDagReportExport(sourceCode: string): boolean { return extractTypeExports(sourceCode).includes("SugiyamaDagReport"); }
export function hasSugiyamaDagReportImport(sourceCode: string): boolean { return extractNamedImports(sourceCode).includes("SugiyamaDagReport"); }
export function isSugiyamaTypeExportMissing(typesSourceCode: string): boolean { return !hasSugiyamaDagReportExport(typesSourceCode); }

export function remediateUnifiedTypesSource(sourceCode: string): string {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) return sourceCode;
  let result = sourceCode;
  if (hasSugiyamaDagReportExport(result) && result.includes("sugiyama-dag")) return result;
  if (!result.includes("sugiyama-dag")) {
    const headerMatch = result.match(/^\/\*\*[\s\S]*?\*\/\n/);
    result = headerMatch ? `${result.slice(0, headerMatch[0].length)}${CANONICAL_SUGIYAMA_IMPORT_STATEMENT}\n${result.slice(headerMatch[0].length)}` : `${CANONICAL_SUGIYAMA_IMPORT_STATEMENT}\n${result}`;
  }
  if (!hasSugiyamaDagReportExport(result)) {
    const existingMatch = result.match(/export\s+type\s*\{([^}]+)\};/);
    result = existingMatch && !existingMatch[1]?.includes("SugiyamaDagReport")
      ? result.replace(existingMatch[0], existingMatch[0].replace("}", `, ${CANONICAL_TYPE_EXPORT_SPECIFIER}, ${CANONICAL_WAVE_METRICS_EXPORT_SPECIFIER} }`))
      : `${result}\n${CANONICAL_SUGIYAMA_EXPORT_STATEMENT}\n`;
  }
  return result;
}

export function remediateUnifiedSectionsSource(sourceCode: string): string {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) return sourceCode;
  let result = sourceCode;
  if (!extractNamedImports(result, "./types.ts").includes("SugiyamaDagReport")) {
    const match = result.match(/import\s+type\s*\{([^}]+)\}\s+from\s+["']\.\/types\.ts["'];/);
    if (match && match[1]) result = result.replace(match[0], `import type {\n  ${CANONICAL_TYPE_EXPORT_SPECIFIER},\n${match[1]}\n} from "./types.ts";`);
  }
  return result;
}

export function validateUnifiedTypesExports(sourceCodeOrFilePath?: string): UnifiedTypesValidationResult {
  let content = ""; let targetPath: string | undefined;
  if (sourceCodeOrFilePath === undefined) {
    targetPath = resolve(process.cwd(), TARGET_UNIFIED_TYPES_PATH);
    if (!existsSync(targetPath)) return { valid: false, defectRef: DEFECT_REF, filePath: targetPath, exportsSugiyamaDagReport: false, exportsSugiyamaWaveMetrics: false, importsSugiyamaFromModule: false, exports: [], issues: [{ code: UNEXPORTED_TYPE_DECLARATION, message: `Target types file not found at ${targetPath}`, filePath: targetPath }], issueCount: 1 };
    content = readFileSync(targetPath, "utf-8");
  } else if (!sourceCodeOrFilePath.includes("\n") && (sourceCodeOrFilePath.endsWith(".ts") || existsSync(sourceCodeOrFilePath))) {
    targetPath = resolve(sourceCodeOrFilePath);
    if (!existsSync(targetPath)) return { valid: false, defectRef: DEFECT_REF, filePath: targetPath, exportsSugiyamaDagReport: false, exportsSugiyamaWaveMetrics: false, importsSugiyamaFromModule: false, exports: [], issues: [{ code: UNEXPORTED_TYPE_DECLARATION, message: `File not found at ${targetPath}`, filePath: targetPath }], issueCount: 1 };
    content = readFileSync(targetPath, "utf-8");
  } else { content = sourceCodeOrFilePath; }
  const exports = extractTypeExports(content); const issues: UnifiedSectionIssue[] = [];
  const exportsSugiyamaDagReport = exports.includes("SugiyamaDagReport"); const exportsSugiyamaWaveMetrics = exports.includes("SugiyamaWaveMetrics");
  if (!exportsSugiyamaDagReport) issues.push({ code: UNEXPORTED_TYPE_DECLARATION, message: `Type 'SugiyamaDagReport' is not exported by '${targetPath ?? "types.ts"}'.`, specifier: "SugiyamaDagReport", filePath: targetPath, suggestedRemediation: CANONICAL_SUGIYAMA_EXPORT_STATEMENT });
  if (!exportsSugiyamaWaveMetrics) issues.push({ code: UNEXPORTED_TYPE_DECLARATION, message: `Type 'SugiyamaWaveMetrics' is not exported by '${targetPath ?? "types.ts"}'.`, specifier: "SugiyamaWaveMetrics", filePath: targetPath, suggestedRemediation: CANONICAL_SUGIYAMA_EXPORT_STATEMENT });
  return { valid: issues.length === 0, defectRef: DEFECT_REF, filePath: targetPath, exportsSugiyamaDagReport, exportsSugiyamaWaveMetrics, importsSugiyamaFromModule: extractModuleImports(content).some((i) => i.includes("sugiyama-dag")), exports, issues: Object.freeze(issues), issueCount: issues.length };
}

export function validateUnifiedSectionsImports(sectionsSourceOrPath?: string, typesSourceOrPath?: string): UnifiedSectionsValidationResult {
  let secContent = ""; let secPath: string | undefined;
  if (sectionsSourceOrPath === undefined) {
    secPath = resolve(process.cwd(), TARGET_UNIFIED_SECTIONS_PATH);
    if (!existsSync(secPath)) return { valid: false, defectRef: DEFECT_REF, filePath: secPath, importsSugiyamaDagReport: false, targetTypesExportsSugiyama: false, imports: [], issues: [{ code: UNEXPORTED_TYPE_DECLARATION, message: `Sections file not found at ${secPath}`, filePath: secPath }], issueCount: 1 };
    secContent = readFileSync(secPath, "utf-8");
  } else if (!sectionsSourceOrPath.includes("\n") && (sectionsSourceOrPath.endsWith(".ts") || existsSync(sectionsSourceOrPath))) {
    secPath = resolve(sectionsSourceOrPath);
    if (!existsSync(secPath)) return { valid: false, defectRef: DEFECT_REF, filePath: secPath, importsSugiyamaDagReport: false, targetTypesExportsSugiyama: false, imports: [], issues: [{ code: UNEXPORTED_TYPE_DECLARATION, message: `Sections file not found at ${secPath}`, filePath: secPath }], issueCount: 1 };
    secContent = readFileSync(secPath, "utf-8");
  } else { secContent = sectionsSourceOrPath; }
  const typesValidation = validateUnifiedTypesExports(typesSourceOrPath);
  const namedImports = extractNamedImports(secContent, "./types.ts");
  const importsSugiyamaDagReport = namedImports.includes("SugiyamaDagReport");
  const issues: UnifiedSectionIssue[] = [];
  if (importsSugiyamaDagReport && !typesValidation.exportsSugiyamaDagReport) {
    issues.push({ code: UNEXPORTED_TYPE_DECLARATION, message: `sections.ts imports 'SugiyamaDagReport' from './types.ts', but types.ts does not export it.`, specifier: "SugiyamaDagReport", filePath: secPath, suggestedRemediation: `Export 'SugiyamaDagReport' from ${typesValidation.filePath ?? "types.ts"}.` });
  }
  return { valid: issues.length === 0 && typesValidation.valid, defectRef: DEFECT_REF, filePath: secPath, importsSugiyamaDagReport, targetTypesExportsSugiyama: typesValidation.exportsSugiyamaDagReport, imports: namedImports, issues: Object.freeze(issues), issueCount: issues.length };
}

export function assertUnifiedSectionsExportPurity(typesSourceOrPath?: string, sectionsSourceOrPath?: string): void {
  const validation = validateUnifiedSectionsImports(sectionsSourceOrPath, typesSourceOrPath);
  if (!validation.valid) {
    const first = validation.issues[0];
    throw new UnifiedSectionsExportError(`Unified sections export purity assertion failed: ${validation.issues.map((i) => i.message).join("; ")}`, { code: (first?.code as string) ?? UNEXPORTED_TYPE_DECLARATION, defectRef: DEFECT_REF, filePath: validation.filePath, specifier: first?.specifier, issues: validation.issues });
  }
}

export function auditUnifiedReportingModuleGraph(repoRoot?: string): UnifiedReportingModuleGraphAuditResult {
  const root = resolve(repoRoot ?? process.cwd());
  const typesPath = join(root, TARGET_UNIFIED_TYPES_PATH);
  const sectionsPath = join(root, TARGET_UNIFIED_SECTIONS_PATH);
  const indexPath = join(root, TARGET_UNIFIED_INDEX_PATH);
  const checkedFiles: string[] = []; const issues: string[] = [];
  const typesRes = existsSync(typesPath) ? validateUnifiedTypesExports(typesPath) : { valid: false, issues: [{ message: `types.ts not found at ${typesPath}` }] };
  if (existsSync(typesPath)) checkedFiles.push(typesPath);
  if (!typesRes.valid) issues.push(...typesRes.issues.map((i) => `[types.ts] ${i.message}`));
  const secRes = existsSync(sectionsPath) ? validateUnifiedSectionsImports(sectionsPath, typesPath) : { valid: false, issues: [{ message: `sections.ts not found at ${sectionsPath}` }] };
  if (existsSync(sectionsPath)) checkedFiles.push(sectionsPath);
  if (!secRes.valid) issues.push(...secRes.issues.map((i) => `[sections.ts] ${i.message}`));
  let indexFileValid = false;
  if (existsSync(indexPath)) {
    checkedFiles.push(indexPath);
    indexFileValid = extractTypeExports(readFileSync(indexPath, "utf-8")).includes("SugiyamaDagReport");
    if (!indexFileValid) issues.push(`index.ts does not re-export SugiyamaDagReport`);
  } else { issues.push(`index.ts not found at ${indexPath}`); }
  return { defectRef: DEFECT_REF, errorCode: UNEXPORTED_TYPE_DECLARATION, resolved: typesRes.valid && secRes.valid && indexFileValid && issues.length === 0, typesFileValid: typesRes.valid, sectionsFileValid: secRes.valid, indexFileValid, totalFiles: checkedFiles.length, verifiedModules: Object.freeze(checkedFiles), issues: Object.freeze(issues), timestamp: new Date().toISOString() };
}

export function createUnifiedSectionsDefectEntry(options: { readonly id?: string; readonly filePath?: string; readonly issues?: readonly UnifiedSectionIssue[]; readonly status?: string; readonly severity?: string; readonly context?: Record<string, unknown> } = {}): DefectEntry {
  const issues = options.issues ?? [];
  const first = issues[0];
  const filePath = options.filePath ?? first?.filePath ?? TARGET_UNIFIED_TYPES_PATH;
  return {
    id: options.id ?? `${DEFECT_REF}-${Date.now()}`,
    domain: "reporting-unified",
    error_code: (first?.code as string) ?? UNEXPORTED_TYPE_DECLARATION,
    title: DEFECT_TITLE,
    description: "olt/scripts/src/reporting/unified/sections.ts imports SugiyamaDagReport from './types.ts', but types.ts does not export SugiyamaDagReport",
    message: first?.message ?? "Type 'SugiyamaDagReport' is declared locally in reporting/unified/types.ts but not exported",
    status: options.status ?? "open",
    type: "TYPE_DRIFT",
    category: "code_defect",
    severity: options.severity ?? "high",
    observation: issues.length > 0 ? `Found ${issues.length} unexported type issue(s) in ${filePath}` : `Unexported type declaration 'SugiyamaDagReport' detected in ${filePath}`,
    remediation: "Add 'export type { SugiyamaDagReport, SugiyamaWaveMetrics };' in reporting/unified/types.ts",
    context: { file: filePath, issuesCount: issues.length, defectReference: DEFECT_REF, targetSymbol: "SugiyamaDagReport", ...options.context },
    timestamp: new Date().toISOString(),
  };
}

export function createMockSugiyamaDagReport(overrides?: Partial<SugiyamaDagReport>): SugiyamaDagReport {
  return {
    markdown: overrides?.markdown ?? "### DAG Visualization\n```text\n[A] ──► [B]\n```",
    renderedDag: overrides?.renderedDag ?? "╭── WAVE 1 ──╮\n│ ● task-1   │\n╰────────────╯",
    layers: overrides?.layers ?? [{ rank: 0, nodes: [{ id: "task-1", label: "task-1", status: "running", dependencies: [], rank: 0, order: 0 }] }],
    nodes: overrides?.nodes ?? [{ id: "task-1", label: "task-1", status: "running", dependencies: [], rank: 0, order: 0 }],
    cycleDiagnostic: overrides?.cycleDiagnostic ?? { hasCycle: false, cyclePaths: [], cycleEdges: [], alert: "", remediation: [], cycleNodeIds: [] },
    bypassDiagnostic: overrides?.bypassDiagnostic ?? { hasBypass: false, bypasses: [], alert: "", warnings: [] },
    metrics: overrides?.metrics ?? { totalWaves: 1, maxParallelLanes: 1, criticalPathLength: 1, averageWaveConcurrency: 1, serialBottlenecks: 0, parallelEligibleChains: 0, totalWork: 1, span: 1, parallelismFactor: 1, optimalConcurrency: 1 },
    isCompiled: overrides?.isCompiled ?? true,
    graphRevision: overrides?.graphRevision ?? 1,
    totalTasks: overrides?.totalTasks ?? 1,
  };
}

export function createMockUnifiedSectionData(overrides?: Partial<UnifiedSectionData>): UnifiedSectionData {
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
    agentRows: overrides?.agentRows ?? [{ agentId: "coord-test-1", tier: 1, tierName: "Tier 1", role: "coordinator", status: "active", taskId: null, attempt: null }],
    implementersActive: overrides?.implementersActive ?? [{ taskId: "task-1", agentId: "impl-1", role: "implementer", attempt: 1, expiresAt: "2026-08-30T10:00:00Z" }],
    validatorsActive: overrides?.validatorsActive ?? [],
    submittedTaskIds: overrides?.submittedTaskIds ?? [],
    standbyTaskIds: overrides?.standbyTaskIds ?? [],
    blockedTaskIds: overrides?.blockedTaskIds ?? [],
    satisfiedTaskIds: overrides?.satisfiedTaskIds ?? [],
    repairTaskIds: overrides?.repairTaskIds ?? [],
    sugiyamaReport: overrides?.sugiyamaReport ?? createMockSugiyamaDagReport(),
    tasks: overrides?.tasks ?? [{ id: "task-1", label: "Task One", status: "running", write_scope: ["olt/scripts/src/tooling/"] }],
    trackingRows: overrides?.trackingRows ?? [{ taskId: "task-1", lane: "Lane 1", implementerId: "impl-1", validatorId: "val-1", pushes: "Pushes: 1/3", probes: "Probes: 0/3", microCycles: "Attempts: 1/3, In-Lease Repairs: 0/3", coordinator: "coord-test-1 (100%)", leaseTimer: "180s remaining" }],
    coordinatorMetrics: overrides?.coordinatorMetrics ?? { coordinatorId: "coord-test-1", totalTasks: 1, ownedTasks: 1, ownershipPct: 100, activeLeaseTimers: [{ taskId: "task-1", agentId: "impl-1", remainingSeconds: 180 }] },
    decisions: overrides?.decisions ?? [{ requirementId: "REQ-01", decision: "approved", actor: "lead-architect", timestamp: "2026-08-29T10:00:00Z", rationale: "Remediation verified" }],
    detailed: overrides?.detailed ?? true,
  };
}

export function verifyUnifiedSectionReportGeneration(data?: Partial<UnifiedSectionData>): {
  readonly markdown: string;
  readonly containsDagSection: boolean;
  readonly charCount: number;
} {
  const md = buildUnifiedReportMarkdown(createMockUnifiedSectionData(data));
  return { markdown: md, containsDagSection: md.includes("#### 4. Live Sugiyama Hierarchical DAG"), charCount: md.length };
}
