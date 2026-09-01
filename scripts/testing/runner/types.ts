/**
 * Test Runner Core Types and Data Contracts
 * Standardized data models for argument parsing, stream event bus, stats telemetry, and execution options.
 */

import type { CoverageArtifactResult } from "../reporting/types.ts";

export type StreamEventType =
  | "suite_start"
  | "suite_pass"
  | "suite_fail"
  | "test_pass"
  | "test_fail"
  | "test_skip"
  | "test_retry"
  | "summary"
  | "stdout"
  | "stderr"
  | "raw_line"
  | "suite_end"
  | "error";

export interface SuiteStartEvent {
  readonly type: "suite_start";
  readonly file: string;
  readonly timestampMs?: number | undefined;
}

export interface SuiteEndEvent {
  readonly type: "suite_end" | "suite_pass" | "suite_fail";
  readonly file: string;
  readonly pass: boolean;
  readonly timestampMs?: number | undefined;
}

export interface TestPassEvent {
  readonly type: "test_pass";
  readonly suite?: string | undefined;
  readonly name: string;
  readonly durationMs?: number | undefined;
  readonly timestampMs?: number | undefined;
}

export interface TestFailEvent {
  readonly type: "test_fail";
  readonly suite?: string | undefined;
  readonly name: string;
  readonly durationMs?: number | undefined;
  readonly error?: string | undefined;
  readonly timestampMs?: number | undefined;
}

export interface TestSkipEvent {
  readonly type: "test_skip" | "test_retry";
  readonly suite?: string | undefined;
  readonly name: string;
  readonly timestampMs?: number | undefined;
}

export interface SummaryEvent {
  readonly type: "summary";
  readonly pass: number;
  readonly fail: number;
  readonly expectCalls: number;
  readonly totalDurationMs: number;
  readonly timestampMs?: number | undefined;
}

export interface RawLineEvent {
  readonly type: "raw_line" | "stdout" | "stderr" | "error";
  readonly text?: string | undefined;
  readonly stream?: "stdout" | "stderr" | undefined;
  readonly data?: string | undefined;
  readonly error?: string | Error | undefined;
  readonly timestampMs?: number | undefined;
}

export type StreamEvent =
  | SuiteStartEvent
  | SuiteEndEvent
  | TestPassEvent
  | TestFailEvent
  | TestSkipEvent
  | SummaryEvent
  | RawLineEvent;

export type StreamEventListener = (event: StreamEvent) => void;

export interface TestFailureInfo {
  readonly suite: string;
  readonly test: string;
  readonly durationMs?: number | undefined;
  readonly error?: string | undefined;
}

export interface RunnerStats {
  totalSuites: number;
  passedSuites: number;
  failedSuites: string[];
  suitesFailed: number;
  activeSuites: number;
  totalTests: number;
  passedTests: number;
  testsFailed: number;
  failedTests: TestFailureInfo[];
  skippedTests: number;
  testsSkipped: number;
  todoTests: number;
  expectCalls: number;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  suitesTotal: number;
  suitesPassed: number;
  testsTotal: number;
  testsPassed: number;
  activeSuite: string | null;
}

export function createDefaultRunnerStats(overrides: Partial<RunnerStats> = {}): RunnerStats {
  const now = Date.now();
  return {
    totalSuites: 0,
    passedSuites: 0,
    failedSuites: [],
    suitesFailed: 0,
    activeSuites: 0,
    totalTests: 0,
    passedTests: 0,
    testsFailed: 0,
    failedTests: [],
    skippedTests: 0,
    testsSkipped: 0,
    todoTests: 0,
    expectCalls: 0,
    startTimeMs: now,
    endTimeMs: 0,
    durationMs: 0,
    suitesTotal: 0,
    suitesPassed: 0,
    testsTotal: 0,
    testsPassed: 0,
    activeSuite: null,
    ...overrides,
  };
}

export interface RunnerResult {
  readonly exitCode: number;
  readonly stats: RunnerStats;
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
  readonly rawOutput?: string | undefined;
  readonly startTime?: string | undefined;
  readonly endTime?: string | undefined;
  readonly durationMs: number;
  readonly coverageResult?: CoverageArtifactResult | undefined;
}

export interface WrapperOptions {
  readonly quiet?: boolean | undefined;
  readonly ticker?: boolean | undefined;
  readonly ci?: boolean | undefined;
  readonly verbose?: boolean | undefined;
  readonly summary?: boolean | undefined;
}

export interface TickerOptions {
  readonly enabled?: boolean | undefined;
  readonly intervalMs?: number | undefined;
  readonly renderSummary?: boolean | undefined;
}

export interface ParsedRunnerArgs {
  readonly rawArgs: readonly string[];
  readonly targets: readonly string[];
  readonly isCoverage: boolean;
  readonly isBroadScope: boolean;
  readonly isBail: boolean;
  readonly isUpdateSnapshots: boolean;
  readonly filterPattern?: string | undefined;
  readonly timeoutMs: number;
  readonly parallel: boolean;
  readonly passthroughArgs: readonly string[];
  readonly bunTestArgs: readonly string[];
  readonly wrapperOptions: WrapperOptions;
  readonly coverageDir?: string | undefined;
  readonly coverageReporters?: readonly string[] | undefined;
  readonly maxConcurrency?: number | undefined;
  readonly bailCount?: number | undefined;
  readonly parallelWorkers?: number | undefined;
  readonly otherBunArgs?: readonly string[] | undefined;
}

export interface RunnerOptions {
  readonly rawArgs?: readonly string[] | undefined;
  readonly targets?: readonly string[] | undefined;
  readonly coverage?: boolean | undefined;
  readonly coverageDir?: string | undefined;
  readonly coverageReporters?: readonly string[] | undefined;
  readonly bail?: boolean | undefined;
  readonly updateSnapshots?: boolean | undefined;
  readonly filterPattern?: string | undefined;
  readonly timeout?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly parallel?: boolean | undefined;
  readonly maxConcurrency?: number | undefined;
  readonly quiet?: boolean | undefined;
  readonly ticker?: boolean | undefined;
  readonly ci?: boolean | undefined;
  readonly verbose?: boolean | undefined;
  readonly summary?: boolean | undefined;
  readonly interactive?: boolean | undefined;
  readonly updateCadenceMs?: number | undefined;
  readonly stdout?: NodeJS.WritableStream | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly cwd?: string | undefined;
  readonly passthroughArgs?: readonly string[] | undefined;
}
