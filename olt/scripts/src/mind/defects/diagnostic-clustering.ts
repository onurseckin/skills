/**
 * @file diagnostic-clustering.ts
 * Mind System - Active Empirical Baseline Probing & Diagnostic Clustering Engine
 *
 * Implements:
 * 1. Automated Baseline Probing Runner:
 *    - Executes or simulates diagnostic test suites, typechecks, linter checks, and health probes.
 *    - Captures exit codes, execution timing, stdout, stderr, and raw failures.
 * 2. Multi-Dialect Diagnostic Error Parser:
 *    - Parses TypeScript compiler traces (tsc), ESLint/linter outputs, test runner assertion
 *      failures (Bun, Jest, Vitest, Mocha), runtime crashes, uncaught exceptions, invariant violations,
 *      and module resolution failures.
 * 3. Diagnostic Clustering Algorithm:
 *    - Deduplicates raw error occurrences into unified DeficitClusterNode structures.
 *    - Heuristic grouping by error code, target file, stack trace fingerprint, token similarity,
 *      and cascading dependency chains.
 * 4. Three Criticality Classes:
 *    - CLASS_1_BLOCKER: Compilation errors, syntax errors, uncaught exceptions, system crashes, boot deadlocks.
 *    - CLASS_2_REGRESSION: Broken unit/integration tests, invariant violations, contract regressions.
 *    - CLASS_3_QUALITY_DEFICIT: Lint warnings, code style issues, test gaps, performance slowdowns, doc gaps.
 * 5. Deficit Topology Matrix Synthesis:
 *    - Matrix metadata, summary statistics, cluster nodes, subsystem health scores (0.0 - 1.0),
 *      and dynamically adjusted 70/20/10 Innovation Portfolio Roadmap allocations.
 * 6. High-Fidelity GitHub-Flavored Markdown Report Formatter.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join, normalize, relative } from "node:path";
import {
  calculateDefectSimilarity,
  createFnv1aHash,
  normalizeObservationSignature,
} from "./core/index.ts";

// ============================================================================
// 1. Criticality Classes & Constants
// ============================================================================

export const DEFICIT_CRITICALITY_CLASSES = {
  CLASS_1_BLOCKER: "CLASS_1_BLOCKER",
  CLASS_2_REGRESSION: "CLASS_2_REGRESSION",
  CLASS_3_QUALITY_DEFICIT: "CLASS_3_QUALITY_DEFICIT",
} as const;

export type DeficitCriticalityClass =
  (typeof DEFICIT_CRITICALITY_CLASSES)[keyof typeof DEFICIT_CRITICALITY_CLASSES];

export const DEFICIT_CRITICALITY_WEIGHTS: Readonly<Record<DeficitCriticalityClass, number>> = {
  CLASS_1_BLOCKER: 1.0,
  CLASS_2_REGRESSION: 0.6,
  CLASS_3_QUALITY_DEFICIT: 0.2,
};

export const DEFICIT_CRITICALITY_BASE_SEVERITY: Readonly<Record<DeficitCriticalityClass, number>> = {
  CLASS_1_BLOCKER: 8.5,
  CLASS_2_REGRESSION: 5.5,
  CLASS_3_QUALITY_DEFICIT: 2.0,
};

export const DIAGNOSTIC_ERROR_KINDS = {
  TYPESCRIPT_COMPILATION: "typescript_compilation",
  SYNTAX_ERROR: "syntax_error",
  RUNTIME_CRASH: "runtime_crash",
  UNCAUGHT_EXCEPTION: "uncaught_exception",
  MODULE_RESOLUTION: "module_resolution",
  BOOT_DEADLOCK: "boot_deadlock",
  TEST_ASSERTION_FAILURE: "test_assertion_failure",
  TEST_TIMEOUT: "test_timeout",
  INVARIANT_VIOLATION: "invariant_violation",
  CONTRACT_REGRESSION: "contract_regression",
  LINT_WARNING: "lint_warning",
  LINT_ERROR: "lint_error",
  CODE_STYLE: "code_style",
  TYPE_CHECK_WARNING: "type_check_warning",
  MISSING_COVERAGE: "missing_coverage",
  PERFORMANCE_SLOWDOWN: "performance_slowdown",
  DOCUMENTATION_GAP: "documentation_gap",
  HEALTH_PROBE_DEGRADATION: "health_probe_degradation",
  UNKNOWN: "unknown",
} as const;

export type DiagnosticErrorKind =
  (typeof DIAGNOSTIC_ERROR_KINDS)[keyof typeof DIAGNOSTIC_ERROR_KINDS];

// ============================================================================
// 2. Data Types & Interfaces
// ============================================================================

export interface ParsedDiagnosticError {
  readonly id: string;
  readonly kind: DiagnosticErrorKind;
  readonly classification: DeficitCriticalityClass;
  readonly errorCode?: string | undefined;
  readonly message: string;
  readonly normalizedMessage: string;
  readonly filePath?: string | undefined;
  readonly relativeFilePath?: string | undefined;
  readonly lineNumber?: number | undefined;
  readonly columnNumber?: number | undefined;
  readonly symbol?: string | undefined;
  readonly subsystem?: string | undefined;
  readonly stackTrace?: readonly string[] | undefined;
  readonly rawStackTrace?: string | undefined;
  readonly stackSignature?: string | undefined;
  readonly rawSnippet?: string | undefined;
  readonly sourceProbe?: string | undefined;
  readonly contextMetadata?: Readonly<Record<string, unknown>> | undefined;
  readonly timestamp: string;
}

export interface DeficitClusterNode {
  readonly clusterId: string;
  readonly rootCauseTitle: string;
  readonly classification: DeficitCriticalityClass;
  readonly severityScore: number;
  readonly affectedFiles: readonly string[];
  readonly affectedSubsystems: readonly string[];
  readonly rawOccurrenceCount: number;
  readonly representativeError: ParsedDiagnosticError;
  readonly stackTraceSignature: string;
  readonly rootCauseHypothesis: string;
  readonly suggestedRemediationAction: string;
  readonly priorityRank: number;
  readonly errorCodes: readonly string[];
  readonly primarySubsystem: string;
  readonly cascadingDownstreamClusters?: readonly string[] | undefined;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly sampleErrorSnippets: readonly string[];
}

export interface DeficitTopologySummary {
  readonly blockers: number;
  readonly regressions: number;
  readonly qualityDeficits: number;
  readonly totalRawErrors: number;
  readonly totalClusters: number;
  readonly compositeFrictionScore: number;
  readonly criticalSubsystems: readonly string[];
  readonly healthStatus: "HEALTHY" | "DEGRADED" | "CRITICAL";
}

export interface RecommendedRoadmapAllocation {
  readonly coreStability: number;
  readonly architecturalEvolution: number;
  readonly exploratory: number;
  readonly rationale: string;
}

export interface DeficitTopologyMatrix {
  readonly matrixId: string;
  readonly generatedAt: string;
  readonly totalRawErrors: number;
  readonly totalClusters: number;
  readonly summary: DeficitTopologySummary;
  readonly clusters: readonly DeficitClusterNode[];
  readonly subsystemHealthScores: Readonly<Record<string, number>>;
  readonly recommendedRoadmapAllocation: RecommendedRoadmapAllocation;
  readonly baselineProbeRunId?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export type ProbeKind = "typecheck" | "test" | "lint" | "health_probe" | "custom";

export interface ProbeExecutionOutput {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly error?: string | undefined;
}

export interface ProbeDefinition {
  readonly name: string;
  readonly kind: ProbeKind;
  readonly command?: string | readonly string[] | undefined;
  readonly customRunner?: (() => Promise<ProbeExecutionOutput> | ProbeExecutionOutput) | undefined;
  readonly timeoutMs?: number | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly required?: boolean | undefined;
}

export interface SingleProbeResult {
  readonly name: string;
  readonly kind: ProbeKind;
  readonly command?: string | undefined;
  readonly passed: boolean;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly parsedErrors: readonly ParsedDiagnosticError[];
  readonly rawErrorSnippet?: string | undefined;
}

export interface BaselineProbeOptions {
  readonly repoRoot?: string | undefined;
  readonly cwd?: string | undefined;
  readonly probes?: readonly ProbeDefinition[] | undefined;
  readonly simulate?: boolean | undefined;
  readonly simulatedOutputs?: Readonly<Record<string, Partial<ProbeExecutionOutput>>> | undefined;
  readonly timeoutMs?: number | undefined;
  readonly continueOnFailure?: boolean | undefined;
  readonly customEnv?: Readonly<Record<string, string>> | undefined;
  readonly onProbeStart?: ((name: string, kind: ProbeKind) => void) | undefined;
  readonly onProbeCompleted?: ((result: SingleProbeResult) => void) | undefined;
}

export interface BaselineProbeResult {
  readonly probeRunId: string;
  readonly timestamp: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly exitCode: number;
  readonly probes: readonly SingleProbeResult[];
  readonly totalProbes: number;
  readonly passedProbes: number;
  readonly failedProbes: number;
  readonly aggregatedRawLog: string;
  readonly parsedErrors: readonly ParsedDiagnosticError[];
  readonly topologyMatrix: DeficitTopologyMatrix;
}

export interface ClusteringOptions {
  readonly matrixId?: string | undefined;
  readonly similarityThreshold?: number | undefined;
  readonly maxClusters?: number | undefined;
  readonly defaultSubsystem?: string | undefined;
  readonly knownSubsystems?: readonly string[] | undefined;
  readonly baseRoadmapAllocation?: {
    readonly coreStability?: number | undefined;
    readonly architecturalEvolution?: number | undefined;
    readonly exploratory?: number | undefined;
  } | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface RawDiagnosticEntryInput {
  readonly filePath?: string | undefined;
  readonly rawError?: string | undefined;
  readonly message?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly code?: string | undefined;
  readonly kind?: DiagnosticErrorKind | undefined;
  readonly stack?: string | undefined;
}

export interface RawDiagnosticInput {
  readonly rawLog?: string | undefined;
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
  readonly sourceProbe?: string | undefined;
  readonly fileEntries?: readonly RawDiagnosticEntryInput[] | undefined;
  readonly structuredErrors?: readonly RawDiagnosticEntryInput[] | undefined;
}

export interface DiagnosticEngineConfig {
  readonly defaultCwd?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly defaultTimeoutMs?: number | undefined;
  readonly similarityThreshold?: number | undefined;
  readonly knownSubsystems?: readonly string[] | undefined;
}

// ============================================================================
// 3. Subsystem & Path Heuristics
// ============================================================================

export const DEFAULT_KNOWN_SUBSYSTEMS: readonly string[] = Object.freeze([
  "mind/core",
  "mind/defects",
  "mind/planning",
  "mind/governance",
  "mind/lifecycle",
  "mind/memory",
  "mind/crucible",
  "mind/auditing",
  "mind/telemetry",
  "mind/proposals",
  "reporting/doctor",
  "server/process",
  "task/queue",
  "workflow",
  "policy",
  "telemetry",
  "logging",
  "testing",
  "system/core",
]);

/**
 * Derives a canonical subsystem identifier from a source file path or diagnostic context.
 */
