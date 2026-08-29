/**
 * Defect Remediation: Automated mechanical file splitting created meaningless *-chunkN.ts and *_partN.ts files instead of domain-semantic modularization.
 * Defect Ref: defect-mechanical-chunk-naming-anti-pattern
 * Error Code: MECHANICAL_CHUNK_NAMING_BLUNDER
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  DefectEntry,
  DefectSeverity,
  DefectStatus,
} from "../mind/contracts/defect-contracts.ts";

export const DEFECT_REF = "defect-mechanical-chunk-naming-anti-pattern" as const;
export const MECHANICAL_CHUNK_NAMING_BLUNDER = "MECHANICAL_CHUNK_NAMING_BLUNDER" as const;

export const MECHANICAL_CHUNK_PATTERNS: readonly RegExp[] = Object.freeze([
  /(?:^|[-_./\\])(?:chunk|part|piece|split|slice|segment)[-_.]?\d+(?:\.[a-zA-Z0-9]+)?$/i,
  /(?:^|[-_./\\])[a-zA-Z0-9_-]+[-_.](?:chunk|part|piece|split|slice|segment)\d+(?:\.[a-zA-Z0-9]+)?$/i,
  /(?:^|[-_./\\])(?:chunk|part|piece|split|slice|segment)\d+/i,
  /(?:^|[-_./\\])[a-zA-Z0-9_-]+[-_.](?:chunk|part)\d+/i,
]);

export interface MechanicalChunkNamingIssue {
  readonly code: typeof MECHANICAL_CHUNK_NAMING_BLUNDER;
  readonly message: string;
  readonly filePath: string;
  readonly matchedPattern?: string | undefined;
  readonly suggestedName?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly specifier?: string | undefined;
}

export interface MechanicalChunkNamingErrorOptions {
  readonly code?: string | undefined;
  readonly defectRef?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues?: readonly MechanicalChunkNamingIssue[] | undefined;
  readonly cause?: unknown;
}

export class MechanicalChunkNamingError extends Error {
  readonly code: string;
  readonly defectRef: string;
  readonly filePath?: string | undefined;
  readonly issues: readonly MechanicalChunkNamingIssue[];

  constructor(message: string, options?: MechanicalChunkNamingErrorOptions) {
    super(message);
    this.name = "MechanicalChunkNamingError";
    this.code = options?.code ?? MECHANICAL_CHUNK_NAMING_BLUNDER;
    this.defectRef = options?.defectRef ?? DEFECT_REF;
    this.filePath = options?.filePath;
    this.issues = options?.issues ?? [];
    Object.setPrototypeOf(this, MechanicalChunkNamingError.prototype);
  }
}

export interface PathSemanticValidationResult {
  readonly valid: boolean;
  readonly defectRef: typeof DEFECT_REF;
  readonly filePath: string;
  readonly isMechanicalChunk: boolean;
  readonly matchedPattern?: string | undefined;
  readonly suggestedName?: string | undefined;
  readonly issues: readonly MechanicalChunkNamingIssue[];
  readonly issueCount: number;
}

export interface RepositorySemanticAuditResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly errorCode: typeof MECHANICAL_CHUNK_NAMING_BLUNDER;
  readonly compliant: boolean;
  readonly totalFiles: number;
  readonly validFiles: number;
  readonly mechanicalChunkFiles: number;
  readonly files: readonly PathSemanticValidationResult[];
  readonly violatingPaths: readonly string[];
  readonly issues: readonly string[];
  readonly timestamp: string;
}

export interface RepositorySemanticAuditOptions {
  readonly extensions?: readonly string[] | undefined;
  readonly recursive?: boolean | undefined;
  readonly ignoreDirs?: readonly string[] | undefined;
}

export interface CreateMechanicalChunkNamingDefectEntryOptions {
  readonly id?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues?: readonly MechanicalChunkNamingIssue[] | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly status?: string | undefined;
  readonly severity?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly context?: Record<string, unknown> | undefined;
}

export interface SuggestSemanticModuleNameHints {
  readonly responsibility?: string | undefined;
  readonly fallback?: string | undefined;
}

export function suggestSemanticModuleName(
  name: string,
  hints?: SuggestSemanticModuleNameHints,
): string {
  if (typeof name !== "string" || !name.trim()) return name;
  const norm = name.replace(/\\/g, "/");
  const lastSlash = norm.lastIndexOf("/");
  const dirPrefix = lastSlash >= 0 ? norm.slice(0, lastSlash + 1) : "";
  const filePart = lastSlash >= 0 ? norm.slice(lastSlash + 1) : norm;
  const extMatch = filePart.match(/(\.(?:test|spec|d))?\.[a-zA-Z0-9]+$/);
  const ext = extMatch ? extMatch[0] : "";
  const stem = ext ? filePart.slice(0, -ext.length) : filePart;
  const chunkMatch = stem.match(/^(.+?)([-_.])(?:chunk|part|piece|split|slice|segment)[-_.]?\d+$/i);
  const standaloneMatch = stem.match(/^(?:chunk|part|piece|split|slice|segment)[-_.]?\d+$/i);
  if (!chunkMatch && !standaloneMatch) return name;

  const separator = chunkMatch ? chunkMatch[2]! : "-";
  const baseStem = chunkMatch ? chunkMatch[1]! : "module";
  let role = hints?.responsibility ?? hints?.fallback;
  if (!role) {
    const l = baseStem.toLowerCase();
    if (l.includes("memory") || l.includes("cache") || l.includes("store")) role = "storage";
    else if (l.includes("parse") || l.includes("ast")) role = "parser";
    else if (l.includes("rotat")) role = "rotator";
    else if (l.includes("valid") || l.includes("guard") || l.includes("check")) role = "validator";
    else if (l.includes("type") || l.includes("contract") || l.includes("schema")) role = "types";
    else role = "core";
  }
  return `${dirPrefix}${baseStem}${separator}${role}${ext}`;
}

function checkMechanicalPattern(nameOrPath: string): string | undefined {
  const norm = nameOrPath.replace(/\\/g, "/");
  const fileName = norm.split("/").pop() ?? norm;
  const stem = fileName.replace(/(\.(?:test|spec|d))?\.[a-zA-Z0-9]+$/, "");
  for (const pattern of MECHANICAL_CHUNK_PATTERNS) {
    if (pattern.test(stem) || pattern.test(fileName)) return pattern.source;
  }
  return undefined;
}

export function extractModuleImports(
  sourceCode: string,
): readonly { specifier: string; line: number; column: number }[] {
  if (typeof sourceCode !== "string" || !sourceCode.trim()) return [];
  const results: { specifier: string; line: number; column: number }[] = [];
  const lines = sourceCode.split("\n");
  const staticRegex =
    /(?:import|export)\s+(?:(?:type\s+)?(?:(?:\*\s+as\s+[\w$]+|[\w$,\s{}]+)\s+from\s+)?|)["']([^"']+)["']/g;
  const dynRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (let l = 0; l < lines.length; l++) {
    const lineStr = lines[l]!;
    let m: RegExpExecArray | null;
    while ((m = staticRegex.exec(lineStr)) !== null)
      if (m[1]) results.push({ specifier: m[1], line: l + 1, column: (m.index ?? 0) + 1 });
    while ((m = dynRegex.exec(lineStr)) !== null)
      if (m[1]) results.push({ specifier: m[1], line: l + 1, column: (m.index ?? 0) + 1 });
  }
  return results;
}

export function detectMechanicalChunkNaming(
  pathOrName: string,
  content?: string,
): readonly MechanicalChunkNamingIssue[] {
  const issues: MechanicalChunkNamingIssue[] = [];
  const matchedPattern = checkMechanicalPattern(pathOrName);
  if (matchedPattern) {
    issues.push({
      code: MECHANICAL_CHUNK_NAMING_BLUNDER,
      message: `Mechanical chunk naming blunder detected in path '${pathOrName}'. Refactor to domain-semantic module name.`,
      filePath: pathOrName,
      matchedPattern,
      suggestedName: suggestSemanticModuleName(pathOrName),
    });
  }
  let code = content;
  if (code === undefined && !pathOrName.includes("\n") && existsSync(pathOrName)) {
    try {
      code = readFileSync(pathOrName, "utf-8");
    } catch {
      /* ignore */
    }
  }
  if (code) {
    for (const imp of extractModuleImports(code)) {
      const impPattern = checkMechanicalPattern(imp.specifier);
      if (impPattern) {
        issues.push({
          code: MECHANICAL_CHUNK_NAMING_BLUNDER,
          message: `Mechanical chunk import specifier '${imp.specifier}' detected. Replace with domain-semantic module specifier.`,
          filePath: pathOrName,
          specifier: imp.specifier,
          matchedPattern: impPattern,
          suggestedName: suggestSemanticModuleName(imp.specifier),
          line: imp.line,
          column: imp.column,
        });
      }
    }
  }
  return issues;
}

