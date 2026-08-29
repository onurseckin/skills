export const MODULARITY_AND_ZERO_COMMENTS_VIOLATION =
  "MODULARITY_AND_ZERO_COMMENTS_VIOLATION" as const;
export const ZERO_COMMENTS_INVARIANT = "zero_comments_invariant" as const;
export const DENSITY_BUDGET_INVARIANT = "density_budget_invariant" as const;
export const EXPLICIT_FACADE_EXPORTS_INVARIANT = "explicit_facade_exports_invariant" as const;
export const CAPSULE_DISK_HYGIENE_INVARIANT = "capsule_disk_hygiene_invariant" as const;

export const MAX_LINES_PER_FILE = 300;
export const MAX_FILES_PER_DIRECTORY = 10;

export type ViolationCategory = "comment" | "density" | "facade" | "capsule_hygiene";

export interface CommentDefectViolation {
  readonly category: "comment";
  readonly filePath: string;
  readonly lineNumber: number;
  readonly columnNumber?: number;
  readonly commentType: "line" | "block";
  readonly snippet: string;
  readonly message: string;
}

export interface DensityDefectViolation {
  readonly category: "density";
  readonly filePath: string;
  readonly violationType: "file_line_budget" | "directory_density_budget";
  readonly actual: number;
  readonly maxBudget: number;
  readonly message: string;
}

export interface FacadeDefectViolation {
  readonly category: "facade";
  readonly filePath: string;
  readonly lineNumber?: number;
  readonly violationType: "wildcard_export" | "facade_bypass" | "default_export";
  readonly snippet?: string;
  readonly message: string;
}

export interface CapsuleDefectViolation {
  readonly category: "capsule_hygiene";
  readonly capsulePath: string;
  readonly fileName: string;
  readonly violationType:
    | "temporary_artifact"
    | "scratch_file"
    | "untracked_binary"
    | "orphaned_state";
  readonly message: string;
}

export interface DefectAuditFileInput {
  readonly path: string;
  readonly content: string;
  readonly dirFileCount?: number;
}
export interface DefectAuditDirectoryInput {
  readonly path: string;
  readonly fileCount: number;
}
export interface DefectAuditCapsuleInput {
  readonly path: string;
  readonly fileNames: readonly string[];
}

export interface DefectAuditOptions {
  readonly files?: readonly DefectAuditFileInput[];
  readonly directories?: readonly DefectAuditDirectoryInput[];
  readonly capsules?: readonly DefectAuditCapsuleInput[];
  readonly maxLinesPerFile?: number;
  readonly maxFilesPerDirectory?: number;
}

export interface ModularityAuditResult {
  readonly passed: boolean;
  readonly errorCode?: typeof MODULARITY_AND_ZERO_COMMENTS_VIOLATION | undefined;
  readonly commentViolations: readonly CommentDefectViolation[];
  readonly densityViolations: readonly DensityDefectViolation[];
  readonly facadeViolations: readonly FacadeDefectViolation[];
  readonly capsuleViolations: readonly CapsuleDefectViolation[];
  readonly totalViolations: number;
  readonly verifiedInvariants: readonly string[];
}

const FORBIDDEN_TEMP_PREFIXES = [
  "tmp-",
  "temp-",
  "scratch-",
  "tmp.",
  "temp.",
  "scratch.",
  ".~",
  ".tmp",
];
const FORBIDDEN_TEMP_SUFFIXES = [".tmp", ".temp", ".bak", ".swp", ".scratch", ".log", ".old", "~"];
const FORBIDDEN_EXACT_NAMES = [
  ".ds_store",
  "thumbs.db",
  "scratch.ts",
  "scratch.js",
  "scratch.json",
  "temp.ts",
  "temp.js",
  "temp.json",
];

interface CommentSpan {
  readonly type: "line" | "block";
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly col: number;
  readonly snippet: string;
}

