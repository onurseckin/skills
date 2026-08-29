import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { DefectEntry } from "../mind/contracts/defect-contracts.ts";

export const DEFECT_REF_AGENT_TRIAD_AND_NAMING =
  "defect-agent-triad-and-naming-unterminated-template-literals" as const;
export const ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR =
  "ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR" as const;
export const TS1160_ERROR_CODE = "TS1160" as const;
export const TS1127_ERROR_CODE = "TS1127" as const;
export const TS1136_ERROR_CODE = "TS1136" as const;

export interface AgentTriadSyntaxIssue {
  readonly code: string;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly snippet?: string | undefined;
  readonly filePath?: string | undefined;
}

export interface AgentTriadValidationResult {
  readonly valid: boolean;
  readonly defectRef: typeof DEFECT_REF_AGENT_TRIAD_AND_NAMING;
  readonly filePath?: string | undefined;
  readonly issues: readonly AgentTriadSyntaxIssue[];
  readonly issueCount: number;
  readonly hasUnterminatedLiterals: boolean;
  readonly hasInvalidCharacters: boolean;
}

export interface AgentTriadFileAuditResult {
  readonly filePath: string;
  readonly valid: boolean;
  readonly issueCount: number;
  readonly issues: readonly AgentTriadSyntaxIssue[];
}

export interface AgentTriadDirectoryAuditSummary {
  readonly totalFiles: number;
  readonly validFiles: number;
  readonly invalidFiles: number;
  readonly totalIssues: number;
  readonly defectRef: typeof DEFECT_REF_AGENT_TRIAD_AND_NAMING;
}

export interface AgentTriadDirectoryAuditResult {
  readonly directory: string;
  readonly summary: AgentTriadDirectoryAuditSummary;
  readonly fileResults: readonly AgentTriadFileAuditResult[];
  readonly compliant: boolean;
}

export interface AgentTriadAuditOptions {
  readonly extensions?: readonly string[] | undefined;
  readonly recursive?: boolean | undefined;
}

export interface CreateAgentTriadSyntaxDefectEntryOptions {
  readonly id?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues?: readonly AgentTriadSyntaxIssue[] | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly status?: string | undefined;
  readonly severity?: string | undefined;
  readonly timestamp?: string | undefined;
}

export class AgentTriadSyntaxError extends Error {
  readonly code: string;
  readonly issues: readonly AgentTriadSyntaxIssue[];
  readonly filePath?: string | undefined;

  constructor(
    msg: string,
    issues: readonly AgentTriadSyntaxIssue[] = [],
    code: string = ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR,
    filePath?: string | undefined,
  ) {
    super(msg);
    this.name = "AgentTriadSyntaxError";
    this.code = code;
    this.issues = issues;
    this.filePath = filePath;
    Object.setPrototypeOf(this, AgentTriadSyntaxError.prototype);
  }
}

function computePos(src: string, offset = 0): { line: number; column: number; snippet: string } {
  const safe = Math.max(0, Math.min(offset, src.length));
  const lines = src.slice(0, safe).split("\n");
  const line = lines.length;
  const column = (lines[lines.length - 1] ?? "").length + 1;
  return { line, column, snippet: (src.split("\n")[line - 1] ?? "").trim() };
}

function mapErrorCode(code: number): string {
  if (code === 1160) return TS1160_ERROR_CODE;
  if (code === 1127) return TS1127_ERROR_CODE;
  if (code === 1136) return TS1136_ERROR_CODE;
  return `TS${code}`;
}

export function detectAgentTriadSyntaxErrors(
  source: string,
  filePath?: string,
): readonly AgentTriadSyntaxIssue[] {
  const transpile = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
    fileName: filePath ?? "snippet.ts",
    reportDiagnostics: true,
  });
  return (transpile.diagnostics ?? []).map((diag) => {
    const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
    const pos = computePos(source, diag.start ?? 0);
    return {
      code: mapErrorCode(diag.code),
      message,
      line: pos.line,
      column: pos.column,
      snippet: pos.snippet || undefined,
      filePath,
    };
  });
}

export function validateAgentTriadSyntax(
  source: string,
  filePath?: string,
): AgentTriadValidationResult {
  const issues = detectAgentTriadSyntaxErrors(source, filePath);
  return {
    valid: issues.length === 0,
    defectRef: DEFECT_REF_AGENT_TRIAD_AND_NAMING,
    filePath,
    issues,
    issueCount: issues.length,
    hasUnterminatedLiterals: issues.some((i) => i.code === TS1160_ERROR_CODE),
    hasInvalidCharacters: issues.some((i) => i.code === TS1127_ERROR_CODE),
  };
}

