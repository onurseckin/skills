/**
 * CLI command: task-check (task:check)
 * Fast incremental verification tool for targeted files and task write scopes.
 * Performs fast TypeScript type checking and AST invariant audits (0 any, 0 compiler suppressions).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { HarnessError, isTestEnvironment } from "../../core/index.ts";
import { autoDeriveCallerIdentity } from "../../authority/session/index.ts";
import { workflowPort } from "../../integration/index.ts";
import {
  ALL_AST_LINT_RULES,
  lintFile,
  type AstLintOptions,
  type AstLintRule,
  type AstLintViolation,
} from "../../linter/ast/index.ts";
import { loadRun, loadRunProjection } from "../../engine/store/index.ts";
import { AutoReceiptLogger } from "../../engine/runner/receipt/index.ts";
import type { TaskRecord } from "../../workflow/index.ts";
import { enforceLineLimit, formatTable } from "../formatters/index.ts";
import { boolFlag, listFlag, textFlag, type CommandContext, type Flags } from "../index.ts";

export const SUPPORTED_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

export interface TypeCheckDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: number;
  readonly message: string;
  readonly category: "error" | "warning" | "message" | "suggestion";
  readonly snippet?: string | undefined;
}

export interface TypeCheckResult {
  readonly passed: boolean;
  readonly totalFiles: number;
  readonly totalErrors: number;
  readonly totalWarnings: number;
  readonly diagnostics: readonly TypeCheckDiagnostic[];
}

export interface LintCheckResult {
  readonly passed: boolean;
  readonly totalFiles: number;
  readonly totalViolations: number;
  readonly violations: readonly AstLintViolation[];
  readonly summaryByRule: Readonly<Record<string, number>>;
}

export interface TaskCheckSummary {
  readonly passed: boolean;
  readonly runRoot?: string | undefined;
  readonly taskId?: string | undefined;
  readonly filesChecked: readonly string[];
  readonly typecheck?: TypeCheckResult | undefined;
  readonly lint?: LintCheckResult | undefined;
  readonly durationMs: number;
  readonly format: "markdown" | "json";
  readonly markdown: string;
  readonly [key: string]: unknown;
}

export interface TaskReviewVerdictProjection {
  readonly validatorId?: string | undefined;
  readonly domain?: string | undefined;
  readonly verdict: string;
  readonly reviewedAt?: string | undefined;
  readonly summary?: string | undefined;
}

export interface TaskLeaseProjection {
  readonly agentId: string;
  readonly expiresAt?: string | undefined;
  readonly tokenSnippet?: string | undefined;
}

export interface TaskInspectionProjection {
  readonly taskId: string;
  readonly label?: string | undefined;
  readonly status: string;
  readonly gateCommand: readonly string[] | string | null;
  readonly gateProofHash: string | null;
  readonly reviewVerdicts: readonly TaskReviewVerdictProjection[];
  readonly lease: TaskLeaseProjection | null;
}

export interface WaveTaskSummary {
  readonly taskId: string;
  readonly label: string;
  readonly status: string;
  readonly dependencies: readonly string[];
  readonly writeScopeCount: number;
}

export interface WaveSummary {
  readonly wave: number;
  readonly tasks: readonly WaveTaskSummary[];
  readonly statusCounts: Readonly<Record<string, number>>;
}

export interface CapsuleWaveSummary {
  readonly runRoot: string;
  readonly runId?: string | undefined;
  readonly totalTasks: number;
  readonly statusCounts: Readonly<Record<string, number>>;
  readonly waves: readonly WaveSummary[];
}

export interface ResolveTargetFilesOptions {
  readonly fileFlags?: readonly string[] | undefined;
  readonly runRoot?: string | undefined;
  readonly taskId?: string | undefined;
}

function isStringBlank(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  return value.trim().length === 0;
}

function isListEmpty<T>(list: readonly T[] | undefined): boolean {
  if (list === undefined) {
    return true;
  }
  return list.length === 0;
}

/**
 * Checks if a filename has a supported TypeScript/JavaScript source extension.
 */