export function inferSubsystemFromPath(
  filePath?: string,
  message?: string,
  knownSubsystems: readonly string[] = DEFAULT_KNOWN_SUBSYSTEMS,
): string {
  if (typeof filePath === "string" && filePath.trim().length > 0) {
    const normalized = normalize(filePath.replace(/\\/g, "/"));
    for (const subsystem of knownSubsystems) {
      if (normalized.includes(subsystem)) {
        return subsystem;
      }
    }

    const segments = normalized.split("/").filter((s) => s.length > 0 && s !== ".");
    const srcIndex = segments.indexOf("src");
    if (srcIndex >= 0 && srcIndex + 2 <= segments.length) {
      const seg1 = segments[srcIndex + 1];
      const seg2 = segments[srcIndex + 2];
      if (seg1 && seg2 && !seg2.includes(".")) {
        return `${seg1}/${seg2}`;
      }
      if (seg1) {
        return seg1.includes(".") ? "system/core" : seg1;
      }
    }

    if (segments.length >= 2) {
      const topDir = segments[0];
      const subDir = segments[1];
      if (topDir && subDir && !subDir.includes(".")) {
        return `${topDir}/${subDir}`;
      }
      if (topDir && !topDir.includes(".")) {
        return topDir;
      }
    }
  }

  if (typeof message === "string" && message.length > 0) {
    const lower = message.toLowerCase();
    for (const subsystem of knownSubsystems) {
      const parts = subsystem.split("/");
      const lastPart = parts[parts.length - 1];
      if (lastPart && lastPart.length > 3 && lower.includes(lastPart)) {
        return subsystem;
      }
    }
  }

  return "system/core";
}

/**
 * Normalizes stack traces by extracting key call frames and computing a deterministic fingerprint.
 */
export function extractStackFrames(stackOrText: string): readonly string[] {
  if (typeof stackOrText !== "string" || stackOrText.trim().length === 0) {
    return [];
  }

  const lines = stackOrText.split("\n");
  const frames: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("at ") || trimmed.startsWith("at-") || /^\s*at\s+/.test(line)) {
      const cleaned = trimmed
        .replace(/^at\s+/, "")
        .replace(/\(?\/[^\s)]+\/([^/:\s)]+):(\d+):(\d+)\)?/, "$1:<num>:<num>")
        .replace(/\(?([a-zA-Z0-9_\-./]+):(\d+):(\d+)\)?/, "$1:<num>:<num>");
      frames.push(cleaned);
    }
  }

  return frames;
}

/**
 * Computes a robust stack trace signature hash.
 */
export function computeStackSignature(
  frames: readonly string[],
  fallbackMessage: string,
): string {
  if (frames.length > 0) {
    const topFrames = frames.slice(0, 3).join(" | ");
    return `SIG-STK-${createFnv1aHash(topFrames)}`;
  }
  const normMsg = normalizeObservationSignature(fallbackMessage);
  return `SIG-MSG-${createFnv1aHash(normMsg)}`;
}

// ============================================================================
// 4. Diagnostic Parser Engine
// ============================================================================

/**
 * Parses raw compiler logs, test outputs, lint warnings, and runtime crashes
 * into structured `ParsedDiagnosticError` records.
 */