export function sanitizeAgentTriadSource(source: string): string {
  let cleaned = source
    .replace(/(\breturn\s+)\\`/g, "$1`")
    .replace(/(=\s*)\\`/g, "$1`")
    .replace(/(\(\s*)\\`/g, "$1`")
    .replace(/(\[\s*)\\`/g, "$1`")
    .replace(/\\`;/g, "`;")
    .replace(/\\`(\s*[,);])/g, "`$1");

  let inTpl = false, inStr = false, esc = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (!inTpl && (c === "'" || c === '"')) inStr = !inStr;
    else if (!inStr && c === "`") inTpl = !inTpl;
  }
  if (inTpl) {
    if (/;\s*$/.test(cleaned)) cleaned = cleaned.replace(/;\s*$/, "`;");
    else if (/\}\s*$/.test(cleaned)) cleaned = cleaned.replace(/\}\s*$/, "\n`;\n}");
    else cleaned += "`;";
  }
  return cleaned;
}

export function assertAgentTriadSyntaxPurity(source: string, filePath?: string): void {
  const issues = detectAgentTriadSyntaxErrors(source, filePath);
  if (issues.length > 0) {
    const first = issues[0]!;
    throw new AgentTriadSyntaxError(
      `Agent triad syntax assertion failed: [${first.code}] ${first.message} in ${filePath ?? "source"}:${first.line}:${first.column}`,
      issues,
      first.code,
      filePath,
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

export function auditAgentTriadDirectory(
  dirPath: string,
  options?: AgentTriadAuditOptions,
): AgentTriadDirectoryAuditResult {
  const files = collectFiles(
    dirPath,
    options?.extensions ?? [".ts", ".tsx", ".js"],
    options?.recursive ?? true,
  );
  const fileResults: AgentTriadFileAuditResult[] = [];
  let validFiles = 0;
  let invalidFiles = 0;
  let totalIssues = 0;

  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, "utf-8");
      const issues = detectAgentTriadSyntaxErrors(content, filePath);
      const valid = issues.length === 0;
      if (valid) validFiles++;
      else {
        invalidFiles++;
        totalIssues += issues.length;
      }
      fileResults.push({ filePath, valid, issueCount: issues.length, issues });
    } catch (err) {
      invalidFiles++;
      totalIssues++;
      const message = err instanceof Error ? err.message : String(err);
      fileResults.push({
        filePath,
        valid: false,
        issueCount: 1,
        issues: [
          { code: ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR, message, line: 1, column: 1, filePath },
        ],
      });
    }
  }

  const summary: AgentTriadDirectoryAuditSummary = {
    totalFiles: files.length,
    validFiles,
    invalidFiles,
    totalIssues,
    defectRef: DEFECT_REF_AGENT_TRIAD_AND_NAMING,
  };
  return { directory: dirPath, summary, fileResults, compliant: invalidFiles === 0 };
}

export function createAgentTriadSyntaxDefectEntry(
  options: CreateAgentTriadSyntaxDefectEntryOptions = {},
): DefectEntry {
  const issues = options.issues ?? [];
  const first = issues[0];
  const filePath = options.filePath ?? first?.filePath ?? "unknown";
  const issueContext = issues.map((i) => ({
    code: i.code,
    message: i.message,
    line: i.line,
    column: i.column,
  }));

  return {
    id: options.id ?? `${DEFECT_REF_AGENT_TRIAD_AND_NAMING}-${Date.now()}`,
    domain: "agent-triad-and-naming-syntax",
    error_code: first?.code ?? ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR,
    title: `Escaped backtick / unterminated template literal in ${filePath}`,
    description: `Remediation for template literal syntax errors in agents and naming modules: ${filePath}`,
    message: first?.message ?? "Syntax error detected in agent triad or naming source",
    status: options.status ?? "open",
    type: "CODE_HEALTH",
    category: "code_defect",
    severity: options.severity ?? "high",
    observation:
      options.observation ??
      (issues.length > 0
        ? `Found ${issues.length} syntax issue(s) in ${filePath}`
        : `Unterminated template literal in ${filePath}`),
    remediation:
      options.remediation ??
      "Sanitize source with sanitizeAgentTriadSource to normalize backticks.",
    context: {
      file: filePath,
      issuesCount: issues.length,
      issues: issueContext,
      defectReference: DEFECT_REF_AGENT_TRIAD_AND_NAMING,
    },
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}