export function isSupportedSourceFile(fileName: string): boolean {
  for (const ext of SUPPORTED_EXTENSIONS) {
    if (fileName.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

/**
 * Collects all source files in a directory recursively.
 */
export function collectSourceFilesRecursively(
  dir: string,
  maxDepth = 10,
  currentDepth = 0,
): string[] {
  if (currentDepth > maxDepth || !existsSync(dir)) {
    return [];
  }

  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === "coverage"
      ) {
        continue;
      }

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = collectSourceFilesRecursively(fullPath, maxDepth, currentDepth + 1);
        results.push(...subFiles);
      } else if (entry.isFile() && isSupportedSourceFile(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch {
    return [];
  }

  return results;
}

/**
 * Reads tasks from a run root.
 */
export function readRunTasks(runRoot: string): Record<string, TaskRecord> {
  const normalizedRunRoot = resolve(runRoot.trim());
  try {
    const loaded = loadRunProjection(normalizedRunRoot);
    if (loaded && loaded.state && typeof loaded.state === "object") {
      const rawTasks = (loaded.state as Record<string, unknown>).tasks;
      if (typeof rawTasks === "object" && rawTasks !== null && !Array.isArray(rawTasks)) {
        return rawTasks as Record<string, TaskRecord>;
      }
    }
  } catch {
    // Fall through
  }
  try {
    const loaded = loadRun(normalizedRunRoot, false);
    if (loaded && loaded.state && typeof loaded.state === "object") {
      const rawTasks = (loaded.state as Record<string, unknown>).tasks;
      if (typeof rawTasks === "object" && rawTasks !== null && !Array.isArray(rawTasks)) {
        return rawTasks as Record<string, TaskRecord>;
      }
    }
  } catch {
    // Fall through
  }
  try {
    const statePath = join(normalizedRunRoot, "state.json");
    if (existsSync(statePath)) {
      const raw = JSON.parse(readFileSync(statePath, "utf8"));
      if (raw && typeof raw === "object" && raw.tasks && typeof raw.tasks === "object") {
        return raw.tasks as Record<string, TaskRecord>;
      }
    }
  } catch {
    // Fall through
  }
  try {
    const wf = workflowPort(normalizedRunRoot).read();
    if (wf && wf.tasks) {
      return wf.tasks;
    }
  } catch {
    // Fall through to empty
  }
  return {};
}

/**
 * Resolves target source files based on CLI flags: --file, --task, --run.
 */
export function resolveTargetFiles(options: ResolveTargetFilesOptions): readonly string[] {
  const resolvedSet = new Set<string>();

  // 1. Explicit file flags
  if (options.fileFlags !== undefined && options.fileFlags.length > 0) {
    for (const rawItem of options.fileFlags) {
      const parts = rawItem.split(",");
      for (const rawPart of parts) {
        const trimmed = rawPart.trim();
        if (trimmed.length > 0) {
          const absPath = resolve(trimmed);
          if (existsSync(absPath)) {
            const stat = statSync(absPath);
            if (stat.isDirectory()) {
              const dirFiles = collectSourceFilesRecursively(absPath);
              for (const f of dirFiles) {
                resolvedSet.add(f);
              }
            } else {
              resolvedSet.add(absPath);
            }
          } else {
            resolvedSet.add(absPath);
          }
        }
      }
    }
  }

  // 2. Task write scope
  const taskId = options.taskId;
  const runRoot = options.runRoot;
  if (taskId !== undefined && taskId.trim().length > 0) {
    if (runRoot === undefined || runRoot.trim().length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "--run is required when --task is specified");
    }
    const tasks = readRunTasks(runRoot);
    const task = tasks[taskId.trim()];
    if (!task) {
      throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId.trim()}`);
    }
    const targetFiles = Array.isArray(task.target_files) ? task.target_files : [];
    const scopeItems = Array.isArray(task.write_scope) ? task.write_scope : [];
    for (const item of [...targetFiles, ...scopeItems]) {
      if (typeof item === "string" && item.trim().length > 0) {
        const absPath = resolve(item.trim());
        if (existsSync(absPath)) {
          const stat = statSync(absPath);
          if (stat.isDirectory()) {
            const dirFiles = collectSourceFilesRecursively(absPath);
            for (const f of dirFiles) {
              resolvedSet.add(f);
            }
          } else {
            resolvedSet.add(absPath);
          }
        } else {
          resolvedSet.add(absPath);
        }
      }
    }
  }

  // 3. Whole run scope if runRoot provided without taskId or fileFlags
  const rootForScope = options.runRoot;
  if (
    resolvedSet.size === 0 &&
    rootForScope !== undefined &&
    rootForScope.trim().length > 0 &&
    (options.fileFlags === undefined || options.fileFlags.length === 0) &&
    (options.taskId === undefined || options.taskId.trim().length === 0)
  ) {
    const tasks = readRunTasks(rootForScope);
    for (const task of Object.values(tasks)) {
      const targetFiles = Array.isArray(task.target_files) ? task.target_files : [];
      const scopeItems = Array.isArray(task.write_scope) ? task.write_scope : [];
      for (const item of [...targetFiles, ...scopeItems]) {
        if (typeof item === "string" && item.trim().length > 0) {
          const absPath = resolve(item.trim());
          if (existsSync(absPath)) {
            const stat = statSync(absPath);
            if (stat.isDirectory()) {
              const dirFiles = collectSourceFilesRecursively(absPath);
              for (const f of dirFiles) {
                resolvedSet.add(f);
              }
            } else {
              resolvedSet.add(absPath);
            }
          } else {
            resolvedSet.add(absPath);
          }
        }
      }
    }
  }

  return Array.from(resolvedSet);
}

/**
 * Finds the nearest tsconfig.json configuration for a target file.
 */
export function findNearestTsconfig(filePath: string): string | undefined {
  let startDir: string;
  if (existsSync(filePath)) {
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      startDir = filePath;
    } else {
      startDir = dirname(filePath);
    }
  } else {
    startDir = dirname(filePath);
  }

  const isVirtual = filePath.startsWith("/virtual") || startDir.startsWith("/virtual");
  const found = ts.findConfigFile(startDir, ts.sys.fileExists, "tsconfig.json");
  if (found !== undefined) {
    if (isVirtual && !found.startsWith("/virtual")) {
      return undefined;
    }
    return found;
  }

  if (!isTestEnvironment() && !isVirtual) {
    const cwdConfig = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
    if (cwdConfig !== undefined) {
      return cwdConfig;
    }
  }

  return undefined;
}

let sharedCompilerHost: ts.CompilerHost | undefined;

function getSharedCompilerHost(options: ts.CompilerOptions): ts.CompilerHost {
  if (!sharedCompilerHost) {
    sharedCompilerHost = ts.createCompilerHost(options);
  }
  return sharedCompilerHost;
}

const defaultLibCache = new Map<string, ts.SourceFile>();

function createFastProgram(files: readonly string[], options: ts.CompilerOptions): ts.Program {
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fileName.includes("lib.") && fileName.endsWith(".d.ts")) {
      const cached = defaultLibCache.get(fileName);
      if (cached) return cached;
      const file = originalGetSourceFile(
        fileName,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
      if (file) defaultLibCache.set(fileName, file);
      return file;
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  return ts.createProgram(files, options, host);
}

/**
 * Executes fast in-process incremental TypeScript type checking on the specified files.
 */
export function performIncrementalTypecheck(filePaths: readonly string[]): TypeCheckResult {
  const tsFiles = filePaths.filter((f) => isSupportedSourceFile(f) && existsSync(f));
  if (tsFiles.length === 0) {
    return {
      passed: true,
      totalFiles: 0,
      totalErrors: 0,
      totalWarnings: 0,
      diagnostics: [],
    };
  }

  if (isTestEnvironment()) {
    const program = createFastProgram(tsFiles, {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
      typeRoots: [],
      skipLibCheck: true,
      skipDefaultLibCheck: true,
    });
    const rawDiagnostics = ts.getPreEmitDiagnostics(program);
    const targetAbsPaths = new Set(tsFiles.map((f) => resolve(f)));
    const allDiagnostics: TypeCheckDiagnostic[] = [];

    for (const diag of rawDiagnostics) {
      let fileName = "unknown";
      let isTarget = false;

      if (diag.file !== undefined) {
        fileName = diag.file.fileName;
        isTarget = targetAbsPaths.has(resolve(fileName));
      } else {
        isTarget = true;
      }

      if (!isTarget) {
        continue;
      }

      let line = 0;
      let column = 0;
      let snippet: string | undefined = undefined;

      if (diag.file !== undefined && diag.start !== undefined) {
        const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
        line = pos.line + 1;
        column = pos.character + 1;

        const lineStarts = diag.file.getLineStarts();
        const startIdx = lineStarts[pos.line];
        if (startIdx !== undefined) {
          const nextIdx = pos.line + 1 < lineStarts.length ? lineStarts[pos.line + 1] : undefined;
          const endIdx = nextIdx !== undefined ? nextIdx : diag.file.text.length;
          snippet = diag.file.text.slice(startIdx, endIdx).trimEnd();
        }
      }

      const messageText =
        typeof diag.messageText === "string"
          ? diag.messageText
          : ts.flattenDiagnosticMessageText(diag.messageText, "\n");

      let category: "error" | "warning" | "message" | "suggestion" = "message";
      if (diag.category === ts.DiagnosticCategory.Error) {
        category = "error";
      } else if (diag.category === ts.DiagnosticCategory.Warning) {
        category = "warning";
      } else if (diag.category === ts.DiagnosticCategory.Suggestion) {
        category = "suggestion";
      }

      allDiagnostics.push({
        file: fileName,
        line,
        column,
        code: diag.code,
        message: messageText,
        category,
        snippet,
      });
    }

    const totalErrors = allDiagnostics.filter((d) => d.category === "error").length;
    const totalWarnings = allDiagnostics.filter((d) => d.category === "warning").length;

    return {
      passed: totalErrors === 0,
      totalFiles: tsFiles.length,
      totalErrors,
      totalWarnings,
      diagnostics: allDiagnostics,
    };
  }

  // Group files by their nearest tsconfig.json
  const configGroups = new Map<string, string[]>();
  const fallbackFiles: string[] = [];

  for (const file of tsFiles) {
    const configPath = findNearestTsconfig(file);
    if (configPath !== undefined) {
      const existing = configGroups.get(configPath);
      if (existing !== undefined) {
        existing.push(file);
      } else {
        configGroups.set(configPath, [file]);
      }
    } else {
      fallbackFiles.push(file);
    }
  }

  const allDiagnostics: TypeCheckDiagnostic[] = [];

  // Check each configuration group
  for (const [configPath, groupFiles] of configGroups.entries()) {
    try {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        dirname(configPath),
      );

      const program = ts.createProgram(groupFiles, {
        ...parsedConfig.options,
        noEmit: true,
      });

      const rawDiagnostics = ts.getPreEmitDiagnostics(program);
      const targetAbsPaths = new Set(groupFiles.map((f) => resolve(f)));

      for (const diag of rawDiagnostics) {
        let fileName = "unknown";
        let isTarget = false;

        if (diag.file !== undefined) {
          fileName = diag.file.fileName;
          isTarget = targetAbsPaths.has(resolve(fileName));
        } else {
          // Global diagnostic applies to project
          isTarget = true;
        }

        if (!isTarget) {
          continue;
        }

        let line = 0;
        let column = 0;
        let snippet: string | undefined = undefined;

        if (diag.file !== undefined && diag.start !== undefined) {
          const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
          line = pos.line + 1;
          column = pos.character + 1;

          const lineStarts = diag.file.getLineStarts();
          const startIdx = lineStarts[pos.line];
          if (startIdx !== undefined) {
            const nextIdx = pos.line + 1 < lineStarts.length ? lineStarts[pos.line + 1] : undefined;
            const endIdx = nextIdx !== undefined ? nextIdx : diag.file.text.length;
            snippet = diag.file.text.slice(startIdx, endIdx).trimEnd();
          }
        }

        const messageText =
          typeof diag.messageText === "string"
            ? diag.messageText
            : ts.flattenDiagnosticMessageText(diag.messageText, "\n");

        let category: "error" | "warning" | "message" | "suggestion" = "message";
        if (diag.category === ts.DiagnosticCategory.Error) {
          category = "error";
        } else if (diag.category === ts.DiagnosticCategory.Warning) {
          category = "warning";
        } else if (diag.category === ts.DiagnosticCategory.Suggestion) {
          category = "suggestion";
        }

        allDiagnostics.push({
          file: fileName,
          line,
          column,
          code: diag.code,
          message: messageText,
          category,
          snippet,
        });
      }
    } catch (error) {
      allDiagnostics.push({
        file: configPath,
        line: 0,
        column: 0,
        code: 9999,
        message: `Failed to compile with ${configPath}: ${String(error)}`,
        category: "error",
      });
    }
  }

  // Check fallback files without tsconfig
  if (fallbackFiles.length > 0) {
    const fallbackProgram = ts.createProgram(fallbackFiles, {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      skipDefaultLibCheck: true,
      target: ts.ScriptTarget.ES2024,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    });
    const fallbackRaw = ts.getPreEmitDiagnostics(fallbackProgram);
    const targetAbsPaths = new Set(fallbackFiles.map((f) => resolve(f)));

    for (const diag of fallbackRaw) {
      if (diag.file !== undefined && !targetAbsPaths.has(resolve(diag.file.fileName))) {
        continue;
      }
      let line = 0;
      let column = 0;
      let snippet: string | undefined = undefined;
      let fileName = "unknown";

      if (diag.file !== undefined) {
        fileName = diag.file.fileName;
        if (diag.start !== undefined) {
          const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
          line = pos.line + 1;
          column = pos.character + 1;
          const lineStarts = diag.file.getLineStarts();
          const startIdx = lineStarts[pos.line];
          if (startIdx !== undefined) {
            const nextIdx = pos.line + 1 < lineStarts.length ? lineStarts[pos.line + 1] : undefined;
            const endIdx = nextIdx !== undefined ? nextIdx : diag.file.text.length;
            snippet = diag.file.text.slice(startIdx, endIdx).trimEnd();
          }
        }
      }

      const messageText =
        typeof diag.messageText === "string"
          ? diag.messageText
          : ts.flattenDiagnosticMessageText(diag.messageText, "\n");

      let category: "error" | "warning" | "message" | "suggestion" = "message";
      if (diag.category === ts.DiagnosticCategory.Error) {
        category = "error";
      } else if (diag.category === ts.DiagnosticCategory.Warning) {
        category = "warning";
      }

      allDiagnostics.push({
        file: fileName,
        line,
        column,
        code: diag.code,
        message: messageText,
        category,
        snippet,
      });
    }
  }

  const totalErrors = allDiagnostics.filter((d) => d.category === "error").length;
  const totalWarnings = allDiagnostics.filter((d) => d.category === "warning").length;

  return {
    passed: totalErrors === 0,
    totalFiles: tsFiles.length,
    totalErrors,
    totalWarnings,
    diagnostics: allDiagnostics,
  };
}

/**
 * Performs AST static invariant audit (0 any, 0 suppressions, zero-fallback) on target files.
 */
export function performAstLintCheck(
  filePaths: readonly string[],
  options?: AstLintOptions,
): LintCheckResult {
  const existingFiles = filePaths.filter((f) => isSupportedSourceFile(f) && existsSync(f));
  if (existingFiles.length === 0) {
    const emptySummary: Record<string, number> = {};
    for (const rule of ALL_AST_LINT_RULES) {
      emptySummary[rule] = 0;
    }
    return {
      passed: true,
      totalFiles: 0,
      totalViolations: 0,
      violations: [],
      summaryByRule: emptySummary,
    };
  }

  const violations: AstLintViolation[] = [];
  const summaryByRule: Record<string, number> = {};
  for (const rule of ALL_AST_LINT_RULES) {
    summaryByRule[rule] = 0;
  }

  for (const file of existingFiles) {
    try {
      const result = lintFile(file, options);
      for (const v of result.violations) {
        violations.push(v);
        const current = summaryByRule[v.rule];
        if (current !== undefined) {
          summaryByRule[v.rule] = current + 1;
        } else {
          summaryByRule[v.rule] = 1;
        }
      }
    } catch (error) {
      violations.push({
        rule: "compiler_suppression" as AstLintRule,
        file,
        line: 1,
        column: 1,
        snippet: "",
        message: `Failed to lint file: ${String(error)}`,
      });
    }
  }

  return {
    passed: violations.length === 0,
    totalFiles: existingFiles.length,
    totalViolations: violations.length,
    violations,
    summaryByRule,
  };
}

/**
 * Formats the task-check verification result into a structured Markdown briefing.
 */
export function formatTaskCheckMarkdown(summary: TaskCheckSummary): string {
  const lines: string[] = [];

  let targetHeading = `${summary.filesChecked.length} Target Files`;
  if (summary.taskId !== undefined) {
    targetHeading = `Task \`${summary.taskId}\``;
  } else if (summary.filesChecked.length === 1) {
    const singleFile = summary.filesChecked[0];
    if (singleFile !== undefined) {
      targetHeading = `File \`${singleFile}\``;
    }
  }

  const statusBadge = summary.passed
    ? "✅ **PASS: All Incremental Verification Invariants Satisfied**"
    : "❌ **FAIL: Verification Violations Detected**";

  lines.push(`### ⚡ Incremental Verification: ${targetHeading}`);
  lines.push(statusBadge);
  lines.push("");

  lines.push(`- **Duration**: ${summary.durationMs}ms`);
  lines.push(`- **Files Audited**: ${summary.filesChecked.length}`);
  if (summary.runRoot !== undefined) {
    lines.push(`- **Capsule Run**: \`${summary.runRoot}\``);
  }
  if (summary.taskId !== undefined) {
    lines.push(`- **Task ID**: \`${summary.taskId}\``);
  }
  lines.push("");

  // Typecheck section
  if (summary.typecheck !== undefined) {
    lines.push(`#### 🔷 TypeScript Incremental Type Check`);
    if (summary.typecheck.passed) {
      lines.push(`- Status: **Passed** (0 errors across ${summary.typecheck.totalFiles} files)`);
    } else {
      lines.push(
        `- Status: **Failed** (${summary.typecheck.totalErrors} errors across ${summary.typecheck.totalFiles} files)`,
      );
      lines.push("");

      const errorDiags = summary.typecheck.diagnostics.filter((d) => d.category === "error");
      const diagHeaders = ["Location", "Code", "Message"];
      const diagRows = errorDiags
        .slice(0, 10)
        .map((d) => [
          `\`${d.file}:${d.line}:${d.column}\``,
          `TS${d.code}`,
          d.message.replace(/\|/gu, "\\|"),
        ]);
      const tableLines = formatTable(diagHeaders, diagRows);
      for (const t of tableLines) {
        lines.push(t);
      }
      if (errorDiags.length > 10) {
        lines.push(`_... and ${errorDiags.length - 10} additional type errors_`);
      }
    }
    lines.push("");
  }

  // AST Lint section
  if (summary.lint !== undefined) {
    lines.push(`#### 🛡️ AST Static Invariant & Linter Audit`);
    if (summary.lint.passed) {
      lines.push(
        `- Status: **Passed** (0 violations, strict 0 'any', 0 compiler suppressions maintained)`,
      );
    } else {
      lines.push(
        `- Status: **Failed** (${summary.lint.totalViolations} violations in ${summary.lint.totalFiles} files)`,
      );
      lines.push("");

      const violationHeaders = ["Rule", "Location", "Message"];
      const violationRows = summary.lint.violations
        .slice(0, 10)
        .map((v) => [
          `\`${v.rule}\``,
          `\`${v.file}:${v.line}:${v.column}\``,
          v.message.replace(/\|/gu, "\\|"),
        ]);
      const tableLines = formatTable(violationHeaders, violationRows);
      for (const t of tableLines) {
        lines.push(t);
      }
      if (summary.lint.violations.length > 10) {
        lines.push(
          `_... and ${summary.lint.violations.length - 10} additional invariant violations_`,
        );
      }
    }
    lines.push("");
  }

  return enforceLineLimit(lines.join("\n"), 40);
}

/**
 * Combines the typecheck and lint results into a single verdict. A check that never ran must
 * never silently read as "passed" - that was the root cause behind `--typecheck` suppressing
 * the AST audit while still reporting PASS: two separate call sites each defaulted an absent
 * result to `true`, so a check dropped by a flag combination read identically to one that ran
 * and actually passed. This is the single place that verdict is computed, and only a result
 * that actually executed can contribute to it.
 */
export function computeTaskCheckVerdict(
  typecheckResult: TypeCheckResult | undefined,
  lintResult: LintCheckResult | undefined,
): boolean {
  const ranResults: boolean[] = [];
  if (typecheckResult !== undefined) {
    ranResults.push(typecheckResult.passed);
  }
  if (lintResult !== undefined) {
    ranResults.push(lintResult.passed);
  }
  return ranResults.length > 0 && ranResults.every((result) => result);
}

/**
 * Main command handler for task:check / task-check CLI command.
 */
export async function taskCheckCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const startTime = Date.now();

  const runRoot = textFlag(flags, "run", false);
  const taskId = textFlag(flags, "task", false);
  const fileFlags = listFlag(flags, "file", false);
  const requestedTypecheck = boolFlag(flags, "typecheck");
  const requestedLint = boolFlag(flags, "lint");
  const requestedInspect = boolFlag(flags, "inspect");
  const formatFlag = textFlag(flags, "format", false);
  const formatOption: "markdown" | "json" = formatFlag === "json" ? "json" : "markdown";

  // If inspect flag is set without explicit file checks or typecheck/lint, execute task inspection directly
  if (requestedInspect && isListEmpty(fileFlags) && !requestedTypecheck && !requestedLint) {
    if (isStringBlank(runRoot) || isStringBlank(taskId)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "--run and --task are required when --inspect is specified",
      );
    }
    const projection = projectTaskInspection(runRoot as string, taskId as string);
    const markdown = formatTaskInspectMarkdown(projection);
    return {
      markdown,
      passed: true,
      format: formatOption,
      run_root: runRoot,
      task_id: taskId,
      inspect: projection,
      status: projection.status,
      gate_command: projection.gateCommand,
      gate_proof_hash: projection.gateProofHash,
      review_verdicts: projection.reviewVerdicts,
      lease: projection.lease,
      duration_ms: Date.now() - startTime,
    };
  }

  // Validate that at least one target scope indicator is provided
  if (isListEmpty(fileFlags) && isStringBlank(taskId) && isStringBlank(runRoot)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Must specify --file, --task (with --run), or --run for task:check verification",
    );
  }

  // Resolve target files
  const targetFiles = resolveTargetFiles({
    fileFlags,
    runRoot,
    taskId,
  });

  if (targetFiles.length === 0) {
    if (!isListEmpty(fileFlags) && fileFlags !== undefined) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `No valid source files found matching --file arguments: ${fileFlags.join(", ")}`,
      );
    }
  }

  // The AST lint audit (0 `any`, 0 compiler suppressions) is the skill's own core invariant and
  // is never opt-out-able: it always runs regardless of which flags are passed. `--typecheck`
  // is additive - it requests the (slower) tsc pass IN ADDITION to that always-on audit, never
  // in place of it. `--lint` alone narrows scope to skip the typecheck pass; that is the only
  // check a flag combination may legitimately skip.
  let runTypecheck = true;
  if (!requestedTypecheck && requestedLint) {
    runTypecheck = false;
  }

  // Execute type check
  let typecheckResult: TypeCheckResult | undefined = undefined;
  if (runTypecheck) {
    typecheckResult = performIncrementalTypecheck(targetFiles);
  }

  // Execute AST lint check - unconditional; see the always-on rationale above.
  const lintResult: LintCheckResult = performAstLintCheck(targetFiles);

  const passed = computeTaskCheckVerdict(typecheckResult, lintResult);
  const durationMs = Date.now() - startTime;

  const summary: TaskCheckSummary = {
    passed,
    runRoot,
    taskId,
    filesChecked: targetFiles,
    typecheck: typecheckResult,
    lint: lintResult,
    durationMs,
    format: formatOption,
    markdown: "",
  };

  const markdown = formatTaskCheckMarkdown(summary);

  let evidencePath: string | undefined = undefined;
  if (runRoot && typeof runRoot === "string" && runRoot.trim().length > 0) {
    const canonicalRunRoot = resolve(runRoot);
    try {
      const evidenceDir = join(canonicalRunRoot, "evidence");
      if (!existsSync(evidenceDir)) {
        mkdirSync(evidenceDir, { recursive: true });
      }
      const reportFilename = taskId ? `mechanic-report-${taskId}.json` : "mechanic-report.json";
      evidencePath = join(evidenceDir, reportFilename);
      writeFileSync(
        evidencePath,
        JSON.stringify(
          {
            ...summary,
            generated_at: new Date().toISOString(),
          },
          null,
          2,
        ) + "\n",
        "utf-8",
      );
    } catch {
      // Presentation artifacts are optional; canonical receipt evidence is not.
    }

    const actorFlagVal = textFlag(flags, "actor", false);
    const actor = actorFlagVal !== undefined ? actorFlagVal : autoDeriveCallerIdentity().actor;
    const taskIdVal = taskId !== undefined ? taskId : "task:check";
    AutoReceiptLogger.recordReceipt(canonicalRunRoot, {
      taskId: taskIdVal,
      actor,
      command: "task:check",
      argv: ["task:check", ...(taskId ? ["--task", taskId] : []), ...targetFiles],
      exitCode: passed ? 0 : 1,
      stdout: markdown,
      updateState: true,
    });
  }

  // Propagate the verdict to the real process's exit status - unconditional, unlike the receipt
  // above, because task:check is used as a gate (validator-engine.ts spawns it; every compiled
  // plan's `--typecheck` gate form does too). Previously this command only ever resolved, never
  // threw, so a computed FAIL still exited 0. `Bun.argv[1]` is the resolved entry script for this
  // whole process, so it scopes the mutation to genuine `bun harness.ts` invocations without
  // touching `bun:test`'s own process - unlike a NODE_ENV/argv-content heuristic, which would
  // false-positive on any --file path that happens to contain the substring "test" (e.g. checking
  // a *.test.ts file) and silently reintroduce this exact defect for that class of invocations.
  const entryScript = Bun.argv[1];
  if (entryScript !== undefined && entryScript.endsWith("/harness.ts")) {
    process.exitCode = passed ? 0 : 1;
  }

  let inspectProjection: TaskInspectionProjection | undefined = undefined;
  let finalMarkdown = markdown;
  if (requestedInspect && !isStringBlank(runRoot) && !isStringBlank(taskId)) {
    try {
      inspectProjection = projectTaskInspection(runRoot as string, taskId as string);
      finalMarkdown = `${markdown}\n\n${formatTaskInspectMarkdown(inspectProjection)}`;
    } catch {
      // Keep markdown as is if inspection fails
    }
  }

  return {
    markdown: finalMarkdown,
    passed,
    run_root: runRoot,
    task_id: taskId,
    files_checked: targetFiles,
    evidence_path: evidencePath,
    inspect: inspectProjection,
    typecheck:
      typecheckResult !== undefined
        ? {
            passed: typecheckResult.passed,
            total_files: typecheckResult.totalFiles,
            total_errors: typecheckResult.totalErrors,
            total_warnings: typecheckResult.totalWarnings,
            diagnostics: typecheckResult.diagnostics,
          }
        : undefined,
    // The AST lint audit always runs (see the always-on rationale above), so lintResult is
    // never undefined here - unlike typecheck, it has no "did not run" state to represent.
    lint: {
      passed: lintResult.passed,
      total_files: lintResult.totalFiles,
      total_violations: lintResult.totalViolations,
      violations: lintResult.violations,
      summary_by_rule: lintResult.summaryByRule,
    },
    duration_ms: durationMs,
    format: formatOption,
  };
}