export function parseRawDiagnostics(
  rawInput: string | RawDiagnosticInput,
  sourceProbeName: string = "empirical_probe",
): ParsedDiagnosticError[] {
  const parsedErrors: ParsedDiagnosticError[] = [];
  const nowIso = new Date().toISOString();

  let logText = "";
  let sourceProbe = sourceProbeName;
  let fileEntries: readonly RawDiagnosticEntryInput[] = [];
  let structuredErrors: readonly RawDiagnosticEntryInput[] = [];

  if (typeof rawInput === "string") {
    logText = rawInput;
  } else if (rawInput !== null && typeof rawInput === "object") {
    const parts: string[] = [];
    if (typeof rawInput.rawLog === "string") parts.push(rawInput.rawLog);
    if (typeof rawInput.stdout === "string") parts.push(rawInput.stdout);
    if (typeof rawInput.stderr === "string") parts.push(rawInput.stderr);
    logText = parts.join("\n");

    if (typeof rawInput.sourceProbe === "string") {
      sourceProbe = rawInput.sourceProbe;
    }
    if (Array.isArray(rawInput.fileEntries)) {
      fileEntries = rawInput.fileEntries;
    }
    if (Array.isArray(rawInput.structuredErrors)) {
      structuredErrors = rawInput.structuredErrors;
    }
  }

  // 1. Process Structured Entries if provided
  const combinedEntries = [...fileEntries, ...structuredErrors];
  for (const entry of combinedEntries) {
    if (!entry) continue;
    const msg = entry.message ?? entry.rawError ?? "Unspecified diagnostic error";
    const filePath = entry.filePath;
    const line = entry.line;
    const col = entry.column;
    const code = entry.code;
    const stack = entry.stack;
    const frames = stack ? extractStackFrames(stack) : [];
    const stackSig = computeStackSignature(frames, msg);
    const subsystem = inferSubsystemFromPath(filePath, msg);

    const kind = entry.kind ?? classifyErrorKind(msg, code, filePath);
    const classification = classifyCriticality(kind, code, msg);
    const normMsg = normalizeObservationSignature(msg);
    const errId = `ERR-${createFnv1aHash(`${filePath ?? ""}:${line ?? 0}:${code ?? ""}:${normMsg}`)}`;

    parsedErrors.push({
      id: errId,
      kind,
      classification,
      errorCode: code,
      message: msg.trim(),
      normalizedMessage: normMsg,
      filePath,
      relativeFilePath: filePath ? relative(process.cwd(), filePath) : undefined,
      lineNumber: line,
      columnNumber: col,
      subsystem,
      stackTrace: frames.length > 0 ? frames : undefined,
      rawStackTrace: stack,
      stackSignature: stackSig,
      rawSnippet: entry.rawError,
      sourceProbe,
      timestamp: nowIso,
    });
  }

  // 2. Parse Raw Log Stream line by line and block by block
  if (logText.trim().length > 0) {
    const lines = logText.split(/\r?\n/);
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (line === undefined) {
        i += 1;
        continue;
      }
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        i += 1;
        continue;
      }

      // ----------------------------------------------------------------------
      // A. TypeScript Diagnostic Pattern 1: path/file.ts(line,col): error TS2304: message
      // ----------------------------------------------------------------------
      const tsParenMatch = trimmed.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/i);
      if (tsParenMatch) {
        const filePath = tsParenMatch[1]?.trim();
        const lineNum = parseInt(tsParenMatch[2] ?? "0", 10);
        const colNum = parseInt(tsParenMatch[3] ?? "0", 10);
        const isError = (tsParenMatch[4] ?? "error").toLowerCase() === "error";
        const tsCode = tsParenMatch[5]?.trim();
        let message = tsParenMatch[6]?.trim() ?? "";

        // Capture multi-line context snippet if present
        const snippetLines: string[] = [trimmed];
        while (i + 1 < lines.length && lines[i + 1] && (lines[i + 1]!.startsWith(" ") || lines[i + 1]!.startsWith("\t"))) {
          i += 1;
          snippetLines.push(lines[i]!);
          if (lines[i]!.trim().length > 0 && !lines[i]!.includes("~")) {
            message += ` | ${lines[i]!.trim()}`;
          }
        }

        const kind = isError
          ? DIAGNOSTIC_ERROR_KINDS.TYPESCRIPT_COMPILATION
          : DIAGNOSTIC_ERROR_KINDS.TYPE_CHECK_WARNING;
        const classification = isError
          ? DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER
          : DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT;
        const normMsg = normalizeObservationSignature(message);
        const errId = `ERR-TS-${createFnv1aHash(`${filePath}:${lineNum}:${colNum}:${tsCode}:${normMsg}`)}`;

        parsedErrors.push({
          id: errId,
          kind,
          classification,
          errorCode: tsCode,
          message,
          normalizedMessage: normMsg,
          filePath,
          relativeFilePath: filePath ? relative(process.cwd(), filePath) : undefined,
          lineNumber: lineNum,
          columnNumber: colNum,
          subsystem: inferSubsystemFromPath(filePath, message),
          rawSnippet: snippetLines.join("\n"),
          stackSignature: `SIG-TS-${tsCode ?? "COMP"}`,
          sourceProbe,
          timestamp: nowIso,
        });

        i += 1;
        continue;
      }

      // ----------------------------------------------------------------------
      // B. TypeScript Diagnostic Pattern 2: path/file.ts:line:col - error TS2304: message or path/file.ts:line:col: error TS2304: message
      // ----------------------------------------------------------------------
      const tsDashMatch = trimmed.match(
        /^(.+?):(\d+):(\d+)(?:\s+-|:)?\s+(error|warning)\s+(TS\d+):\s+(.+)$/i,
      );

      if (tsDashMatch) {
        const filePath = tsDashMatch[1]?.trim();
        const lineNum = parseInt(tsDashMatch[2] ?? "0", 10);
        const colNum = parseInt(tsDashMatch[3] ?? "0", 10);
        const isError = (tsDashMatch[4] ?? "error").toLowerCase() === "error";
        const tsCode = tsDashMatch[5]?.trim();
        let message = tsDashMatch[6]?.trim() ?? "";

        const snippetLines: string[] = [trimmed];
        while (i + 1 < lines.length && lines[i + 1] && (lines[i + 1]!.startsWith(" ") || lines[i + 1]!.startsWith("\t"))) {
          i += 1;
          snippetLines.push(lines[i]!);
          if (lines[i]!.trim().length > 0 && !lines[i]!.includes("~")) {
            message += ` | ${lines[i]!.trim()}`;
          }
        }

        const kind = isError
          ? DIAGNOSTIC_ERROR_KINDS.TYPESCRIPT_COMPILATION
          : DIAGNOSTIC_ERROR_KINDS.TYPE_CHECK_WARNING;
        const classification = isError
          ? DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER
          : DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT;
        const normMsg = normalizeObservationSignature(message);
        const errId = `ERR-TS-${createFnv1aHash(`${filePath}:${lineNum}:${colNum}:${tsCode}:${normMsg}`)}`;

        parsedErrors.push({
          id: errId,
          kind,
          classification,
          errorCode: tsCode,
          message,
          normalizedMessage: normMsg,
          filePath,
          relativeFilePath: filePath ? relative(process.cwd(), filePath) : undefined,
          lineNumber: lineNum,
          columnNumber: colNum,
          subsystem: inferSubsystemFromPath(filePath, message),
          rawSnippet: snippetLines.join("\n"),
          stackSignature: `SIG-TS-${tsCode ?? "COMP"}`,
          sourceProbe,
          timestamp: nowIso,
        });

        i += 1;
        continue;
      }

      // ----------------------------------------------------------------------
      // C. Linter Pattern: path/file.ts:line:col: message [rule-name] or [error/rule-name]
      // ----------------------------------------------------------------------
      const lintMatch = trimmed.match(
        /^(.+?):(\d+):(\d+):\s+(.+?)\s+\[(?:(error|warning)\/)?([^\]]+)\]$/i,
      );
      if (lintMatch) {
        const filePath = lintMatch[1]?.trim();
        const lineNum = parseInt(lintMatch[2] ?? "0", 10);
        const colNum = parseInt(lintMatch[3] ?? "0", 10);
        const message = lintMatch[4]?.trim() ?? "";
        const severityStr = (lintMatch[5] ?? "").toLowerCase();
        let ruleName = lintMatch[6]?.trim();

        let isErr = severityStr === "error";
        if (ruleName && (ruleName.toLowerCase() === "error" || ruleName.toLowerCase() === "warning")) {
          isErr = ruleName.toLowerCase() === "error";
          ruleName = undefined;
        }

        const kind = isErr ? DIAGNOSTIC_ERROR_KINDS.LINT_ERROR : DIAGNOSTIC_ERROR_KINDS.LINT_WARNING;
        const classification = DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT;
        const normMsg = normalizeObservationSignature(message);
        const errId = `ERR-LINT-${createFnv1aHash(`${filePath}:${lineNum}:${ruleName ?? ""}:${normMsg}`)}`;

        parsedErrors.push({
          id: errId,
          kind,
          classification,
          errorCode: ruleName ?? "LINT",
          message,
          normalizedMessage: normMsg,
          filePath,
          relativeFilePath: filePath ? relative(process.cwd(), filePath) : undefined,
          lineNumber: lineNum,
          columnNumber: colNum,
          subsystem: inferSubsystemFromPath(filePath, message),
          rawSnippet: trimmed,
          stackSignature: `SIG-LINT-${ruleName ?? "RULE"}`,
          sourceProbe,
          timestamp: nowIso,
        });

        i += 1;
        continue;
      }


      // ----------------------------------------------------------------------
      // D. Test Runner Assertion / Failure: FAIL / ✗ / expect().toBe / AssertionError
      // ----------------------------------------------------------------------
      const isTestFailMarker =
        trimmed.startsWith("FAIL ") ||
        trimmed.startsWith("✗ ") ||
        trimmed.startsWith("✖ ") ||
        trimmed.includes("error: test failed") ||
        trimmed.startsWith("AssertionError:") ||
        trimmed.startsWith("Assertion failed:");

      if (isTestFailMarker) {
        let testPath: string | undefined = undefined;
        if (trimmed.startsWith("FAIL ")) {
          testPath = trimmed.replace(/^FAIL\s+/, "").trim();
        }

        let fullMessage = trimmed;
        const stackLines: string[] = [];
        let lineNum: number | undefined = undefined;
        let colNum: number | undefined = undefined;

        // Slurp following stack trace lines
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (!nextLine) {
            i += 1;
            break;
          }
          const nextTrimmed = nextLine.trim();
          const nextLower = nextTrimmed.toLowerCase();
          if (
            nextTrimmed.startsWith("at ") ||
            nextTrimmed.startsWith("at-") ||
            nextLower.startsWith("error:") ||
            nextLower.startsWith("expect(") ||
            nextLower.startsWith("expected:") ||
            nextLower.startsWith("received:") ||
            nextLower.startsWith("assert") ||
            nextLower.startsWith("fail") ||
            /^\s+at\s+/.test(nextLine) ||
            nextLine.startsWith(" ") ||
            nextLine.startsWith("\t")
          ) {
            i += 1;
            stackLines.push(nextTrimmed);
            fullMessage += `\n${nextTrimmed}`;

            if (!testPath) {
              const fileInStack = nextTrimmed.match(/(?:at\s+.*?\()?([a-zA-Z0-9_\-./]+\.(?:ts|js|tsx|jsx)):(\d+):(\d+)/);
              if (fileInStack) {
                testPath = fileInStack[1];
                lineNum = parseInt(fileInStack[2] ?? "0", 10);
                colNum = parseInt(fileInStack[3] ?? "0", 10);
              }
            }
          } else {
            break;
          }
        }


        const frames = extractStackFrames(stackLines.join("\n"));
        const stackSig = computeStackSignature(frames, fullMessage);
        const kind = DIAGNOSTIC_ERROR_KINDS.TEST_ASSERTION_FAILURE;
        const classification = DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION;
        const normMsg = normalizeObservationSignature(fullMessage);
        const errId = `ERR-TEST-${createFnv1aHash(`${testPath ?? ""}:${stackSig}:${normMsg}`)}`;

        parsedErrors.push({
          id: errId,
          kind,
          classification,
          errorCode: "AssertionError",
          message: fullMessage,
          normalizedMessage: normMsg,
          filePath: testPath,
          relativeFilePath: testPath ? relative(process.cwd(), testPath) : undefined,
          lineNumber: lineNum,
          columnNumber: colNum,
          subsystem: inferSubsystemFromPath(testPath, fullMessage),
          stackTrace: frames.length > 0 ? frames : undefined,
          rawStackTrace: stackLines.join("\n"),
          stackSignature: stackSig,
          rawSnippet: [trimmed, ...stackLines].join("\n"),
          sourceProbe,
          timestamp: nowIso,
        });

        i += 1;
        continue;
      }

      // ----------------------------------------------------------------------
      // E. Runtime Crash / Uncaught Exception / Deadlock
      // ----------------------------------------------------------------------
      const isExceptionHeader =
        /^(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|Error|InvariantViolation|ContractRegression|BoundaryViolation):\s*(.+)$/.test(
          trimmed,
        );

      if (isExceptionHeader) {
        const headerMatch = trimmed.match(
          /^(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|Error|InvariantViolation|ContractRegression|BoundaryViolation):\s*(.+)$/,
        );
        const errorTypeName = headerMatch ? headerMatch[1] : "Error";
        let message = headerMatch && headerMatch[2] ? headerMatch[2] : trimmed;
        const stackLines: string[] = [];
        let filePath: string | undefined = undefined;
        let lineNum: number | undefined = undefined;
        let colNum: number | undefined = undefined;

        // Slurp stack frames
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (!nextLine) {
            i += 1;
            break;
          }
          const nextTrimmed = nextLine.trim();
          if (nextTrimmed.startsWith("at ") || /^\s+at\s+/.test(nextLine)) {
            i += 1;
            stackLines.push(nextTrimmed);
            if (!filePath) {
              const fileInStack = nextTrimmed.match(/(?:at\s+.*?\()?([a-zA-Z0-9_\-./]+\.(?:ts|js|tsx|jsx)):(\d+):(\d+)/);
              if (fileInStack) {
                filePath = fileInStack[1];
                lineNum = parseInt(fileInStack[2] ?? "0", 10);
                colNum = parseInt(fileInStack[3] ?? "0", 10);
              }
            }
          } else {
            break;
          }
        }

        const frames = extractStackFrames(stackLines.join("\n"));
        const stackSig = computeStackSignature(frames, message);

        let kind: DiagnosticErrorKind = DIAGNOSTIC_ERROR_KINDS.RUNTIME_CRASH;
        let classification: DeficitCriticalityClass = DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER;

        if (errorTypeName === "InvariantViolation" || errorTypeName === "ContractRegression" || errorTypeName === "BoundaryViolation") {
          kind = DIAGNOSTIC_ERROR_KINDS.INVARIANT_VIOLATION;
          classification = DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION;
        } else if (errorTypeName === "SyntaxError") {
          kind = DIAGNOSTIC_ERROR_KINDS.SYNTAX_ERROR;
          classification = DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER;
        }

        const normMsg = normalizeObservationSignature(message);
        const errId = `ERR-EXC-${createFnv1aHash(`${errorTypeName}:${filePath ?? ""}:${lineNum ?? 0}:${normMsg}`)}`;

        parsedErrors.push({
          id: errId,
          kind,
          classification,
          errorCode: errorTypeName,
          message: `${errorTypeName}: ${message}`,
          normalizedMessage: normMsg,
          filePath,
          relativeFilePath: filePath ? relative(process.cwd(), filePath) : undefined,
          lineNumber: lineNum,
          columnNumber: colNum,
          subsystem: inferSubsystemFromPath(filePath, message),
          stackTrace: frames.length > 0 ? frames : undefined,
          rawStackTrace: stackLines.join("\n"),
          stackSignature: stackSig,
          rawSnippet: [trimmed, ...stackLines].join("\n"),
          sourceProbe,
          timestamp: nowIso,
        });

        i += 1;
        continue;
      }

      // ----------------------------------------------------------------------
      // F. Module Resolution / Missing Module Failure
      // ----------------------------------------------------------------------
      if (
        trimmed.includes("Cannot find module") ||
        trimmed.includes("ERR_MODULE_NOT_FOUND") ||
        trimmed.includes("Module not found")
      ) {
        const normMsg = normalizeObservationSignature(trimmed);
        const errId = `ERR-MOD-${createFnv1aHash(normMsg)}`;

        parsedErrors.push({
          id: errId,
          kind: DIAGNOSTIC_ERROR_KINDS.MODULE_RESOLUTION,
          classification: DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER,
          errorCode: "ERR_MODULE_NOT_FOUND",
          message: trimmed,
          normalizedMessage: normMsg,
          subsystem: inferSubsystemFromPath(undefined, trimmed),
          stackSignature: "SIG-MOD-RESOLVE",
          rawSnippet: trimmed,
          sourceProbe,
          timestamp: nowIso,
        });

        i += 1;
        continue;
      }

      i += 1;
    }
  }

  return parsedErrors;
}

