/**
 * CLI command: task-check (task:check)
 * Fast incremental verification tool for targeted files and task write scopes.
 * Performs fast TypeScript type checking and AST invariant audits (0 any, 0 compiler suppressions).
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import {
  ALL_AST_LINT_RULES,
  lintFile,
  type AstLintOptions,
  type AstLintRule,
  type AstLintViolation,
} from "../../linter/ast-enforcer.ts";
import { loadRun } from "../../engine/store/index.ts";
import { AutoReceiptLogger } from "../../engine/runner/auto-receipt.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import { enforceLineLimit, formatTable } from "../formatters/line-limiter.ts";
import { boolFlag, listFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

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
 * Recursively collects supported source files in a directory.
 */
export function collectSourceFilesRecursively(
  dirPath: string,
  maxDepth = 10,
  currentDepth = 0,
): readonly string[] {
  if (currentDepth > maxDepth) {
    return [];
  }
  if (!existsSync(dirPath)) {
    return [];
  }

  const results: string[] = [];
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith("node_modules")) {
        continue;
      }
      if (entry.name.startsWith(".git")) {
        continue;
      }
      const fullPath = resolve(dirPath, entry.name);
      if (entry.isDirectory()) {
        const nested = collectSourceFilesRecursively(fullPath, maxDepth, currentDepth + 1);
        for (const f of nested) {
          results.push(f);
        }
      } else if (entry.isFile()) {
        if (isSupportedSourceFile(entry.name)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Directory unreadable, return accumulated results
  }

  return results;
}

/**
 * Reads tasks from a capsule run using workflow port or loaded run state.
 */
function readRunTasks(runRoot: string): Record<string, TaskRecord> {
  try {
    const wf = workflowPort(runRoot).read();
    return wf.tasks;
  } catch {
    const loaded = loadRun(runRoot);
    const rawState = loaded.state as Record<string, unknown>;
    const rawTasks = rawState.tasks;
    if (typeof rawTasks === "object" && rawTasks !== null && !Array.isArray(rawTasks)) {
      return rawTasks as Record<string, TaskRecord>;
    }
    return {};
  }
}

/**
 * Resolves target files to check based on explicit file flags, task write scopes, or run state.
 */
export function resolveTargetFiles(options: ResolveTargetFilesOptions): readonly string[] {
  const resolvedSet = new Set<string>();

  // 1. Explicit file flags
  if (!isListEmpty(options.fileFlags) && options.fileFlags !== undefined) {
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

  // 2. Task write scope from capsule run
  if (!isStringBlank(options.taskId) && options.taskId !== undefined) {
    const runRoot = options.runRoot;
    if (runRoot === undefined) {
      throw new HarnessError("INVALID_ARGUMENT", "--run is required when --task is specified");
    }
    if (runRoot.trim().length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "--run is required when --task is specified");
    }

    const tasks = readRunTasks(runRoot);
    const task: TaskRecord | undefined = tasks[options.taskId];
    if (task === undefined) {
      throw new HarnessError("INVALID_ARGUMENT", `unknown task ${options.taskId}`);
    }

    const candidatePaths: string[] = [];
    if (Array.isArray(task.target_files)) {
      for (const item of task.target_files) {
        if (typeof item === "string" && item.trim().length > 0) {
          candidatePaths.push(item.trim());
        }
      }
    }
    if (Array.isArray(task.write_scope)) {
      for (const item of task.write_scope) {
        if (typeof item === "string" && item.trim().length > 0) {
          candidatePaths.push(item.trim());
        }
      }
    }

    for (const candidate of candidatePaths) {
      const absPath = resolve(candidate);
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
        // Even if not yet created on disk, include if it is a source file path
        if (isSupportedSourceFile(candidate)) {
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
    isListEmpty(options.fileFlags) &&
    isStringBlank(options.taskId)
  ) {
    const tasks = readRunTasks(rootForScope);
    for (const task of Object.values(tasks)) {
      const scopeItems = Array.isArray(task.write_scope) ? task.write_scope : [];
      for (const item of scopeItems) {
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

  const found = ts.findConfigFile(startDir, ts.sys.fileExists, "tsconfig.json");
  if (found !== undefined) {
    return found;
  }

  const cwdConfig = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
  if (cwdConfig !== undefined) {
    return cwdConfig;
  }

  return undefined;
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
  const formatFlag = textFlag(flags, "format", false);
  const formatOption: "markdown" | "json" = formatFlag === "json" ? "json" : "markdown";

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
    try {
      const evidenceDir = join(resolve(runRoot), "evidence");
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
      const actorFlagVal = textFlag(flags, "actor", false);
      const actor = actorFlagVal !== undefined ? actorFlagVal : "mechanic-validator";
      const taskIdVal = taskId !== undefined ? taskId : "task:check";
      AutoReceiptLogger.recordReceipt(resolve(runRoot), {
        taskId: taskIdVal,
        actor,
        command: "task:check",
        argv: ["task:check", ...(taskId ? ["--task", taskId] : []), ...targetFiles],
        exitCode: passed ? 0 : 1,
        stdout: markdown,
        updateState: true,
      });
    } catch {
      // Non-fatal if evidence or receipt write fails
    }
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

  return {
    markdown,
    passed,
    run_root: runRoot,
    task_id: taskId,
    files_checked: targetFiles,
    evidence_path: evidencePath,
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