/**
 * Projects a concise, compact read-model of task execution status, gate commands,
 * gate proof hashes, review verdicts, and active lease credentials.
 * Reads solely from the capsule state projection without parsing raw events.jsonl.
 */
export function projectTaskInspection(runRoot: string, taskId: string): TaskInspectionProjection {
  const normalizedRunRoot = resolve(runRoot.trim());
  let state: Record<string, unknown> | undefined;

  try {
    const loaded = loadRunProjection(normalizedRunRoot);
    if (loaded && loaded.state && typeof loaded.state === "object") {
      state = loaded.state as Record<string, unknown>;
    }
  } catch {
    // Fall back to loadRun without verify or direct state.json
  }

  if (!state) {
    try {
      const loaded = loadRun(normalizedRunRoot, false);
      if (loaded && loaded.state && typeof loaded.state === "object") {
        state = loaded.state as Record<string, unknown>;
      }
    } catch {
      // Fall through
    }
  }

  if (!state) {
    const statePath = join(normalizedRunRoot, "state.json");
    if (existsSync(statePath)) {
      try {
        const raw = JSON.parse(readFileSync(statePath, "utf8"));
        if (raw && typeof raw === "object") {
          state = raw as Record<string, unknown>;
        }
      } catch {
        // ignore
      }
    }
  }

  if (!state) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Capsule run state not found at ${normalizedRunRoot}`,
    );
  }

  const rawTasks = state.tasks;
  let tasks: Record<string, unknown> = {};
  if (rawTasks && typeof rawTasks === "object" && !Array.isArray(rawTasks)) {
    tasks = rawTasks as Record<string, unknown>;
  } else {
    tasks = readRunTasks(normalizedRunRoot) as unknown as Record<string, unknown>;
  }

  const cleanTaskId = taskId.trim();
  const task = tasks[cleanTaskId] as Record<string, unknown> | undefined;
  if (!task) {
    throw new HarnessError("INVALID_ARGUMENT", `Task not found in run: ${cleanTaskId}`);
  }

  const status = typeof task.status === "string" ? task.status : "unknown";
  const label = typeof task.label === "string" ? task.label : undefined;

  // Gate command resolution
  let gateCommand: readonly string[] | string | null = null;
  if (typeof task.gate === "string" && task.gate.trim().length > 0) {
    gateCommand = task.gate.trim();
  } else if (Array.isArray(task.gate) && task.gate.length > 0) {
    gateCommand = task.gate as readonly string[];
  } else if (typeof task.gate_command === "string" && task.gate_command.trim().length > 0) {
    gateCommand = task.gate_command.trim();
  } else if (Array.isArray(task.gate_command) && task.gate_command.length > 0) {
    gateCommand = task.gate_command as readonly string[];
  } else {
    const candidateGates: Array<Record<string, unknown>> = [];
    if (Array.isArray(state.gates)) {
      for (const g of state.gates) {
        if (g && typeof g === "object") candidateGates.push(g as Record<string, unknown>);
      }
    }
    const graph = state.graph as Record<string, unknown> | undefined;
    if (graph && Array.isArray(graph.gates)) {
      for (const g of graph.gates) {
        if (g && typeof g === "object") candidateGates.push(g as Record<string, unknown>);
      }
    }

    const taskReqs = Array.isArray(task.requirement_ids) ? (task.requirement_ids as string[]) : [];
    for (const g of candidateGates) {
      const gId = typeof g.id === "string" ? g.id : "";
      const gTaskId = typeof g.task_id === "string" ? g.task_id : "";
      const gReqs = Array.isArray(g.requirement_ids) ? (g.requirement_ids as string[]) : [];

      if (
        gTaskId === cleanTaskId ||
        gId === `gate-${cleanTaskId}` ||
        gId === cleanTaskId ||
        (taskReqs.length > 0 && gReqs.some((r) => taskReqs.includes(r)))
      ) {
        if (Array.isArray(g.command)) {
          gateCommand = g.command as readonly string[];
          break;
        } else if (typeof g.command === "string") {
          gateCommand = g.command;
          break;
        }
      }
    }
  }

  // Gate proof hash resolution
  let gateProofHash: string | null = null;
  if (typeof task.gate_proof_hash === "string" && task.gate_proof_hash.trim().length > 0) {
    gateProofHash = task.gate_proof_hash.trim();
  } else if (typeof task.proof_hash === "string" && task.proof_hash.trim().length > 0) {
    gateProofHash = task.proof_hash.trim();
  } else {
    const proofs = Array.isArray(state.gate_proofs)
      ? (state.gate_proofs as Array<Record<string, unknown>>)
      : [];
    for (const p of proofs) {
      if (p.task_id === cleanTaskId) {
        if (typeof p.proof_hash === "string" && p.proof_hash.trim().length > 0) {
          gateProofHash = p.proof_hash.trim();
          break;
        } else if (typeof p.hash === "string" && p.hash.trim().length > 0) {
          gateProofHash = p.hash.trim();
          break;
        } else if (typeof p.base === "string" && p.base.trim().length > 0) {
          const hashInput = `${p.base}:${Array.isArray(p.gate_argv) ? p.gate_argv.join(" ") : ""}`;
          gateProofHash = createHash("sha256").update(hashInput).digest("hex").slice(0, 16);
          break;
        } else {
          gateProofHash = createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 16);
          break;
        }
      }
    }
  }

  // Review verdicts resolution
  const reviewVerdicts: TaskReviewVerdictProjection[] = [];
  if (Array.isArray(task.validations)) {
    for (const v of task.validations as Array<Record<string, unknown>>) {
      reviewVerdicts.push({
        validatorId: typeof v.validator_id === "string" ? v.validator_id : undefined,
        domain: typeof v.domain === "string" ? v.domain : undefined,
        verdict: typeof v.verdict === "string" ? v.verdict : "unknown",
        reviewedAt:
          typeof v.started_at === "string"
            ? v.started_at
            : typeof v.reviewed_at === "string"
              ? v.reviewed_at
              : undefined,
        summary: typeof v.summary === "string" ? v.summary : undefined,
      });
    }
  }
  if (Array.isArray(task.reviews)) {
    for (const r of task.reviews as Array<Record<string, unknown>>) {
      reviewVerdicts.push({
        validatorId:
          typeof r.actor === "string"
            ? r.actor
            : typeof r.validator_id === "string"
              ? r.validator_id
              : undefined,
        verdict:
          typeof r.verdict === "string"
            ? r.verdict
            : typeof r.status === "string"
              ? r.status
              : "unknown",
        summary: typeof r.summary === "string" ? r.summary : undefined,
      });
    }
  }
  if (reviewVerdicts.length === 0 && typeof task.verdict === "string") {
    reviewVerdicts.push({
      verdict: task.verdict,
    });
  }

  // Lease resolution
  let lease: TaskLeaseProjection | null = null;
  if (task.lease && typeof task.lease === "object") {
    const l = task.lease as Record<string, unknown>;
    const agentId =
      typeof l.agent_id === "string"
        ? l.agent_id
        : typeof l.agent === "string"
          ? l.agent
          : "unknown";
    const expiresAt = typeof l.expires_at === "string" ? l.expires_at : undefined;
    const token =
      typeof l.token === "string"
        ? l.token
        : typeof l.lease_token === "string"
          ? l.lease_token
          : typeof l.tokenSnippet === "string"
            ? l.tokenSnippet
            : undefined;
    let tokenSnippet: string | undefined = undefined;
    if (typeof l.token_snippet === "string") {
      tokenSnippet = l.token_snippet;
    } else if (token) {
      tokenSnippet =
        token.length > 10 ? `${token.slice(0, 6)}...${token.slice(-4)}` : `${token.slice(0, 4)}...`;
    }
    lease = { agentId, expiresAt, tokenSnippet };
  } else if (
    typeof task.agent_id === "string" &&
    (status === "leased" || status === "running" || status === "validating")
  ) {
    lease = { agentId: task.agent_id };
  }

  return {
    taskId: cleanTaskId,
    label,
    status,
    gateCommand,
    gateProofHash,
    reviewVerdicts,
    lease,
  };
}

/**
 * Formats a task inspection projection into clean Markdown.
 */
export function formatTaskInspectMarkdown(projection: TaskInspectionProjection): string {
  const lines: string[] = [];
  lines.push(`### 🔍 Task Inspection: \`${projection.taskId}\``);
  if (projection.label) {
    lines.push(`- **Label**: ${projection.label}`);
  }
  lines.push(`- **Status**: \`${projection.status}\``);

  const gateCmdStr = Array.isArray(projection.gateCommand)
    ? projection.gateCommand.join(" ")
    : (projection.gateCommand ?? "none");
  lines.push(`- **Gate Command**: \`${gateCmdStr}\``);
  lines.push(
    `- **Gate Proof Hash**: ${projection.gateProofHash ? `\`${projection.gateProofHash}\`` : "_none_"}`,
  );

  if (projection.lease) {
    lines.push(
      `- **Active Lease**: Agent \`${projection.lease.agentId}\`${projection.lease.expiresAt ? ` (expires ${projection.lease.expiresAt})` : ""}`,
    );
  } else {
    lines.push(`- **Active Lease**: _none_`);
  }

  lines.push("");
  lines.push("#### Review Verdicts");
  if (projection.reviewVerdicts.length === 0) {
    lines.push("_No review verdicts recorded._");
  } else {
    const headers = ["Validator", "Domain", "Verdict", "Summary"];
    const rows = projection.reviewVerdicts.map((v) => [
      v.validatorId ? `\`${v.validatorId}\`` : "—",
      v.domain ? `\`${v.domain}\`` : "—",
      `**${v.verdict.toUpperCase()}**`,
      v.summary ?? "—",
    ]);
    const tableLines = formatTable(headers, rows);
    for (const t of tableLines) {
      lines.push(t);
    }
  }

  return enforceLineLimit(lines.join("\n"), 40);
}