/**
 * Internal helper to classify an error kind when structured inputs are provided.
 */
function classifyErrorKind(message: string, code?: string, filePath?: string): DiagnosticErrorKind {
  const lower = message.toLowerCase();
  const c = (code ?? "").toUpperCase();

  if (c.startsWith("TS") || lower.includes("typescript error")) {
    return DIAGNOSTIC_ERROR_KINDS.TYPESCRIPT_COMPILATION;
  }
  if (lower.includes("syntax error") || c === "SYNTAXERROR") {
    return DIAGNOSTIC_ERROR_KINDS.SYNTAX_ERROR;
  }
  if (lower.includes("deadlock") || lower.includes("boot hang")) {
    return DIAGNOSTIC_ERROR_KINDS.BOOT_DEADLOCK;
  }
  if (lower.includes("cannot find module") || lower.includes("err_module_not_found")) {
    return DIAGNOSTIC_ERROR_KINDS.MODULE_RESOLUTION;
  }
  if (
    lower.includes("assertionerror") ||
    lower.includes("expect(") ||
    lower.includes("test failed") ||
    (filePath && filePath.includes(".test."))
  ) {
    return DIAGNOSTIC_ERROR_KINDS.TEST_ASSERTION_FAILURE;
  }
  if (lower.includes("invariant") || lower.includes("contract regression")) {
    return DIAGNOSTIC_ERROR_KINDS.INVARIANT_VIOLATION;
  }
  if (lower.includes("lint") || lower.includes("eslint") || lower.includes("prettier")) {
    return DIAGNOSTIC_ERROR_KINDS.LINT_WARNING;
  }
  if (lower.includes("coverage") || lower.includes("uncovered lines")) {
    return DIAGNOSTIC_ERROR_KINDS.MISSING_COVERAGE;
  }
  if (lower.includes("slowdown") || lower.includes("latency spike") || lower.includes("timed out")) {
    return DIAGNOSTIC_ERROR_KINDS.PERFORMANCE_SLOWDOWN;
  }

  return DIAGNOSTIC_ERROR_KINDS.UNKNOWN;
}

/**
 * Internal helper to classify a diagnostic into one of the 3 Criticality Classes.
 */
function classifyCriticality(
  kind: DiagnosticErrorKind,
  _code?: string,
  message?: string,
): DeficitCriticalityClass {
  switch (kind) {
    case DIAGNOSTIC_ERROR_KINDS.TYPESCRIPT_COMPILATION:
    case DIAGNOSTIC_ERROR_KINDS.SYNTAX_ERROR:
    case DIAGNOSTIC_ERROR_KINDS.RUNTIME_CRASH:
    case DIAGNOSTIC_ERROR_KINDS.UNCAUGHT_EXCEPTION:
    case DIAGNOSTIC_ERROR_KINDS.MODULE_RESOLUTION:
    case DIAGNOSTIC_ERROR_KINDS.BOOT_DEADLOCK:
      return DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER;

    case DIAGNOSTIC_ERROR_KINDS.TEST_ASSERTION_FAILURE:
    case DIAGNOSTIC_ERROR_KINDS.TEST_TIMEOUT:
    case DIAGNOSTIC_ERROR_KINDS.INVARIANT_VIOLATION:
    case DIAGNOSTIC_ERROR_KINDS.CONTRACT_REGRESSION:
      return DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION;

    case DIAGNOSTIC_ERROR_KINDS.LINT_WARNING:
    case DIAGNOSTIC_ERROR_KINDS.LINT_ERROR:
    case DIAGNOSTIC_ERROR_KINDS.CODE_STYLE:
    case DIAGNOSTIC_ERROR_KINDS.TYPE_CHECK_WARNING:
    case DIAGNOSTIC_ERROR_KINDS.MISSING_COVERAGE:
    case DIAGNOSTIC_ERROR_KINDS.PERFORMANCE_SLOWDOWN:
    case DIAGNOSTIC_ERROR_KINDS.DOCUMENTATION_GAP:
    case DIAGNOSTIC_ERROR_KINDS.HEALTH_PROBE_DEGRADATION:
    case DIAGNOSTIC_ERROR_KINDS.UNKNOWN:
    default: {
      const lower = (message ?? "").toLowerCase();
      if (lower.includes("fatal") || lower.includes("crash") || lower.includes("cannot compile")) {
        return DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER;
      }
      if (lower.includes("fail") || lower.includes("regression") || lower.includes("broke")) {
        return DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION;
      }
      return DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT;
    }
  }
}

// ============================================================================
// 5. Diagnostic Clustering Algorithm & Topology Matrix Synthesis
// ============================================================================

/**
 * Clusters an arbitrary array of parsed diagnostic errors into deduplicated DeficitClusterNodes
 * and synthesizes the holistic DeficitTopologyMatrix.
 */