function scanComments(content: string): CommentSpan[] {
  const spans: CommentSpan[] = [];
  let line = 1,
    col = 1,
    i = 0;
  const len = content.length;
  let mode: "NORMAL" | "SINGLE" | "DOUBLE" | "TEMPLATE" = "NORMAL";
  const braceStack: number[] = [];

  while (i < len) {
    const ch = content[i],
      next = i + 1 < len ? content[i + 1] : "";
    if (mode === "NORMAL") {
      if (ch === "'") {
        mode = "SINGLE";
        col++;
        i++;
      } else if (ch === '"') {
        mode = "DOUBLE";
        col++;
        i++;
      } else if (ch === "`") {
        mode = "TEMPLATE";
        braceStack.push(0);
        col++;
        i++;
      } else if (ch === "/" && next === "/") {
        const start = i,
          startLine = line,
          startCol = col;
        while (i < len && content[i] !== "\n" && content[i] !== "\r") {
          i++;
          col++;
        }
        spans.push({
          type: "line",
          start,
          end: i,
          line: startLine,
          col: startCol,
          snippet: content.slice(start, i),
        });
      } else if (ch === "/" && next === "*") {
        const start = i,
          startLine = line,
          startCol = col;
        i += 2;
        col += 2;
        while (i < len && !(content[i] === "*" && i + 1 < len && content[i + 1] === "/")) {
          if (content[i] === "\n") {
            line++;
            col = 1;
          } else {
            col++;
          }
          i++;
        }
        if (i < len) {
          i += 2;
          col += 2;
        }
        spans.push({
          type: "block",
          start,
          end: i,
          line: startLine,
          col: startCol,
          snippet: content.slice(start, i),
        });
      } else {
        if (braceStack.length > 0) {
          if (ch === "{") {
            const top = braceStack[braceStack.length - 1] ?? 0;
            braceStack[braceStack.length - 1] = top + 1;
          } else if (ch === "}") {
            const top = braceStack[braceStack.length - 1] ?? 0;
            if (top > 1) {
              braceStack[braceStack.length - 1] = top - 1;
            } else {
              braceStack.pop();
              mode = "TEMPLATE";
            }
          }
        }
        if (ch === "\n") {
          line++;
          col = 1;
        } else {
          col++;
        }
        i++;
      }
    } else if (mode === "SINGLE") {
      if (ch === "\\") {
        i += 2;
        col += 2;
      } else {
        if (ch === "'") mode = "NORMAL";
        if (ch === "\n") {
          line++;
          col = 1;
        } else {
          col++;
        }
        i++;
      }
    } else if (mode === "DOUBLE") {
      if (ch === "\\") {
        i += 2;
        col += 2;
      } else {
        if (ch === '"') mode = "NORMAL";
        if (ch === "\n") {
          line++;
          col = 1;
        } else {
          col++;
        }
        i++;
      }
    } else if (mode === "TEMPLATE") {
      if (ch === "\\") {
        i += 2;
        col += 2;
      } else if (ch === "`") {
        braceStack.pop();
        mode = "NORMAL";
        col++;
        i++;
      } else if (ch === "$" && next === "{") {
        mode = "NORMAL";
        braceStack.push(1);
        col += 2;
        i += 2;
      } else {
        if (ch === "\n") {
          line++;
          col = 1;
        } else {
          col++;
        }
        i++;
      }
    }
  }
  return spans;
}

export function inspectFileCommentsViolation(
  filePath: string,
  content: string,
): readonly CommentDefectViolation[] {
  return scanComments(content).map((span) => ({
    category: "comment",
    filePath,
    lineNumber: span.line,
    columnNumber: span.col,
    commentType: span.type,
    snippet: span.snippet,
    message: `${span.type === "line" ? "Line" : "Block"} comment detected in '${filePath}' at line ${span.line}: '${span.snippet.trim().slice(0, 80)}'. ZERO_COMMENTS_INVARIANT violated.`,
  }));
}

export function inspectDensityViolation(
  filePath: string,
  lineCount: number,
  dirFileCount?: number,
): readonly DensityDefectViolation[] {
  const violations: DensityDefectViolation[] = [];
  if (lineCount > MAX_LINES_PER_FILE) {
    violations.push({
      category: "density",
      filePath,
      violationType: "file_line_budget",
      actual: lineCount,
      maxBudget: MAX_LINES_PER_FILE,
      message: `Density budget exceeded for '${filePath}': ${lineCount} lines (budget: <= ${MAX_LINES_PER_FILE}).`,
    });
  }
  if (dirFileCount !== undefined && dirFileCount > MAX_FILES_PER_DIRECTORY) {
    violations.push({
      category: "density",
      filePath,
      violationType: "directory_density_budget",
      actual: dirFileCount,
      maxBudget: MAX_FILES_PER_DIRECTORY,
      message: `Directory density budget exceeded for directory of '${filePath}': ${dirFileCount} files (budget: <= ${MAX_FILES_PER_DIRECTORY}).`,
    });
  }
  return violations;
}