/**
 * CLI Command: task:inspect
 * Standalone query command returning a concise projection of task status.
 */
export async function taskInspectCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const runRoot = textFlag(flags, "run", true);
  const taskId = textFlag(flags, "task", true);
  const formatFlag = textFlag(flags, "format", false);
  const format: "markdown" | "json" = formatFlag === "json" ? "json" : "markdown";

  if (!runRoot || !taskId) {
    throw new HarnessError("INVALID_ARGUMENT", "--run and --task are required for task:inspect");
  }

  const projection = projectTaskInspection(runRoot, taskId);
  const markdown = formatTaskInspectMarkdown(projection);

  return {
    markdown,
    format,
    task_id: projection.taskId,
    label: projection.label,
    status: projection.status,
    gate_command: projection.gateCommand,
    gate_proof_hash: projection.gateProofHash,
    review_verdicts: projection.reviewVerdicts,
    lease: projection.lease,
  };
}

/**
 * Projects a wave-level summary of the capsule without parsing raw events.jsonl.
 */
export function projectCapsuleSummary(runRoot: string): CapsuleWaveSummary {
  const normalizedRunRoot = resolve(runRoot.trim());
  let state: Record<string, unknown> | undefined;
  let runId: string | undefined;

  try {
    const loaded = loadRunProjection(normalizedRunRoot);
    if (loaded && loaded.state && typeof loaded.state === "object") {
      state = loaded.state as Record<string, unknown>;
      runId = loaded.manifest?.run_id ?? (state.run_id as string | undefined);
    }
  } catch {
    // Fall back to loadRun without verify or direct state.json
  }

  if (!state) {
    try {
      const loaded = loadRun(normalizedRunRoot, false);
      if (loaded && loaded.state && typeof loaded.state === "object") {
        state = loaded.state as Record<string, unknown>;
        runId = loaded.manifest?.run_id ?? (state.run_id as string | undefined);
      }
    } catch {
      // Fall through
    }
  }

  if (!state) {
    const statePath = join(normalizedRunRoot, "state.json");
    if (existsSync(statePath)) {
      try {
        const raw = JSON.parse(readFileSync(statePath, "utf8"));
        if (raw && typeof raw === "object") {
          state = raw as Record<string, unknown>;
          runId = state.run_id as string | undefined;
        }
      } catch {
        // ignore
      }
    }
  }

  if (!state) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Capsule run state not found at ${normalizedRunRoot}`,
    );
  }

  const rawTasks = state.tasks;
  let tasks: Record<string, Record<string, unknown>> = {};
  if (rawTasks && typeof rawTasks === "object" && !Array.isArray(rawTasks)) {
    tasks = rawTasks as Record<string, Record<string, unknown>>;
  } else {
    tasks = readRunTasks(normalizedRunRoot) as unknown as Record<string, Record<string, unknown>>;
  }

  const totalTasks = Object.keys(tasks).length;
  const globalStatusCounts: Record<string, number> = {};

  for (const task of Object.values(tasks)) {
    const s = typeof task.status === "string" ? task.status : "unknown";
    globalStatusCounts[s] = (globalStatusCounts[s] ?? 0) + 1;
  }

  const waveMap = new Map<number, WaveTaskSummary[]>();
  const topology = state.topology as Record<string, unknown> | undefined;

  if (topology && Array.isArray(topology.waves)) {
    for (const w of topology.waves as Array<Record<string, unknown>>) {
      const waveNum = typeof w.wave === "number" ? w.wave : 1;
      const tIds = Array.isArray(w.task_ids) ? (w.task_ids as string[]) : [];
      const waveTasks: WaveTaskSummary[] = [];
      for (const id of tIds) {
        const t = tasks[id];
        if (t) {
          const dependencies = Array.isArray(t.dependencies) ? (t.dependencies as string[]) : [];
          const writeScope = Array.isArray(t.write_scope) ? (t.write_scope as string[]) : [];
          waveTasks.push({
            taskId: id,
            label: typeof t.label === "string" ? t.label : "",
            status: typeof t.status === "string" ? t.status : "unknown",
            dependencies,
            writeScopeCount: writeScope.length,
          });
        }
      }
      waveMap.set(waveNum, waveTasks);
    }
  } else if (topology && Array.isArray(topology.decisions)) {
    for (const d of topology.decisions as Array<Record<string, unknown>>) {
      const waveNum = typeof d.wave === "number" ? d.wave : 1;
      const tId = typeof d.task_id === "string" ? d.task_id : "";
      const t = tasks[tId];
      if (t) {
        const existing = waveMap.get(waveNum) ?? [];
        const dependencies = Array.isArray(t.dependencies) ? (t.dependencies as string[]) : [];
        const writeScope = Array.isArray(t.write_scope) ? (t.write_scope as string[]) : [];
        existing.push({
          taskId: tId,
          label: typeof t.label === "string" ? t.label : "",
          status: typeof t.status === "string" ? t.status : "unknown",
          dependencies,
          writeScopeCount: writeScope.length,
        });
        waveMap.set(waveNum, existing);
      }
    }
  } else {
    const wave1: WaveTaskSummary[] = [];
    const wave2: WaveTaskSummary[] = [];
    for (const [id, t] of Object.entries(tasks)) {
      const dependencies = Array.isArray(t.dependencies) ? (t.dependencies as string[]) : [];
      const writeScope = Array.isArray(t.write_scope) ? (t.write_scope as string[]) : [];
      const item: WaveTaskSummary = {
        taskId: id,
        label: typeof t.label === "string" ? t.label : "",
        status: typeof t.status === "string" ? t.status : "unknown",
        dependencies,
        writeScopeCount: writeScope.length,
      };
      if (dependencies.length === 0) {
        wave1.push(item);
      } else {
        wave2.push(item);
      }
    }
    if (wave1.length > 0) waveMap.set(1, wave1);
    if (wave2.length > 0) waveMap.set(2, wave2);
    if (waveMap.size === 0) waveMap.set(1, []);
  }

  const waves: WaveSummary[] = [];
  const sortedWaveNums = Array.from(waveMap.keys()).sort((a, b) => a - b);
  for (const num of sortedWaveNums) {
    const waveTasks = waveMap.get(num) ?? [];
    const waveCounts: Record<string, number> = {};
    for (const wt of waveTasks) {
      waveCounts[wt.status] = (waveCounts[wt.status] ?? 0) + 1;
    }
    waves.push({
      wave: num,
      tasks: waveTasks,
      statusCounts: waveCounts,
    });
  }

  return {
    runRoot: normalizedRunRoot,
    runId,
    totalTasks,
    statusCounts: globalStatusCounts,
    waves,
  };
}

/**
 * Formats a capsule wave summary projection into clean Markdown.
 */
export function formatCapsuleSummaryMarkdown(summary: CapsuleWaveSummary): string {
  const lines: string[] = [];
  lines.push(`### 📋 Capsule Wave Summary`);
  if (summary.runId) {
    lines.push(`- **Run ID**: \`${summary.runId}\``);
  }
  lines.push(`- **Total Tasks**: ${summary.totalTasks}`);
  const statusParts = Object.entries(summary.statusCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}: ${count}`);
  lines.push(
    `- **Status Breakdown**: ${statusParts.length > 0 ? statusParts.join(" · ") : "none"}`,
  );
  lines.push("");

  for (const wave of summary.waves) {
    lines.push(`#### 🌊 Wave ${wave.wave} (${wave.tasks.length} tasks)`);
    if (wave.tasks.length === 0) {
      lines.push("_No tasks assigned to this wave._");
    } else {
      const headers = ["Task ID", "Label", "Status", "Dependencies"];
      const rows = wave.tasks.map((t) => [
        `\`${t.taskId}\``,
        t.label || "—",
        `\`${t.status}\``,
        t.dependencies.length > 0 ? t.dependencies.join(", ") : "none",
      ]);
      const tableLines = formatTable(headers, rows);
      for (const t of tableLines) {
        lines.push(t);
      }
    }
    lines.push("");
  }

  return enforceLineLimit(lines.join("\n"), 40);
}

/**
 * CLI Command: capsule:summary
 * Standalone query command returning a wave-level summary of the capsule.
 */
export async function capsuleSummaryCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const runRoot = textFlag(flags, "run", true);
  const formatFlag = textFlag(flags, "format", false);
  const format: "markdown" | "json" = formatFlag === "json" ? "json" : "markdown";

  if (!runRoot) {
    throw new HarnessError("INVALID_ARGUMENT", "--run is required for capsule:summary");
  }

  const summary = projectCapsuleSummary(runRoot);
  const markdown = formatCapsuleSummaryMarkdown(summary);

  return {
    markdown,
    format,
    run_root: summary.runRoot,
    run_id: summary.runId,
    total_tasks: summary.totalTasks,
    status_counts: summary.statusCounts,
    waves: summary.waves,
  };
}
