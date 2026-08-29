/**
 * Defect Remediation: ReferenceError analyzeRunForensics is not defined in skill:audit:live
 * Defect Ref: defect-skill-audit-live-missing-analyze-run-forensics
 * Error Code: UNDEFINED_FUNCTION_REFERENCE
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DefectEntry, DefectSeverity } from "../mind/contracts/defect-contracts.ts";

export const DEFECT_REF = "defect-skill-audit-live-missing-analyze-run-forensics" as const;
export const UNDEFINED_FUNCTION_REFERENCE = "UNDEFINED_FUNCTION_REFERENCE" as const;
export const CANONICAL_SKILL_AUDIT_MODULE_PATH = "olt/scripts/src/mind/auditing/cognitive/skill-auditor.ts" as const;

export const REQUIRED_SKILL_AUDIT_FORENSICS_SYMBOLS: readonly string[] = Object.freeze([
  "analyzeRunForensics", "SkillAuditorEngine", "SKILL_AUDIT_FORENSICS_CATEGORIES",
]);

export interface RunForensicTokenUsage {
  readonly prompt?: number | undefined;
  readonly completion?: number | undefined;
  readonly total?: number | undefined;
}

export interface RunForensicEvent {
  readonly timestamp?: string | number | undefined;
  readonly type?: string | undefined;
  readonly kind?: string | undefined;
  readonly agentId?: string | undefined;
  readonly agentRole?: string | undefined;
  readonly tool?: string | undefined;
  readonly category?: string | undefined;
  readonly payload?: Record<string, unknown> | undefined;
  readonly error?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly tokens?: RunForensicTokenUsage | undefined;
}

export interface RunForensicFinding {
  readonly id: string;
  readonly category: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly title: string;
  readonly description: string;
  readonly agentId?: string | undefined;
  readonly timestamp?: string | undefined;
}

export interface RunForensicMetrics {
  readonly totalEvents: number;
  readonly totalTokens: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalDurationMs: number;
  readonly errorCount: number;
  readonly tokenBurnIncidents: number;
  readonly falseSerializationIncidents: number;
  readonly roleBoundaryIncidents: number;
}

export interface RunForensicAnalysisResult {
  readonly runId?: string | undefined;
  readonly totalEvents: number;
  readonly incidents: readonly RunForensicFinding[];
  readonly anomaliesDetected: number;
  readonly categoriesDetected: readonly string[];
  readonly efficiencyScore: number;
  readonly metrics: RunForensicMetrics;
  readonly durationMs: number;
  readonly timestamp: string;
  readonly clean: boolean;
}

export interface SkillAuditLiveSymbolErrorOptions {
  readonly code?: string | undefined;
  readonly defectRef?: string | undefined;
  readonly symbolName?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues?: readonly string[] | undefined;
  readonly cause?: unknown;
}

export class SkillAuditLiveSymbolError extends Error {
  readonly code: string;
  readonly defectRef: string;
  readonly symbolName?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues: readonly string[];

  constructor(message: string, options?: SkillAuditLiveSymbolErrorOptions) {
    super(message);
    this.name = "SkillAuditLiveSymbolError";
    this.code = options?.code ?? UNDEFINED_FUNCTION_REFERENCE;
    this.defectRef = options?.defectRef ?? DEFECT_REF;
    this.symbolName = options?.symbolName;
    this.filePath = options?.filePath;
    this.issues = options?.issues ?? [];
    Object.setPrototypeOf(this, SkillAuditLiveSymbolError.prototype);
  }
}

export function analyzeRunForensics(events: readonly RunForensicEvent[] = []): RunForensicAnalysisResult {
  const safeEvents = Array.isArray(events) ? events : [];
  const findings: RunForensicFinding[] = [];
  let totalPrompt = 0, totalCompletion = 0, totalTokens = 0, totalDuration = 0;
  let errorCount = 0, tokenBurns = 0, falseSerializations = 0, roleDeviations = 0;

  for (let i = 0; i < safeEvents.length; i++) {
    const evt = safeEvents[i];
    if (!evt) continue;
    const pTok = evt.tokens?.prompt ?? 0, cTok = evt.tokens?.completion ?? 0;
    const totTok = evt.tokens?.total ?? pTok + cTok;
    totalPrompt += pTok; totalCompletion += cTok; totalTokens += totTok;
    totalDuration += evt.durationMs ?? 0;
    const ts = String(evt.timestamp ?? new Date().toISOString());

    if (evt.error || evt.type === "ERROR" || evt.kind === "ERROR") {
      errorCount++;
      findings.push({ id: `ERR-${i + 1}`, category: "ERROR_BURST", severity: "medium", title: `Error at index ${i}`, description: evt.error ?? "Unhandled error", agentId: evt.agentId, timestamp: ts });
    }
    if (evt.category === "TOKEN_BURNING" || evt.kind === "TOKEN_BURNING" || (totTok > 50000 && pTok > 45000)) {
      tokenBurns++;
      findings.push({ id: `TB-${i + 1}`, category: "TOKEN_BURNING", severity: "high", title: `Token burning at ${i}`, description: `${totTok} tokens (${pTok} prompt)`, agentId: evt.agentId, timestamp: ts });
    }
    if (evt.category === "FALSE_SERIALIZATION" || evt.kind === "FALSE_SERIALIZATION") {
      falseSerializations++;
      findings.push({ id: `FS-${i + 1}`, category: "FALSE_SERIALIZATION", severity: "medium", title: `False serialization at ${i}`, description: "Sequential execution without parallelization", agentId: evt.agentId, timestamp: ts });
    }
    if (evt.category === "ROLE_BOUNDARY_DEVIATION" || evt.kind === "ROLE_BOUNDARY_DEVIATION") {
      roleDeviations++;
      findings.push({ id: `RBD-${i + 1}`, category: "ROLE_BOUNDARY_DEVIATION", severity: "high", title: `Role boundary deviation at ${i}`, description: `Agent '${evt.agentId ?? "unknown"}' deviated: ${evt.tool ?? "unauthorized action"}`, agentId: evt.agentId, timestamp: ts });
    }
  }

  const penalty = findings.reduce((acc, f) => acc + (f.severity === "critical" ? 25 : f.severity === "high" ? 15 : f.severity === "medium" ? 8 : 3), 0);
  return {
    totalEvents: safeEvents.length, incidents: findings, anomaliesDetected: findings.length,
    categoriesDetected: Array.from(new Set(findings.map((f) => f.category))),
    efficiencyScore: Math.max(0, Math.min(100, 100 - penalty)),
    metrics: { totalEvents: safeEvents.length, totalTokens, promptTokens: totalPrompt, completionTokens: totalCompletion, totalDurationMs: totalDuration, errorCount, tokenBurnIncidents: tokenBurns, falseSerializationIncidents: falseSerializations, roleBoundaryIncidents: roleDeviations },
    durationMs: totalDuration, timestamp: new Date().toISOString(), clean: findings.length === 0,
  };
}

export function extractDeclaredSymbols(sourceCode: string): readonly string[] {
  const symbols = new Set<string>();
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g;
  const constRegex = /(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*[:=]/g;
  const classRegex = /(?:export\s+)?class\s+([a-zA-Z0-9_$]+)/g;
  const importNamedRegex = /import\s*\{([^}]+)\}\s*from/g;
  const exportBlockRegex = /export\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(sourceCode)) !== null) if (match[1]) symbols.add(match[1]);
  while ((match = constRegex.exec(sourceCode)) !== null) if (match[1]) symbols.add(match[1]);
  while ((match = classRegex.exec(sourceCode)) !== null) if (match[1]) symbols.add(match[1]);
  while ((match = importNamedRegex.exec(sourceCode)) !== null) {
    if (match[1]) for (const p of match[1].split(",")) { const name = p.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim(); if (name) symbols.add(name); }
  }
  while ((match = exportBlockRegex.exec(sourceCode)) !== null) {
    if (match[1]) for (const p of match[1].split(",")) { const name = p.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim(); if (name) symbols.add(name); }
  }
  return Array.from(symbols).sort();
}

export interface SkillAuditLiveForensicsValidationResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly valid: boolean;
  readonly hasAnalyzeRunForensics: boolean;
  readonly exportedSymbols: readonly string[];
  readonly missingSymbols: readonly string[];
  readonly issues: readonly string[];
  readonly targetPath?: string | undefined;
}

export function validateSkillAuditLiveForensicsSymbols(sourceCodeOrFilePath?: string): SkillAuditLiveForensicsValidationResult {
  let content = "", targetPath: string | undefined;
  if (!sourceCodeOrFilePath) {
    targetPath = resolve(process.cwd(), CANONICAL_SKILL_AUDIT_MODULE_PATH);
    if (!existsSync(targetPath)) return { defectRef: DEFECT_REF, valid: false, hasAnalyzeRunForensics: false, exportedSymbols: [], missingSymbols: [...REQUIRED_SKILL_AUDIT_FORENSICS_SYMBOLS], issues: [`Skill audit live module does not exist at ${targetPath}`], targetPath };
    content = readFileSync(targetPath, "utf-8");
  } else if (!sourceCodeOrFilePath.includes("\n") && (sourceCodeOrFilePath.endsWith(".ts") || sourceCodeOrFilePath.endsWith(".js") || existsSync(sourceCodeOrFilePath))) {
    targetPath = resolve(sourceCodeOrFilePath);
    if (!existsSync(targetPath)) return { defectRef: DEFECT_REF, valid: false, hasAnalyzeRunForensics: false, exportedSymbols: [], missingSymbols: [...REQUIRED_SKILL_AUDIT_FORENSICS_SYMBOLS], issues: [`File not found at ${targetPath}`], targetPath };
    content = readFileSync(targetPath, "utf-8");
  } else {
    content = sourceCodeOrFilePath;
  }
  const declared = extractDeclaredSymbols(content);
  const missing = REQUIRED_SKILL_AUDIT_FORENSICS_SYMBOLS.filter((sym) => !declared.includes(sym));
  const issues = missing.map((sym) => `Required symbol '${sym}' is not declared, imported, or exported in skill audit live module.`);
  return { defectRef: DEFECT_REF, valid: missing.length === 0 && issues.length === 0, hasAnalyzeRunForensics: declared.includes("analyzeRunForensics"), exportedSymbols: declared, missingSymbols: missing, issues, targetPath };
}

export function assertSkillAuditLiveForensicsPurity(sourceCodeOrFilePath?: string): void {
  const result = validateSkillAuditLiveForensicsSymbols(sourceCodeOrFilePath);
  if (!result.valid) {
    throw new SkillAuditLiveSymbolError(`Skill audit live forensics symbol purity assertion failed: ${result.issues.join("; ")}`, {
      code: UNDEFINED_FUNCTION_REFERENCE, defectRef: DEFECT_REF, symbolName: result.missingSymbols[0] ?? "analyzeRunForensics", filePath: result.targetPath, issues: result.issues,
    });
  }
}

export interface SkillAuditLiveFileAuditResult {
  readonly filePath: string;
  readonly valid: boolean;
  readonly hasAnalyzeRunForensics: boolean;
  readonly issues: readonly string[];
}

export interface SkillAuditLiveModuleTreeAuditResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly errorCode: typeof UNDEFINED_FUNCTION_REFERENCE;
  readonly resolved: boolean;
  readonly totalFiles: number;
  readonly validFiles: number;
  readonly invalidFiles: number;
  readonly files: readonly SkillAuditLiveFileAuditResult[];
  readonly verifiedSymbols: readonly string[];
  readonly sampleForensicsAnalysis: RunForensicAnalysisResult;
  readonly issues: readonly string[];
  readonly timestamp: string;
}

export function auditSkillAuditLiveModuleTree(filePathOrTarget?: string | readonly string[]): SkillAuditLiveModuleTreeAuditResult {
  const targetFiles: string[] = Array.isArray(filePathOrTarget)
    ? [...filePathOrTarget]
    : typeof filePathOrTarget === "string" ? [resolve(filePathOrTarget)] : [resolve(process.cwd(), CANONICAL_SKILL_AUDIT_MODULE_PATH)];
  const fileResults: SkillAuditLiveFileAuditResult[] = [];
  const allIssues: string[] = [];
  let validCount = 0, invalidCount = 0;

  for (const fp of targetFiles) {
    const val = validateSkillAuditLiveForensicsSymbols(fp);
    if (val.valid) { validCount++; } else { invalidCount++; for (const issue of val.issues) allIssues.push(`[${fp}] ${issue}`); }
    fileResults.push({ filePath: fp, valid: val.valid, hasAnalyzeRunForensics: val.hasAnalyzeRunForensics, issues: val.issues });
  }

  const sampleResult = analyzeRunForensics([{
    timestamp: "2026-08-29T12:00:00.000Z", agentId: "agent-1", agentRole: "implementer", tool: "write_to_file", durationMs: 45, tokens: { prompt: 1200, completion: 350, total: 1550 },
  }]);

  return {
    defectRef: DEFECT_REF, errorCode: UNDEFINED_FUNCTION_REFERENCE, resolved: invalidCount === 0 && sampleResult.clean,
    totalFiles: targetFiles.length, validFiles: validCount, invalidFiles: invalidCount, files: fileResults,
    verifiedSymbols: REQUIRED_SKILL_AUDIT_FORENSICS_SYMBOLS, sampleForensicsAnalysis: sampleResult, issues: allIssues, timestamp: new Date().toISOString(),
  };
}

export interface CreateSkillAuditLiveDefectEntryOptions {
  readonly id?: string | undefined;
  readonly filePath?: string | undefined;
  readonly missingSymbol?: string | undefined;
  readonly status?: string | undefined;
  readonly severity?: DefectSeverity | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly context?: Record<string, unknown> | undefined;
}

export function createSkillAuditLiveDefectEntry(options: CreateSkillAuditLiveDefectEntryOptions = {}): DefectEntry {
  const missingSymbol = options.missingSymbol ?? "analyzeRunForensics";
  const filePath = options.filePath ?? CANONICAL_SKILL_AUDIT_MODULE_PATH;
  return {
    id: options.id ?? `${DEFECT_REF}-${Date.now()}`,
    domain: "cognitive-auditor",
    error_code: UNDEFINED_FUNCTION_REFERENCE,
    title: `ReferenceError: ${missingSymbol} is not defined in skill:audit:live`,
    description: `Remediation for missing function reference '${missingSymbol}' during skill:audit:live execution: ${filePath}`,
    message: `skill:audit:live fails at runtime with ReferenceError: ${missingSymbol} is not defined.`,
    status: options.status ?? "resolved",
    type: "RUNTIME_ERROR",
    category: "code_defect",
    severity: options.severity ?? "high",
    observation: options.observation ?? `SkillAuditorEngine calls '${missingSymbol}' which must be resolvable in ${filePath}.`,
    remediation: options.remediation ?? `Import '${missingSymbol}' from '../meta/index.ts' and ensure forensics evaluation engine is intact.`,
    context: { file: filePath, function: missingSymbol, defectReference: DEFECT_REF, mechanism: "symbol-resolution", command: "skill:audit:live", ...options.context },
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}
