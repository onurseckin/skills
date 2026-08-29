/**
 * Defect Remediation: Unresolved import './paths-and-io.ts' in authority/session/index.ts
 * Defect Ref: defect-authority-session-unresolved-paths-and-io
 * Error Code: UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DefectEntry } from "../mind/contracts/defect-contracts.ts";

export const DEFECT_REF = "defect-authority-session-unresolved-paths-and-io" as const;
export const UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY = "UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY" as const;
export const CANONICAL_SESSION_PATHS_SPECIFIER = "./paths.ts" as const;
export const CANONICAL_SESSION_IO_SPECIFIER = "./io.ts" as const;
export const LEGACY_SESSION_PATHS_AND_IO_SPECIFIER = "./paths-and-io.ts" as const;
export const KNOWN_AUTHORITY_SESSION_ENTRY = "olt/scripts/src/authority/session/index.ts" as const;

export const PATHS_EXPORT_SYMBOLS: readonly string[] = Object.freeze([
  "assertRealDirectory", "assertSafeSessionComponent", "assertSessionPid",
  "assertSingleLinkRegular", "noFollow", "openVerifiedDirectory",
  "resolveGlobalSessionsDir", "resolveSessionRepositoryRoot", "sameInode",
]);

export const IO_EXPORT_SYMBOLS: readonly string[] = Object.freeze([
  "atomicSessionWrite", "formatSafeErrorCause", "inferCanExecute",
  "readOwnDataString", "readPersistedSession", "restoreSnapshotIfUnchanged",
  "secureReadSession", "snapshotSession", "withSessionAuthorityLock",
]);

const PATHS_SYMBOLS_SET = new Set(PATHS_EXPORT_SYMBOLS);
const IO_SYMBOLS_SET = new Set(IO_EXPORT_SYMBOLS);

export interface AuthoritySessionImportErrorOptions {
  readonly code?: string | undefined;
  readonly defectRef?: string | undefined;
  readonly specifier?: string | undefined;
  readonly filePath?: string | undefined;
  readonly cause?: unknown;
}

export class AuthoritySessionImportError extends Error {
  readonly code: string;
  readonly defectRef: string;
  readonly specifier: string | undefined;
  readonly filePath: string | undefined;

  constructor(message: string, options?: AuthoritySessionImportErrorOptions) {
    super(message);
    this.name = "AuthoritySessionImportError";
    this.code = options?.code ?? UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY;
    this.defectRef = options?.defectRef ?? DEFECT_REF;
    this.specifier = options?.specifier;
    this.filePath = options?.filePath;
    Object.setPrototypeOf(this, AuthoritySessionImportError.prototype);
  }
}

export interface AuthoritySessionImportValidationResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly valid: boolean;
  readonly legacyImportDetected: boolean;
  readonly canonicalPathsPresent: boolean;
  readonly canonicalIoPresent: boolean;
  readonly imports: readonly string[];
  readonly issues: readonly string[];
  readonly targetPath?: string | undefined;
}

export interface AuthoritySessionTreeAuditResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly errorCode: typeof UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY;
  readonly resolved: boolean;
  readonly entryFile: string;
  readonly canonicalPathsFound: boolean;
  readonly canonicalIoFound: boolean;
  readonly legacyModuleDetected: boolean;
  readonly verifiedModules: readonly string[];
  readonly pathsSymbolsCount: number;
  readonly ioSymbolsCount: number;
  readonly totalExportedSymbols: number;
  readonly issues: readonly string[];
  readonly timestamp: string;
}

export interface CreateAuthoritySessionDefectEntryOptions {
  readonly id?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues?: readonly string[] | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly status?: string | undefined;
  readonly severity?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly specifier?: string | undefined;
}

export function extractModuleImports(sourceCode: string): readonly string[] {
  if (typeof sourceCode !== "string" || sourceCode.trim() === "") return [];
  const imports: string[] = [];
  const staticRegex = /(?:^|\n)\s*(?:import|export)\s+(?:(?:type\s+)?(?:(?:\*\s+as\s+[\w$]+|[\w$,\s{}]+)\s+from\s+)?|)["']([^"']+)["']/g;
  const dynamicRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = staticRegex.exec(sourceCode)) !== null) {
    if (match[1]) imports.push(match[1]);
  }
  while ((match = dynamicRegex.exec(sourceCode)) !== null) {
    if (match[1]) imports.push(match[1]);
  }
  return imports;
}

export function isLegacyPathsAndIoImport(importPathOrSpecifier: string): boolean {
  if (typeof importPathOrSpecifier !== "string" || importPathOrSpecifier.trim() === "") return false;
  const normalized = importPathOrSpecifier.trim().replace(/\\/g, "/");
  return (
    normalized.includes("paths-and-io") ||
    normalized === "./paths-and-io.ts" || normalized === "./paths-and-io" ||
    normalized === "../paths-and-io.ts" || normalized === "../paths-and-io" ||
    normalized.endsWith("/paths-and-io.ts") || normalized.endsWith("/paths-and-io")
  );
}

export function remediateAuthoritySessionImports(sourceCode: string): string {
  if (!isLegacyPathsAndIoImport(sourceCode) && !sourceCode.includes("paths-and-io")) return sourceCode;
  const stmtRegex = /(import|export)\s+(type\s+)?(\{[\s\S]*?\}|\*\s+as\s+[\w$]+|\*)\s+from\s+['"]([^'"]*paths-and-io(?:\.ts)?)['"];?/g;
  let result = sourceCode.replace(stmtRegex, (_m, kw: string, typeKw: string | undefined, clause: string, spec: string) => {
    const pfx = `${kw} ${typeKw ? "type " : ""}`;
    if (clause.startsWith("{") && clause.endsWith("}")) {
      const items = clause.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
      const paths: string[] = [];
      const io: string[] = [];
      const others: string[] = [];
      for (const item of items) {
        const base = item.split(/\s+as\s+/)[0]?.trim() ?? item;
        if (PATHS_SYMBOLS_SET.has(base)) paths.push(item);
        else if (IO_SYMBOLS_SET.has(base)) io.push(item);
        else others.push(item);
      }
      const stmts: string[] = [];
      if (paths.length > 0) stmts.push(`${pfx}{ ${paths.join(", ")} } from "./paths.ts";`);
      if (io.length > 0) stmts.push(`${pfx}{ ${io.join(", ")} } from "./io.ts";`);
      if (others.length > 0 && stmts.length === 0) stmts.push(`${pfx}{ ${others.join(", ")} } from "./paths.ts";`);
      return stmts.join("\n");
    }
    if (clause.startsWith("*")) return `${pfx}* from "./paths.ts";\n${pfx}* from "./io.ts";`;
    return _m.replace(spec, "./paths.ts");
  });
  result = result.replace(/import\s+['"]([^'"]*paths-and-io(?:\.ts)?)['"];?/g, 'import "./paths.ts";\nimport "./io.ts";');
  result = result.replace(/(['"])(?:\.\/|\.\.\/)*paths-and-io(?:\.ts)?\1/g, `"${CANONICAL_SESSION_PATHS_SPECIFIER}"`);
  return result;
}

export function validateAuthoritySessionImports(sourceCodeOrFilePath?: string): AuthoritySessionImportValidationResult {
  let content = "";
  let targetPath: string | undefined;
  if (!sourceCodeOrFilePath) {
    targetPath = resolve(process.cwd(), KNOWN_AUTHORITY_SESSION_ENTRY);
    if (!existsSync(targetPath)) {
      return { defectRef: DEFECT_REF, valid: false, legacyImportDetected: false, canonicalPathsPresent: false, canonicalIoPresent: false, imports: [], issues: [`Authority session entry file does not exist at ${targetPath}`], targetPath };
    }
    content = readFileSync(targetPath, "utf-8");
  } else if (!sourceCodeOrFilePath.includes("\n") && (sourceCodeOrFilePath.endsWith(".ts") || sourceCodeOrFilePath.endsWith(".js") || existsSync(sourceCodeOrFilePath))) {
    targetPath = resolve(sourceCodeOrFilePath);
    if (!existsSync(targetPath)) {
      return { defectRef: DEFECT_REF, valid: false, legacyImportDetected: false, canonicalPathsPresent: false, canonicalIoPresent: false, imports: [], issues: [`File not found at ${targetPath}`], targetPath };
    }
    content = readFileSync(targetPath, "utf-8");
  } else {
    content = sourceCodeOrFilePath;
  }

  const imports = extractModuleImports(content);
  const issues: string[] = [];
  let legacyImportDetected = false;
  let canonicalPathsPresent = false;
  let canonicalIoPresent = false;

  for (const imp of imports) {
    if (isLegacyPathsAndIoImport(imp)) {
      legacyImportDetected = true;
      issues.push(`Unresolved legacy paths-and-io import '${imp}' detected. Should be split into '${CANONICAL_SESSION_PATHS_SPECIFIER}' and '${CANONICAL_SESSION_IO_SPECIFIER}'.`);
    }
    if (imp === CANONICAL_SESSION_PATHS_SPECIFIER || imp.endsWith("/paths.ts") || imp === "./paths") canonicalPathsPresent = true;
    if (imp === CANONICAL_SESSION_IO_SPECIFIER || imp.endsWith("/io.ts") || imp === "./io") canonicalIoPresent = true;
  }

  const valid = !legacyImportDetected && issues.length === 0;
  return { defectRef: DEFECT_REF, valid, legacyImportDetected, canonicalPathsPresent, canonicalIoPresent, imports, issues, targetPath };
}

export function assertAuthoritySessionImportsPurity(sourceCodeOrFilePath?: string): void {
  const result = validateAuthoritySessionImports(sourceCodeOrFilePath);
  if (!result.valid) {
    throw new AuthoritySessionImportError(`Authority session imports validation failed: ${result.issues.join("; ")}`, {
      code: UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY,
      defectRef: DEFECT_REF,
      filePath: result.targetPath,
      specifier: result.legacyImportDetected ? LEGACY_SESSION_PATHS_AND_IO_SPECIFIER : undefined,
    });
  }
}

export function auditAuthoritySessionModuleTree(sessionDirOrEntryPath?: string): AuthoritySessionTreeAuditResult {
  const defaultEntry = resolve(process.cwd(), KNOWN_AUTHORITY_SESSION_ENTRY);
  let entryFile = defaultEntry;
  let sessionDir = dirname(defaultEntry);

  if (sessionDirOrEntryPath) {
    const resolvedPath = resolve(sessionDirOrEntryPath);
    if (existsSync(resolvedPath)) {
      if (resolvedPath.endsWith(".ts") || resolvedPath.endsWith(".js")) {
        entryFile = resolvedPath;
        sessionDir = dirname(resolvedPath);
      } else {
        sessionDir = resolvedPath;
        entryFile = join(sessionDir, "index.ts");
      }
    } else {
      entryFile = resolvedPath;
      sessionDir = dirname(resolvedPath);
    }
  }

  const issues: string[] = [];
  const verifiedModules: string[] = [];
  const canonicalPathsFound = existsSync(join(sessionDir, "paths.ts"));
  const canonicalIoFound = existsSync(join(sessionDir, "io.ts"));
  const legacyModuleDetected = existsSync(join(sessionDir, "paths-and-io.ts"));

  if (!canonicalPathsFound) issues.push(`Canonical paths module missing at ${join(sessionDir, "paths.ts")}`);
  if (!canonicalIoFound) issues.push(`Canonical io module missing at ${join(sessionDir, "io.ts")}`);
  if (legacyModuleDetected) issues.push(`Unresolved legacy paths-and-io.ts file still present at ${join(sessionDir, "paths-and-io.ts")}`);

  if (existsSync(sessionDir)) {
    for (const name of readdirSync(sessionDir)) {
      if (name.endsWith(".ts")) verifiedModules.push(join(sessionDir, name));
    }
  }

  const validation = validateAuthoritySessionImports(entryFile);
  if (!validation.valid) issues.push(...validation.issues);

  const pathsSymbolsCount = PATHS_EXPORT_SYMBOLS.length;
  const ioSymbolsCount = IO_EXPORT_SYMBOLS.length;
  const totalExportedSymbols = pathsSymbolsCount + ioSymbolsCount;
  const resolved = canonicalPathsFound && canonicalIoFound && !legacyModuleDetected && validation.valid && issues.length === 0;

  return {
    defectRef: DEFECT_REF,
    errorCode: UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY,
    resolved,
    entryFile,
    canonicalPathsFound,
    canonicalIoFound,
    legacyModuleDetected,
    verifiedModules: verifiedModules.sort(),
    pathsSymbolsCount,
    ioSymbolsCount,
    totalExportedSymbols,
    issues,
    timestamp: new Date().toISOString(),
  };
}

export function createAuthoritySessionDefectEntry(options: CreateAuthoritySessionDefectEntryOptions = {}): DefectEntry {
  const filePath = options.filePath ?? KNOWN_AUTHORITY_SESSION_ENTRY;
  const issues = options.issues ?? [];
  const specifier = options.specifier ?? LEGACY_SESSION_PATHS_AND_IO_SPECIFIER;

  return {
    id: options.id ?? `${DEFECT_REF}-${Date.now()}`,
    domain: "authority-session",
    error_code: UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY,
    title: `Unresolved module import '${specifier}' in authority session`,
    description: `Authority session module graph remediation: unresolved '${specifier}' separated into canonical '${CANONICAL_SESSION_PATHS_SPECIFIER}' and '${CANONICAL_SESSION_IO_SPECIFIER}'`,
    message: issues.length > 0 ? issues.join("; ") : `Unresolved import '${specifier}' in authority session entry`,
    status: options.status ?? "open",
    type: "CODE_HEALTH",
    category: "code_defect",
    severity: options.severity ?? "high",
    observation: options.observation ?? (issues.length > 0 ? `Found ${issues.length} issue(s) in ${filePath}: ${issues.join("; ")}` : `Unresolved legacy import '${specifier}' in ${filePath}`),
    remediation: options.remediation ?? `Replace '${specifier}' with canonical imports '${CANONICAL_SESSION_PATHS_SPECIFIER}' and '${CANONICAL_SESSION_IO_SPECIFIER}'.`,
    context: { file: filePath, specifier, issues, defectReference: DEFECT_REF, canonicalPaths: CANONICAL_SESSION_PATHS_SPECIFIER, canonicalIo: CANONICAL_SESSION_IO_SPECIFIER },
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}