export function clusterDiagnosticErrors(
  errors: readonly ParsedDiagnosticError[],
  options: ClusteringOptions = {},
): DeficitTopologyMatrix {
  const matrixId =
    options.matrixId ?? `TOPO-MAT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const nowIso = new Date().toISOString();
  const similarityThreshold = options.similarityThreshold ?? 0.65;
  const knownSubsystems = options.knownSubsystems ?? DEFAULT_KNOWN_SUBSYSTEMS;

  if (errors.length === 0) {
    const defaultAllocation: RecommendedRoadmapAllocation = {
      coreStability: 70,
      architecturalEvolution: 20,
      exploratory: 10,
      rationale: "Nominal operational baseline. 0 diagnostic defects detected.",
    };

    const healthySubsystems: Record<string, number> = {};
    for (const sub of knownSubsystems) {
      healthySubsystems[sub] = 1.0;
    }

    return {
      matrixId,
      generatedAt: nowIso,
      totalRawErrors: 0,
      totalClusters: 0,
      summary: {
        blockers: 0,
        regressions: 0,
        qualityDeficits: 0,
        totalRawErrors: 0,
        totalClusters: 0,
        compositeFrictionScore: 0.0,
        criticalSubsystems: [],
        healthStatus: "HEALTHY",
      },
      clusters: [],
      subsystemHealthScores: healthySubsystems,
      recommendedRoadmapAllocation: defaultAllocation,
      metadata: options.metadata,
    };
  }

  // --------------------------------------------------------------------------
  // Group errors into candidate clusters
  // --------------------------------------------------------------------------
  interface ClusterBucket {
    readonly items: ParsedDiagnosticError[];
    readonly primaryClassification: DeficitCriticalityClass;
    readonly primaryKind: DiagnosticErrorKind;
    readonly primaryCode?: string | undefined;
    readonly primaryFile?: string | undefined;
    readonly stackSignature?: string | undefined;
  }

  const buckets: ClusterBucket[] = [];

  for (const err of errors) {
    let matchedBucket: ClusterBucket | undefined = undefined;

    for (const bucket of buckets) {
      // 1. Criticality class MUST match
      if (bucket.primaryClassification !== err.classification) {
        continue;
      }

      // 2. Exact match on (Code + Target File) or (Stack Signature)
      const sameFile =
        Boolean(bucket.primaryFile) &&
        Boolean(err.filePath) &&
        bucket.primaryFile === err.filePath;

      const sameCode =
        Boolean(bucket.primaryCode) &&
        Boolean(err.errorCode) &&
        bucket.primaryCode === err.errorCode;

      const sameStack =
        Boolean(bucket.stackSignature) &&
        Boolean(err.stackSignature) &&
        bucket.stackSignature === err.stackSignature;

      if ((sameFile && sameCode) || sameStack) {
        matchedBucket = bucket;
        break;
      }

      // 3. Normalized message similarity check for same file or same kind
      if (sameFile || bucket.primaryKind === err.kind) {
        const repErr = bucket.items[0];
        if (repErr) {
          const sim = calculateDefectSimilarity(
            err.normalizedMessage,
            repErr.normalizedMessage,
          );
          if (sim >= similarityThreshold) {
            matchedBucket = bucket;
            break;
          }
        }
      }
    }

    if (matchedBucket) {
      matchedBucket.items.push(err);
    } else {
      buckets.push({
        items: [err],
        primaryClassification: err.classification,
        primaryKind: err.kind,
        primaryCode: err.errorCode,
        primaryFile: err.filePath,
        stackSignature: err.stackSignature,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Transform buckets into DeficitClusterNodes
  // --------------------------------------------------------------------------
  const rawClusterNodes: DeficitClusterNode[] = [];
  let clusterCounter = 0;

  for (const bucket of buckets) {
    clusterCounter += 1;
    const items = bucket.items;
    const rep = items[0]!;
    const classification = bucket.primaryClassification;

    // Collect distinct files and subsystems
    const fileSet = new Set<string>();
    const subsystemSet = new Set<string>();
    const codeSet = new Set<string>();
    const snippets: string[] = [];

    let earliestTime = rep.timestamp;
    let latestTime = rep.timestamp;

    for (const item of items) {
      if (item.filePath) fileSet.add(item.filePath);
      if (item.subsystem) subsystemSet.add(item.subsystem);
      if (item.errorCode) codeSet.add(item.errorCode);
      if (item.rawSnippet && snippets.length < 3 && !snippets.includes(item.rawSnippet)) {
        snippets.push(item.rawSnippet);
      }
      if (item.timestamp < earliestTime) earliestTime = item.timestamp;
      if (item.timestamp > latestTime) latestTime = item.timestamp;
    }

    const affectedFiles = Array.from(fileSet);
    const affectedSubsystems = Array.from(subsystemSet);
    const errorCodes = Array.from(codeSet);
    const primarySubsystem =
      affectedSubsystems[0] ??
      inferSubsystemFromPath(affectedFiles[0], rep.message, knownSubsystems);

    // Compute severity score (0.0 to 10.0)
    const baseSev = DEFICIT_CRITICALITY_BASE_SEVERITY[classification];
    const occurrenceBoost = Math.min(1.5, Math.max(0, (items.length - 1) * 0.15));
    const blastRadiusBoost = Math.min(1.5, Math.max(0, (affectedFiles.length - 1) * 0.3));
    const calculatedSeverity = Math.min(10.0, Math.round((baseSev + occurrenceBoost + blastRadiusBoost) * 10) / 10);

    // Formulate Root Cause Title
    const title = synthesizeRootCauseTitle(rep, bucket, affectedFiles);

    // Formulate Root Cause Hypothesis & Suggested Remediation
    const hypothesis = synthesizeRootCauseHypothesis(rep, bucket, affectedFiles, items.length);
    const remediation = synthesizeRemediationAction(rep, bucket, affectedFiles);

    const classPrefix =
      classification === DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER
        ? "C1"
        : classification === DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION
          ? "C2"
          : "C3";
    const clusterId = `DEFICIT-${classPrefix}-${clusterCounter.toString().padStart(3, "0")}`;

    rawClusterNodes.push({
      clusterId,
      rootCauseTitle: title,
      classification,
      severityScore: calculatedSeverity,
      affectedFiles,
      affectedSubsystems: affectedSubsystems.length > 0 ? affectedSubsystems : [primarySubsystem],
      rawOccurrenceCount: items.length,
      representativeError: rep,
      stackTraceSignature: rep.stackSignature ?? "SIG-DEFAULT",
      rootCauseHypothesis: hypothesis,
      suggestedRemediationAction: remediation,
      priorityRank: 0, // Will be set after global sorting
      errorCodes,
      primarySubsystem,
      firstObservedAt: earliestTime,
      lastObservedAt: latestTime,
      sampleErrorSnippets: snippets,
    });
  }

  // --------------------------------------------------------------------------
  // Sort Clusters by Criticality Hierarchy & Assign Priority Rank
  // --------------------------------------------------------------------------
  const classOrder: Record<DeficitCriticalityClass, number> = {
    [DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER]: 1,
    [DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION]: 2,
    [DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT]: 3,
  };

  rawClusterNodes.sort((a, b) => {
    const orderDiff = classOrder[a.classification] - classOrder[b.classification];
    if (orderDiff !== 0) return orderDiff;
    if (b.severityScore !== a.severityScore) return b.severityScore - a.severityScore;
    if (b.rawOccurrenceCount !== a.rawOccurrenceCount) return b.rawOccurrenceCount - a.rawOccurrenceCount;
    return b.affectedFiles.length - a.affectedFiles.length;
  });

  const rankedClusters: DeficitClusterNode[] = rawClusterNodes.map((node, index) => ({
    ...node,
    priorityRank: index + 1,
  }));

  // --------------------------------------------------------------------------
  // Detect Cascading Downstream Dependencies
  // --------------------------------------------------------------------------
  const finalClusters: DeficitClusterNode[] = rankedClusters.map((cluster) => {
    if (cluster.classification !== DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER) {
      return cluster;
    }
    const downstreamIds: string[] = [];
    for (const other of rankedClusters) {
      if (other.clusterId === cluster.clusterId) continue;
      const fileOverlap = cluster.affectedFiles.some((f) => other.affectedFiles.includes(f));
      const subOverlap = cluster.affectedSubsystems.some((s) => other.affectedSubsystems.includes(s));
      if (fileOverlap || (subOverlap && other.classification !== DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER)) {
        downstreamIds.push(other.clusterId);
      }
    }
    if (downstreamIds.length > 0) {
      return {
        ...cluster,
        cascadingDownstreamClusters: downstreamIds,
      };
    }
    return cluster;
  });

  // --------------------------------------------------------------------------
  // Compute Subsystem Health Scores (0.0 to 1.0)
  // --------------------------------------------------------------------------
  const subsystemScores: Record<string, number> = {};
  for (const sub of knownSubsystems) {
    subsystemScores[sub] = 1.0;
  }

  for (const cluster of finalClusters) {
    for (const sub of cluster.affectedSubsystems) {
      const current = subsystemScores[sub] ?? 1.0;
      let penalty = 0.04;
      if (cluster.classification === DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER) {
        penalty = 0.32;
      } else if (cluster.classification === DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION) {
        penalty = 0.16;
      }
      subsystemScores[sub] = Math.max(0.0, Math.round((current - penalty) * 1000) / 1000);
    }
  }

  // --------------------------------------------------------------------------
  // Compute Summary Statistics & Composite Friction
  // --------------------------------------------------------------------------
  let blockers = 0;
  let regressions = 0;
  let qualityDeficits = 0;

  for (const c of finalClusters) {
    if (c.classification === DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER) blockers += 1;
    else if (c.classification === DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION) regressions += 1;
    else qualityDeficits += 1;
  }

  const criticalSubsystems: string[] = [];
  for (const [sub, score] of Object.entries(subsystemScores)) {
    if (score < 0.65) {
      criticalSubsystems.push(sub);
    }
  }

  // Composite friction score (0.0 to 1.0)
  const weightedDeficitScore =
    blockers * 0.4 + regressions * 0.2 + qualityDeficits * 0.05 + errors.length * 0.01;
  const compositeFrictionScore = Math.min(1.0, Math.round(weightedDeficitScore * 100) / 100);

  const healthStatus: "HEALTHY" | "DEGRADED" | "CRITICAL" =
    blockers > 0 || compositeFrictionScore >= 0.6
      ? "CRITICAL"
      : regressions > 0 || compositeFrictionScore >= 0.25
        ? "DEGRADED"
        : "HEALTHY";

  // --------------------------------------------------------------------------
  // Compute Recommended 70/20/10 Innovation Portfolio Roadmap Allocation
  // --------------------------------------------------------------------------
  const recommendedAllocation = computeRecommendedRoadmapAllocation(
    blockers,
    regressions,
    qualityDeficits,
    criticalSubsystems.length,
    options.baseRoadmapAllocation,
  );

  return {
    matrixId,
    generatedAt: nowIso,
    totalRawErrors: errors.length,
    totalClusters: finalClusters.length,
    summary: {
      blockers,
      regressions,
      qualityDeficits,
      totalRawErrors: errors.length,
      totalClusters: finalClusters.length,
      compositeFrictionScore,
      criticalSubsystems,
      healthStatus,
    },
    clusters: finalClusters,
    subsystemHealthScores: subsystemScores,
    recommendedRoadmapAllocation: recommendedAllocation,
    metadata: options.metadata,
  };
}

/**
 * Computes dynamic 70/20/10 portfolio roadmap allocations based on empirical deficit severity.
 */
function computeRecommendedRoadmapAllocation(
  blockers: number,
  regressions: number,
  qualityDeficits: number,
  criticalSubsystemsCount: number,
  baseOverride?: {
    readonly coreStability?: number | undefined;
    readonly architecturalEvolution?: number | undefined;
    readonly exploratory?: number | undefined;
  },
): RecommendedRoadmapAllocation {
  if (baseOverride?.coreStability !== undefined && baseOverride?.architecturalEvolution !== undefined) {
    const core = baseOverride.coreStability;
    const arch = baseOverride.architecturalEvolution;
    const exp = baseOverride.exploratory ?? Math.max(0, 100 - core - arch);
    return {
      coreStability: core,
      architecturalEvolution: arch,
      exploratory: exp,
      rationale: "Custom manual portfolio allocation override provided.",
    };
  }

  // Emergency Blocker State: Surge Core Stability to fix blocking compilation/runtime failures
  if (blockers > 0) {
    const coreSurge = Math.min(95, 75 + blockers * 5 + regressions * 2);
    const archAllocation = Math.max(5, 20 - blockers * 3);
    const exploratoryAllocation = Math.max(0, 100 - coreSurge - archAllocation);

    return {
      coreStability: coreSurge,
      architecturalEvolution: archAllocation,
      exploratory: exploratoryAllocation,
      rationale: `CRITICAL BLOCKER STATE: ${blockers} Class 1 Blocker cluster(s) detected. Exploratory horizon bets throttled to ${exploratoryAllocation}%; resource capacity surged into Core Stability (${coreSurge}%) for immediate triage.`,
    };
  }

  // Regression State: Moderate Core Stability Surge to restore broken invariants
  if (regressions > 0) {
    const coreSurge = Math.min(85, 70 + regressions * 3 + criticalSubsystemsCount * 2);
    const archAllocation = 20;
    const exploratoryAllocation = Math.max(0, 100 - coreSurge - archAllocation);

    return {
      coreStability: coreSurge,
      architecturalEvolution: archAllocation,
      exploratory: exploratoryAllocation,
      rationale: `REGRESSION ALERT: ${regressions} Class 2 Regression cluster(s) active. Core Stability increased to ${coreSurge}% to remediate broken contracts while maintaining 20% Architectural Evolution.`,
    };
  }

  // Quality Deficits Only
  if (qualityDeficits > 0) {
    return {
      coreStability: 70,
      architecturalEvolution: 20,
      exploratory: 10,
      rationale: `BALANCED PORTFOLIO: 0 Blockers and 0 Regressions. ${qualityDeficits} Quality Deficits are manageable within standard 70/20/10 capacity allocation.`,
    };
  }

  // Nominal Pristine Baseline
  return {
    coreStability: 65,
    architecturalEvolution: 20,
    exploratory: 15,
    rationale: "PRISTINE SYSTEM HEALTH: Zero active diagnostic deficits detected. Exploratory horizon capacity expanded from 10% to 15%.",
  };
}

// ----------------------------------------------------------------------------
// Heuristic Synthesizers for Cluster Titles, Hypotheses, and Remediations
// ----------------------------------------------------------------------------

function synthesizeRootCauseTitle(
  rep: ParsedDiagnosticError,
  bucket: { primaryClassification: DeficitCriticalityClass; primaryKind: DiagnosticErrorKind; primaryCode?: string | undefined; primaryFile?: string | undefined },
  _affectedFiles: readonly string[],
): string {
  const fileLabel = bucket.primaryFile ? basename(bucket.primaryFile) : "System";
  const codeLabel = bucket.primaryCode ? `[${bucket.primaryCode}] ` : "";

  if (bucket.primaryKind === DIAGNOSTIC_ERROR_KINDS.TYPESCRIPT_COMPILATION) {
    const matchType = rep.message.match(/Cannot find name '([^']+)'/i);
    if (matchType && matchType[1]) {
      return `${codeLabel}Missing identifier '${matchType[1]}' in ${fileLabel}`;
    }
    const matchAssign = rep.message.match(/Type '([^']+)' is not assignable to type '([^']+)'/i);
    if (matchAssign && matchAssign[1] && matchAssign[2]) {
      return `${codeLabel}Type mismatch (${matchAssign[1]} -> ${matchAssign[2]}) in ${fileLabel}`;
    }
    return `${codeLabel}Compilation error in ${fileLabel}`;
  }

  if (bucket.primaryKind === DIAGNOSTIC_ERROR_KINDS.TEST_ASSERTION_FAILURE) {
    return `${codeLabel}Assertion failure in ${fileLabel}`;
  }

  if (bucket.primaryKind === DIAGNOSTIC_ERROR_KINDS.RUNTIME_CRASH || bucket.primaryKind === DIAGNOSTIC_ERROR_KINDS.UNCAUGHT_EXCEPTION) {
    return `${codeLabel}Runtime exception (${rep.errorCode ?? "Crash"}) in ${fileLabel}`;
  }

  if (bucket.primaryKind === DIAGNOSTIC_ERROR_KINDS.MODULE_RESOLUTION) {
    return `Module resolution failure for '${rep.message.slice(0, 45)}'`;
  }

  if (bucket.primaryKind === DIAGNOSTIC_ERROR_KINDS.LINT_WARNING || bucket.primaryKind === DIAGNOSTIC_ERROR_KINDS.LINT_ERROR) {
    return `${codeLabel}Lint rule deviation in ${fileLabel}`;
  }

  const shortMsg = rep.message.split("\n")[0] ?? "Diagnostic failure";
  return `${codeLabel}${shortMsg.slice(0, 60)}`;
}

function synthesizeRootCauseHypothesis(
  rep: ParsedDiagnosticError,
  bucket: { primaryClassification: DeficitCriticalityClass; primaryKind: DiagnosticErrorKind; primaryCode?: string | undefined },
  affectedFiles: readonly string[],
  occurrenceCount: number,
): string {
  const countText = occurrenceCount > 1 ? ` (observed ${occurrenceCount} occurrences across ${affectedFiles.length} file(s))` : "";

  switch (bucket.primaryKind) {
    case DIAGNOSTIC_ERROR_KINDS.TYPESCRIPT_COMPILATION:
      return `TypeScript typecheck constraint violated by AST definition in ${affectedFiles[0] ?? "source file"}${countText}. Compiler rejected symbols or type signatures.`;

    case DIAGNOSTIC_ERROR_KINDS.MODULE_RESOLUTION:
      return `Target module import path cannot be resolved by module bundler/compiler${countText}. Possible missing file, broken relative path, or unexported module.`;

    case DIAGNOSTIC_ERROR_KINDS.TEST_ASSERTION_FAILURE:
      return `Behavioral contract or regression test expectation failed${countText}. Expected value diverged from empirical execution output.`;

    case DIAGNOSTIC_ERROR_KINDS.INVARIANT_VIOLATION:
      return `Formal subsystem invariant or state machine precondition violated during runtime evaluation${countText}.`;

    case DIAGNOSTIC_ERROR_KINDS.RUNTIME_CRASH:
    case DIAGNOSTIC_ERROR_KINDS.UNCAUGHT_EXCEPTION:
      return `Unhandled exception or undefined property access encountered during execution${countText}.`;

    case DIAGNOSTIC_ERROR_KINDS.BOOT_DEADLOCK:
      return `Cyclic initialization dependency or blocking async lock resulted in subsystem boot freeze${countText}.`;

    case DIAGNOSTIC_ERROR_KINDS.LINT_WARNING:
    case DIAGNOSTIC_ERROR_KINDS.LINT_ERROR:
      return `Code style, purity, or strict linter rule violated in source tree${countText}.`;

    default:
      return `Empirical probe detected diagnostic failure${countText}: ${rep.normalizedMessage.slice(0, 100)}`;
  }
}

function synthesizeRemediationAction(
  _rep: ParsedDiagnosticError,
  bucket: { primaryClassification: DeficitCriticalityClass; primaryKind: DiagnosticErrorKind; primaryCode?: string | undefined; primaryFile?: string | undefined },
  affectedFiles: readonly string[],
): string {
  const targetFile = bucket.primaryFile ?? affectedFiles[0] ?? "target module";

  switch (bucket.primaryKind) {
    case DIAGNOSTIC_ERROR_KINDS.TYPESCRIPT_COMPILATION:
      return `Update type declarations or symbol imports in ${targetFile} and re-run typecheck probe.`;

    case DIAGNOSTIC_ERROR_KINDS.MODULE_RESOLUTION:
      return `Verify import path, ensure file exists, and export required symbols in ${targetFile}.`;

    case DIAGNOSTIC_ERROR_KINDS.TEST_ASSERTION_FAILURE:
      return `Inspect failing assertion in ${targetFile}, reconcile expected state with actual implementation, and re-run tests.`;

    case DIAGNOSTIC_ERROR_KINDS.INVARIANT_VIOLATION:
      return `Enforce state guard precondition in ${targetFile} to prevent illegal lifecycle transition.`;

    case DIAGNOSTIC_ERROR_KINDS.RUNTIME_CRASH:
      return `Add optional chaining/nullish guards or validate input parameters prior to invocation in ${targetFile}.`;

    case DIAGNOSTIC_ERROR_KINDS.LINT_WARNING:
    case DIAGNOSTIC_ERROR_KINDS.LINT_ERROR:
      return `Refactor code to satisfy linter rule [${bucket.primaryCode ?? "style"}] in ${targetFile}.`;

    default:
      return `Investigate diagnostic logs for ${targetFile} and apply appropriate targeted fix.`;
  }
}

// ============================================================================
// 6. Empirical Baseline Probing Runner
// ============================================================================

export const DEFAULT_BASELINE_PROBES: readonly ProbeDefinition[] = Object.freeze([
  {
    name: "typecheck",
    kind: "typecheck",
    command: ["bun", "run", "typecheck"],
    timeoutMs: 15000,
    required: true,
  },
  {
    name: "unit-tests",
    kind: "test",
    command: ["bun", "test"],
    timeoutMs: 15000,
    required: true,
  },
  {
    name: "subsystem-health",
    kind: "health_probe",
    timeoutMs: 5000,
    required: false,
  },
]);

/**
 * Runs active empirical baseline probes against the codebase and produces
 * a structured BaselineProbeResult with an embedded DeficitTopologyMatrix.
 */
export async function runEmpiricalBaselineProbes(
  options: BaselineProbeOptions = {},
): Promise<BaselineProbeResult> {
  const probeRunId = `PROBE-RUN-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const startTime = Date.now();
  const nowIso = new Date().toISOString();
  const cwd = options.cwd ?? options.repoRoot ?? process.cwd();
  const probesToRun = options.probes ?? DEFAULT_BASELINE_PROBES;
  const isSimulated = options.simulate === true;

  const probeResults: SingleProbeResult[] = [];
  const allParsedErrors: ParsedDiagnosticError[] = [];
  const logChunks: string[] = [];

  let overallExitCode = 0;
  let passedProbes = 0;
  let failedProbes = 0;

  for (const probeDef of probesToRun) {
    options.onProbeStart?.(probeDef.name, probeDef.kind);

    let output: ProbeExecutionOutput;

    if (isSimulated) {
      const simulated = options.simulatedOutputs?.[probeDef.name];
      output = {
        exitCode: simulated?.exitCode ?? 0,
        stdout: simulated?.stdout ?? `[simulated] Probe ${probeDef.name} executed successfully`,
        stderr: simulated?.stderr ?? "",
        durationMs: simulated?.durationMs ?? 15,
        error: simulated?.error,
      };
    } else if (typeof probeDef.customRunner === "function") {
      const probeStart = Date.now();
      try {
        output = await probeDef.customRunner();
      } catch (err) {
        output = {
          exitCode: 1,
          stdout: "",
          stderr: String(err instanceof Error ? err.stack ?? err.message : err),
          durationMs: Date.now() - probeStart,
          error: String(err),
        };
      }
    } else if (probeDef.command) {
      const probeStart = Date.now();
      const targetCwd = probeDef.cwd ?? cwd;

      if (probeDef.kind === "typecheck" && !existsSync(join(targetCwd, "tsconfig.json"))) {
        output = {
          exitCode: 1,
          stdout: "",
          stderr: `error TS18003: No tsconfig.json found in ${targetCwd}`,
          durationMs: Date.now() - probeStart,
        };
      } else if (
        probeDef.kind === "test" &&
        !existsSync(join(targetCwd, "package.json")) &&
        !existsSync(join(targetCwd, "tests"))
      ) {
        output = {
          exitCode: 0,
          stdout: "0 tests found",
          stderr: "",
          durationMs: Date.now() - probeStart,
        };
      } else {
        const cmdArray: readonly string[] = Array.isArray(probeDef.command)
          ? probeDef.command
          : typeof probeDef.command === "string"
            ? probeDef.command.split(" ").filter((s: string) => s.length > 0)
            : ["echo"];
        const exe = cmdArray[0] ?? "echo";
        const args = [...cmdArray.slice(1)];
        const timeout = probeDef.timeoutMs ?? options.timeoutMs ?? 15000;

        try {
          const proc = spawnSync(exe, args, {
            cwd: targetCwd,
            env: { ...process.env, ...options.customEnv, ...probeDef.env },
            timeout,
            encoding: "utf-8",
          });

          const stdout = proc.stdout ? String(proc.stdout) : "";
          const stderr = proc.stderr ? String(proc.stderr) : "";
          const exitCode = proc.status;

          output = {
            exitCode,
            stdout,
            stderr,
            durationMs: Date.now() - probeStart,
            error: proc.error ? String(proc.error.message) : undefined,
          };
        } catch (err) {
          output = {
            exitCode: 1,
            stdout: "",
            stderr: String(err instanceof Error ? err.stack ?? err.message : err),
            durationMs: Date.now() - probeStart,
            error: String(err),
          };
        }
      }
    } else {
      // Default fallback probe runner (e.g. for health_probe without command)
      output = {
        exitCode: 0,
        stdout: `Health check probe '${probeDef.name}' completed nominally.`,
        stderr: "",
        durationMs: 5,
      };
    }

    const commandStr: string | undefined = probeDef.command
      ? Array.isArray(probeDef.command)
        ? probeDef.command.join(" ")
        : typeof probeDef.command === "string"
          ? probeDef.command
          : undefined
      : undefined;

    const probePassed = (output.exitCode === 0 || output.exitCode === null) && !output.error;
    if (probePassed) {
      passedProbes += 1;
    } else {
      failedProbes += 1;
      if (overallExitCode === 0 && output.exitCode !== null) {
        overallExitCode = output.exitCode;
      } else if (overallExitCode === 0) {
        overallExitCode = 1;
      }
    }

    const combinedOutput = `${output.stdout}\n${output.stderr}`.trim();
    if (combinedOutput.length > 0) {
      logChunks.push(`=== PROBE: ${probeDef.name} (${probeDef.kind}) ===\n${combinedOutput}`);
    }

    // Parse diagnostics from probe output
    const parsedErrors = parseRawDiagnostics(
      {
        stdout: output.stdout,
        stderr: output.stderr,
        sourceProbe: probeDef.name,
      },
      probeDef.name,
    );

    for (const err of parsedErrors) {
      allParsedErrors.push(err);
    }

    const singleResult: SingleProbeResult = {
      name: probeDef.name,
      kind: probeDef.kind,
      command: commandStr,
      passed: probePassed,
      exitCode: output.exitCode,
      durationMs: output.durationMs,
      stdout: output.stdout,
      stderr: output.stderr,
      parsedErrors,
      rawErrorSnippet: !probePassed ? combinedOutput.slice(0, 500) : undefined,
    };

    probeResults.push(singleResult);
    options.onProbeCompleted?.(singleResult);

    if (!probePassed && options.continueOnFailure === false) {
      break;
    }
  }

  const aggregatedRawLog = logChunks.join("\n\n");
  const topologyMatrix = clusterDiagnosticErrors(allParsedErrors, {
    matrixId: `TOPO-${probeRunId}`,
  });

  return {
    probeRunId,
    timestamp: nowIso,
    durationMs: Date.now() - startTime,
    success: failedProbes === 0 && overallExitCode === 0,
    exitCode: overallExitCode,
    probes: probeResults,
    totalProbes: probeResults.length,
    passedProbes,
    failedProbes,
    aggregatedRawLog,
    parsedErrors: allParsedErrors,
    topologyMatrix,
  };
}