export function validatePathSemanticNaming(
  pathOrName: string,
  content?: string,
): PathSemanticValidationResult {
  const issues = detectMechanicalChunkNaming(pathOrName, content);
  const pathIssue = issues.find((i) => !i.specifier);
  return {
    valid: issues.length === 0,
    defectRef: DEFECT_REF,
    filePath: pathOrName,
    isMechanicalChunk: pathIssue !== undefined,
    matchedPattern: pathIssue?.matchedPattern,
    suggestedName: pathIssue?.suggestedName ?? issues[0]?.suggestedName,
    issues,
    issueCount: issues.length,
  };
}

export function assertSemanticNamingPurity(pathOrName: string, content?: string): void {
  const result = validatePathSemanticNaming(pathOrName, content);
  if (!result.valid) {
    const first = result.issues[0];
    throw new MechanicalChunkNamingError(
      `Semantic naming purity assertion failed: ${result.issues.map((i) => i.message).join("; ")}`,
      {
        code: first?.code ?? MECHANICAL_CHUNK_NAMING_BLUNDER,
        defectRef: DEFECT_REF,
        filePath: pathOrName,
        issues: result.issues,
      },
    );
  }
}

function collectFiles(
  dir: string,
  exts: readonly string[],
  rec: boolean,
  ignoreDirs: readonly string[],
): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (ignoreDirs.includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory() && rec) out.push(...collectFiles(p, exts, rec, ignoreDirs));
    else if (e.isFile() && exts.some((ext) => e.name.endsWith(ext))) out.push(p);
  }
  return out.sort();
}