export function inspectFacadeViolation(
  filePath: string,
  content: string,
): readonly FacadeDefectViolation[] {
  const violations: FacadeDefectViolation[] = [];
  const lines = content.split("\n");
  const isIndex =
    filePath.endsWith("index.ts") || filePath.endsWith("index.js") || filePath === "index.ts";

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "",
      trimmed = line.trim(),
      lineNum = idx + 1;
    if (
      /^export\s+\*\s*(?:as\s+\w+\s*)?from\s*['"][^'"]+['"]/.test(trimmed) ||
      /^export\s+\*/.test(trimmed)
    ) {
      violations.push({
        category: "facade",
        filePath,
        lineNumber: lineNum,
        violationType: "wildcard_export",
        snippet: trimmed,
        message: `Wildcard export detected in '${filePath}' at line ${lineNum}: '${trimmed}'. Explicit named facade exports are required by EXPLICIT_FACADE_EXPORTS_INVARIANT.`,
      });
    }
    if (isIndex && /^export\s+default\b/.test(trimmed)) {
      violations.push({
        category: "facade",
        filePath,
        lineNumber: lineNum,
        violationType: "default_export",
        snippet: trimmed,
        message: `Default export detected in facade '${filePath}' at line ${lineNum}: '${trimmed}'. Explicit named exports are required.`,
      });
    }
    if (
      /from\s+['"][^'"]*\/(?:internal|impl|private)\/[^'"]+['"]/.test(trimmed) ||
      /from\s+['"][^'"]+\.internal['"]/.test(trimmed)
    ) {
      violations.push({
        category: "facade",
        filePath,
        lineNumber: lineNum,
        violationType: "facade_bypass",
        snippet: trimmed,
        message: `Facade bypass detected in '${filePath}' at line ${lineNum}: direct import from internal implementation '${trimmed}'.`,
      });
    }
  }
  return violations;
}

export function inspectCapsuleHygieneViolation(
  capsulePath: string,
  fileNames: readonly string[],
): readonly CapsuleDefectViolation[] {
  const violations: CapsuleDefectViolation[] = [];
  for (const fileName of fileNames) {
    const lower = fileName.toLowerCase();
    const isExact = FORBIDDEN_EXACT_NAMES.includes(lower);
    const hasPrefix = FORBIDDEN_TEMP_PREFIXES.some((p) => lower.startsWith(p));
    const hasSuffix = FORBIDDEN_TEMP_SUFFIXES.some((s) => lower.endsWith(s));
    if (isExact || hasPrefix || hasSuffix) {
      const isScratch = lower.includes("scratch");
      const isOrphaned = lower.endsWith(".old") || lower.endsWith(".bak") || lower.endsWith("~");
      violations.push({
        category: "capsule_hygiene",
        capsulePath,
        fileName,
        violationType: isScratch
          ? "scratch_file"
          : isOrphaned
            ? "orphaned_state"
            : "temporary_artifact",
        message: `Capsule hygiene violation in '${capsulePath}': forbidden artifact '${fileName}' detected. CAPSULE_DISK_HYGIENE_INVARIANT violated.`,
      });
    }
  }
  return violations;
}