// ============================================================================
// 7. Markdown Report Formatter
// ============================================================================

/**
 * Formats a DeficitTopologyMatrix into a publication-ready GitHub-Flavored Markdown report.
 */
export function formatDeficitTopologyMatrixMarkdown(matrix: DeficitTopologyMatrix): string {
  const lines: string[] = [];

  const statusBadge =
    matrix.summary.healthStatus === "HEALTHY"
      ? "🟢 HEALTHY"
      : matrix.summary.healthStatus === "DEGRADED"
        ? "🟡 DEGRADED"
        : "🔴 CRITICAL";

  lines.push("# 🧭 Sovereign Mind Deficit Topology Matrix & Empirical Diagnostic Audit");
  lines.push("");
  lines.push(`- **Matrix ID**: \`${matrix.matrixId}\``);
  lines.push(`- **Generated At**: \`${matrix.generatedAt}\``);
  lines.push(`- **Overall System Status**: ${statusBadge}`);
  lines.push(`- **Total Raw Deficit Occurrences**: \`${matrix.totalRawErrors}\``);
  lines.push(`- **Unified Deficit Clusters**: \`${matrix.totalClusters}\``);
  lines.push(`- **Composite Systemic Friction Score**: \`${matrix.summary.compositeFrictionScore.toFixed(2)}\` / 1.00`);
  lines.push("");

  // Executive Summary Alert
  if (matrix.summary.blockers > 0) {
    lines.push("> [!CAUTION]");
    lines.push(`> **${matrix.summary.blockers} CLASS 1 BLOCKER CLUSTER(S) DETECTED**: Compilation failures or critical runtime halts are active. Core stability capacity surged to **${matrix.recommendedRoadmapAllocation.coreStability}%**.`);
  } else if (matrix.summary.regressions > 0) {
    lines.push("> [!WARNING]");
    lines.push(`> **${matrix.summary.regressions} CLASS 2 REGRESSION CLUSTER(S) DETECTED**: Invariant violations or test regressions detected. Core stability capacity elevated to **${matrix.recommendedRoadmapAllocation.coreStability}%**.`);
  } else if (matrix.summary.qualityDeficits > 0) {
    lines.push("> [!NOTE]");
    lines.push(`> **${matrix.summary.qualityDeficits} CLASS 3 QUALITY DEFICIT(S)**: Code style, linting, or documentation items active. Nominal 70/20/10 allocation maintained.`);
  } else {
    lines.push("> [!TIP]");
    lines.push("> **PRISTINE BASELINE**: Zero diagnostic deficits detected. System operating at full empirical fidelity.");
  }
  lines.push("");

  // Executive Metrics Breakdown Table
  lines.push("## 📊 Executive Metrics Summary");
  lines.push("");
  lines.push("| Metric | Count | Criticality Weight | Status |");
  lines.push("| :--- | :--- | :--- | :--- |");
  lines.push(`| **Class 1 Blockers** | \`${matrix.summary.blockers}\` | \`1.00\` | ${matrix.summary.blockers === 0 ? "🟢 None" : "🔴 Action Required"} |`);
  lines.push(`| **Class 2 Regressions** | \`${matrix.summary.regressions}\` | \`0.60\` | ${matrix.summary.regressions === 0 ? "🟢 None" : "🟡 In Review"} |`);
  lines.push(`| **Class 3 Quality Deficits** | \`${matrix.summary.qualityDeficits}\` | \`0.20\` | ${matrix.summary.qualityDeficits === 0 ? "🟢 None" : "⚪ Tracked"} |`);
  lines.push(`| **Total Deduped Clusters** | \`${matrix.totalClusters}\` | — | — |`);
  lines.push(`| **Total Raw Log Errors** | \`${matrix.totalRawErrors}\` | — | — |`);
  lines.push("");

  // 70/20/10 Innovation Portfolio Roadmap Allocation
  lines.push("## 🎯 Recommended 70/20/10 Innovation Portfolio Roadmap Allocation");
  lines.push("");
  lines.push(`> **Dynamic Allocation Rationale**: ${matrix.recommendedRoadmapAllocation.rationale}`);
  lines.push("");
  lines.push("| Track | Target Capacity | Focus & Remediation Scope |");
  lines.push("| :--- | :--- | :--- |");
  lines.push(`| **Track A: Core Stability & Polish** | **${matrix.recommendedRoadmapAllocation.coreStability}%** | Defect triage, compiler fixups, invariant enforcement, regression elimination |`);
  lines.push(`| **Track B: Architectural Evolution** | **${matrix.recommendedRoadmapAllocation.architecturalEvolution}%** | Subsystem decoupling, modular interface refactoring, telemetry hooks |`);
  lines.push(`| **Track C: Exploratory Horizon Bets** | **${matrix.recommendedRoadmapAllocation.exploratory}%** | Breakthrough capabilities, stage-gated hypothesis experimentation |`);
  lines.push("");

  // Subsystem Health Scorecard Table
  lines.push("## 🛡️ Subsystem Health Scorecard");
  lines.push("");
  lines.push("| Subsystem | Health Score | Operational Condition |");
  lines.push("| :--- | :--- | :--- |");

  const sortedSubsystems = Object.entries(matrix.subsystemHealthScores).sort((a, b) => a[1] - b[1]);
  for (const [subsystem, score] of sortedSubsystems) {
    const healthBadge =
      score >= 0.85
        ? "🟢 HEALTHY"
        : score >= 0.6
          ? "🟡 DEGRADED"
          : "🔴 CRITICAL";
    lines.push(`| \`${subsystem}\` | \`${(score * 100).toFixed(1)}%\` | ${healthBadge} |`);
  }
  lines.push("");

  // Deficit Clusters Registry
  lines.push("## 🔬 Prioritized Deficit Clusters Registry");
  lines.push("");

  if (matrix.clusters.length === 0) {
    lines.push("_No active deficit clusters recorded._");
    lines.push("");
  } else {
    lines.push("| Rank | Cluster ID | Classification | Severity | Subsystem | Raw Count | Root Cause Title |");
    lines.push("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |");

    for (const c of matrix.clusters) {
      const classLabel =
        c.classification === DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER
          ? "🔴 Class 1 Blocker"
          : c.classification === DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION
            ? "🟡 Class 2 Regression"
            : "⚪ Class 3 Quality";
      lines.push(
        `| **#${c.priorityRank}** | \`${c.clusterId}\` | ${classLabel} | \`${c.severityScore.toFixed(1)}\` | \`${c.primarySubsystem}\` | \`${c.rawOccurrenceCount}\` | ${c.rootCauseTitle} |`,
      );
    }
    lines.push("");

    // Detailed Breakdown per Cluster
    lines.push("### 🔍 Cluster Diagnostic Deep-Dives");
    lines.push("");

    for (const c of matrix.clusters) {
      lines.push(`#### [${c.clusterId}] ${c.rootCauseTitle}`);
      lines.push(`- **Classification**: \`${c.classification}\` | **Severity Score**: \`${c.severityScore.toFixed(1)} / 10.0\``);
      lines.push(`- **Primary Subsystem**: \`${c.primarySubsystem}\` | **Occurrences**: \`${c.rawOccurrenceCount}\``);
      lines.push(`- **Affected Files** (${c.affectedFiles.length}): ${c.affectedFiles.map((f) => `\`${f}\``).join(", ") || "None"}`);
      lines.push(`- **Stack Trace Signature**: \`${c.stackTraceSignature}\``);
      lines.push(`- **Root Cause Hypothesis**: ${c.rootCauseHypothesis}`);
      lines.push(`- **Suggested Remediation Action**: \`${c.suggestedRemediationAction}\``);

      if (c.cascadingDownstreamClusters && c.cascadingDownstreamClusters.length > 0) {
        lines.push(`- **Cascading Downstream Clusters**: ${c.cascadingDownstreamClusters.map((id) => `\`${id}\``).join(", ")}`);
      }

      if (c.sampleErrorSnippets.length > 0) {
        lines.push("");
        lines.push("```text");
        lines.push(c.sampleErrorSnippets[0]!.slice(0, 400));
        lines.push("```");
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ============================================================================
// 8. Diagnostic Clustering Engine Orchestrator
// ============================================================================

export class DiagnosticClusteringEngine {
  private readonly config: DiagnosticEngineConfig;
  private readonly history: DeficitTopologyMatrix[] = [];
  private latestMatrix: DeficitTopologyMatrix | undefined = undefined;

  public constructor(config: DiagnosticEngineConfig = {}) {
    this.config = config;
  }

  /**
   * Executes baseline empirical probes and updates the latest topology matrix.
   */
  public async runProbes(options: BaselineProbeOptions = {}): Promise<BaselineProbeResult> {
    const combinedOptions: BaselineProbeOptions = {
      cwd: options.cwd ?? this.config.defaultCwd,
      repoRoot: options.repoRoot ?? this.config.repoRoot,
      timeoutMs: options.timeoutMs ?? this.config.defaultTimeoutMs,
      ...options,
    };

    const result = await runEmpiricalBaselineProbes(combinedOptions);
    this.recordMatrix(result.topologyMatrix);
    return result;
  }

  /**
   * Parses raw diagnostics from logs or structured inputs.
   */
  public parse(rawLog: string | RawDiagnosticInput, sourceProbe?: string): ParsedDiagnosticError[] {
    return parseRawDiagnostics(rawLog, sourceProbe);
  }

  /**
   * Clusters parsed errors into a DeficitTopologyMatrix and caches it.
   */
  public cluster(
    errors: readonly ParsedDiagnosticError[],
    options: ClusteringOptions = {},
  ): DeficitTopologyMatrix {
    const matrix = clusterDiagnosticErrors(errors, {
      similarityThreshold: options.similarityThreshold ?? this.config.similarityThreshold,
      knownSubsystems: options.knownSubsystems ?? this.config.knownSubsystems,
      ...options,
    });
    this.recordMatrix(matrix);
    return matrix;
  }

  /**
   * Formats a DeficitTopologyMatrix (or the latest recorded matrix) as Markdown.
   */
  public formatMarkdown(matrix?: DeficitTopologyMatrix): string {
    const target = matrix ?? this.latestMatrix;
    if (!target) {
      return "# No Deficit Topology Matrix Available\n\nRun probes or cluster diagnostics first.";
    }
    return formatDeficitTopologyMatrixMarkdown(target);
  }

  /**
   * Records a topology matrix into engine history.
   */
  public recordMatrix(matrix: DeficitTopologyMatrix): void {
    this.latestMatrix = matrix;
    this.history.push(matrix);
    if (this.history.length > 50) {
      this.history.shift();
    }
  }

  /**
   * Returns the most recent DeficitTopologyMatrix.
   */
  public getLatestMatrix(): DeficitTopologyMatrix | undefined {
    return this.latestMatrix;
  }

  /**
   * Returns the historical sequence of generated topology matrices.
   */
  public getHistory(): readonly DeficitTopologyMatrix[] {
    return this.history;
  }

  /**
   * Clears historical matrices.
   */
  public clearHistory(): void {
    this.history.length = 0;
    this.latestMatrix = undefined;
  }
}