export function auditRepositoryForMechanicalChunkNaming(
  targetDirOrFiles?: string | readonly string[],
  options?: RepositorySemanticAuditOptions,
): RepositorySemanticAuditResult {
  const filePaths = Array.isArray(targetDirOrFiles)
    ? [...targetDirOrFiles]
    : collectFiles(
        typeof targetDirOrFiles === "string"
          ? resolve(targetDirOrFiles)
          : resolve(process.cwd(), "olt/scripts/src"),
        options?.extensions ?? [".ts", ".tsx", ".js", ".mjs"],
        options?.recursive ?? true,
        options?.ignoreDirs ?? [".git", "node_modules", "dist", ".gemini", "brain", "scratch"],
      );
  const fileResults: PathSemanticValidationResult[] = [];
  const violatingPaths: string[] = [];
  const allIssues: string[] = [];
  let validFiles = 0;
  let mechanicalChunkFiles = 0;
  for (const fp of filePaths) {
    const validation = validatePathSemanticNaming(fp);
    if (validation.valid) {
      validFiles++;
    } else {
      mechanicalChunkFiles++;
      violatingPaths.push(fp);
      for (const issue of validation.issues) allIssues.push(`[${fp}] ${issue.message}`);
    }
    fileResults.push(validation);
  }
  return {
    defectRef: DEFECT_REF,
    errorCode: MECHANICAL_CHUNK_NAMING_BLUNDER,
    compliant: mechanicalChunkFiles === 0,
    totalFiles: filePaths.length,
    validFiles,
    mechanicalChunkFiles,
    files: fileResults,
    violatingPaths,
    issues: allIssues,
    timestamp: new Date().toISOString(),
  };
}

export function createMechanicalChunkNamingDefectEntry(
  options: CreateMechanicalChunkNamingDefectEntryOptions = {},
): DefectEntry {
  const issues = options.issues ?? [];
  const first = issues[0];
  const filePath = options.filePath ?? first?.filePath ?? "olt/scripts/src";
  const validStatus: readonly DefectStatus[] = [
    "open",
    "in_progress",
    "resolved",
    "completed",
    "closed",
    "declined",
    "reopened",
  ];
  const validSeverity: readonly DefectSeverity[] = ["low", "medium", "high", "critical"];
  const status: DefectStatus = validStatus.includes(options.status as DefectStatus)
    ? (options.status as DefectStatus)
    : "open";
  const severity: DefectSeverity = validSeverity.includes(options.severity as DefectSeverity)
    ? (options.severity as DefectSeverity)
    : "high";

  return {
    id: options.id ?? `${DEFECT_REF}-${Date.now()}`,
    domain: "file-modularization-semantic-naming",
    error_code: first?.code ?? MECHANICAL_CHUNK_NAMING_BLUNDER,
    title: `Mechanical chunk naming anti-pattern detected: ${filePath}`,
    description:
      "Automated mechanical file splitting created meaningless *-chunkN.ts and *_partN.ts files instead of domain-semantic modularization.",
    message:
      first?.message ??
      "Mechanical chunk naming blunder detected; modules must be partitioned into semantic responsibilities strictly <= 300 lines.",
    status,
    type: "MODULARITY_VIOLATION",
    category: "modularity_violation",
    severity,
    observation:
      options.observation ??
      (issues.length > 0
        ? `Found ${issues.length} mechanical chunk naming issue(s) in ${filePath}`
        : `Mechanical chunk naming anti-pattern detected in ${filePath}`),
    remediation:
      options.remediation ??
      "Refactor mechanical chunks (*-chunkN.ts, *_partN.ts) into domain-semantic modules reflecting specific single responsibilities (e.g. types.ts, validator.ts, parser.ts, storage.ts) strictly <=300 lines.",
    context: {
      file: filePath,
      issuesCount: issues.length,
      defectReference: DEFECT_REF,
      ...options.context,
    },
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}