export function auditModularityAndZeroCommentsDefects(
  options: DefectAuditOptions,
): ModularityAuditResult {
  const maxLines = options.maxLinesPerFile ?? MAX_LINES_PER_FILE;
  const maxFiles = options.maxFilesPerDirectory ?? MAX_FILES_PER_DIRECTORY;
  const commentViolations: CommentDefectViolation[] = [];
  const densityViolations: DensityDefectViolation[] = [];
  const facadeViolations: FacadeDefectViolation[] = [];
  const capsuleViolations: CapsuleDefectViolation[] = [];

  if (options.files) {
    for (const file of options.files) {
      if (
        file.path.endsWith(".ts") ||
        file.path.endsWith(".tsx") ||
        file.path.endsWith(".mts") ||
        file.path.endsWith(".cts") ||
        !file.path.includes(".")
      ) {
        commentViolations.push(...inspectFileCommentsViolation(file.path, file.content));
      }
      const lineCount = file.content.length === 0 ? 0 : file.content.split("\n").length;
      densityViolations.push(...inspectDensityViolation(file.path, lineCount, file.dirFileCount));
      facadeViolations.push(...inspectFacadeViolation(file.path, file.content));
    }
  }
  if (options.directories) {
    for (const dir of options.directories) {
      if (dir.fileCount > maxFiles) {
        densityViolations.push({
          category: "density",
          filePath: dir.path,
          violationType: "directory_density_budget",
          actual: dir.fileCount,
          maxBudget: maxFiles,
          message: `Directory '${dir.path}' exceeds density limit: ${dir.fileCount} files (budget: <= ${maxFiles}).`,
        });
      }
    }
  }
  if (options.capsules) {
    for (const cap of options.capsules)
      capsuleViolations.push(...inspectCapsuleHygieneViolation(cap.path, cap.fileNames));
  }

  const totalViolations =
    commentViolations.length +
    densityViolations.length +
    facadeViolations.length +
    capsuleViolations.length;
  const passed = totalViolations === 0;
  const verifiedInvariants: string[] = [];
  if (commentViolations.length === 0) verifiedInvariants.push(ZERO_COMMENTS_INVARIANT);
  if (densityViolations.length === 0) verifiedInvariants.push(DENSITY_BUDGET_INVARIANT);
  if (facadeViolations.length === 0) verifiedInvariants.push(EXPLICIT_FACADE_EXPORTS_INVARIANT);
  if (capsuleViolations.length === 0) verifiedInvariants.push(CAPSULE_DISK_HYGIENE_INVARIANT);

  return {
    passed,
    errorCode: passed ? undefined : MODULARITY_AND_ZERO_COMMENTS_VIOLATION,
    commentViolations,
    densityViolations,
    facadeViolations,
    capsuleViolations,
    totalViolations,
    verifiedInvariants,
  };
}

export function formatModularityViolationReport(result: ModularityAuditResult): string {
  if (result.passed)
    return `MODULARITY & ZERO-COMMENTS AUDIT PASSED: All invariants satisfied (${result.verifiedInvariants.join(", ")}).`;
  const lines: string[] = [
    `=== MODULARITY & ZERO-COMMENTS AUDIT REPORT: FAILED (${result.totalViolations} violation(s)) ===`,
    `Error Code: ${MODULARITY_AND_ZERO_COMMENTS_VIOLATION}`,
  ];
  if (result.commentViolations.length > 0) {
    lines.push(`\n[Comment Violations: ${result.commentViolations.length}]`);
    for (const v of result.commentViolations)
      lines.push(
        `  - ${v.filePath}:${v.lineNumber} [${v.commentType}]: ${v.snippet.trim().slice(0, 80)}`,
      );
  }
  if (result.densityViolations.length > 0) {
    lines.push(`\n[Density Violations: ${result.densityViolations.length}]`);
    for (const v of result.densityViolations)
      lines.push(
        `  - ${v.filePath} [${v.violationType}]: actual=${v.actual}, maxBudget=${v.maxBudget}`,
      );
  }
  if (result.facadeViolations.length > 0) {
    lines.push(`\n[Facade Violations: ${result.facadeViolations.length}]`);
    for (const v of result.facadeViolations)
      lines.push(
        `  - ${v.filePath}${v.lineNumber ? `:${v.lineNumber}` : ""} [${v.violationType}]: ${v.message}`,
      );
  }
  if (result.capsuleViolations.length > 0) {
    lines.push(`\n[Capsule Hygiene Violations: ${result.capsuleViolations.length}]`);
    for (const v of result.capsuleViolations)
      lines.push(`  - ${v.capsulePath}/${v.fileName} [${v.violationType}]: ${v.message}`);
  }
  lines.push(`\nVerified Invariants: [${result.verifiedInvariants.join(", ")}]`);
  return lines.join("\n");
}

export function assertNoModularityOrCommentsViolations(result: ModularityAuditResult): void {
  if (!result.passed) {
    const report = formatModularityViolationReport(result);
    throw new Error(
      `[${MODULARITY_AND_ZERO_COMMENTS_VIOLATION}] Audit failed with ${result.totalViolations} defect(s):\n${report}`,
    );
  }
}

export function remediateCommentViolations(content: string): string {
  const spans = scanComments(content);
  if (spans.length === 0) return content;
  let cursor = 0;
  const chunks: string[] = [];
  for (const span of spans) {
    chunks.push(content.slice(cursor, span.start));
    if (span.type === "block") {
      const newlines = span.snippet.split("\n").length - 1;
      if (newlines > 0) chunks.push("\n".repeat(newlines));
    }
    cursor = span.end;
  }
  chunks.push(content.slice(cursor));
  return chunks
    .join("")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}
