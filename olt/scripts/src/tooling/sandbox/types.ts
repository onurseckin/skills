export type SandboxTier = "strict" | "balanced" | "permissive" | "unconstrained";

export type IsolationLevel = "strict" | "restricted" | "permissive" | "read_only";

export type SandboxTerminationReason =
  | "completed"
  | "timeout"
  | "memory_exceeded"
  | "cpu_exceeded"
  | "concurrency_exceeded"
  | "aborted"
  | "error";

export interface ResourceQuota {
  readonly timeoutMs?: number | undefined;
  readonly gracePeriodMs?: number | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly maxMemoryRssBytes?: number | undefined;
  readonly memoryWarningBytes?: number | undefined;
  readonly maxHeapBytes?: number | undefined;
  readonly maxCpuPercent?: number | undefined;
  readonly cpuSampleIntervalMs?: number | undefined;
  readonly maxCpuViolationCount?: number | undefined;
  readonly maxConcurrentRuns?: number | undefined;
}

export interface SandboxPolicyConfig {
  readonly defaultTier?: SandboxTier | undefined;
  readonly tierQuotas?: Record<SandboxTier, ResourceQuota> | undefined;
  readonly categoryOverrides?: Record<string, Partial<ResourceQuota>> | undefined;
  readonly toolOverrides?: Record<string, Partial<ResourceQuota>> | undefined;
  readonly isolationLevel?: IsolationLevel | undefined;
  readonly allowedDirectories?: readonly string[] | undefined;
  readonly blockedDirectories?: readonly string[] | undefined;
  readonly readOnlyDirectories?: readonly string[] | undefined;
  readonly allowedEnvironmentKeys?: readonly string[] | undefined;
  readonly blockedEnvironmentKeys?: readonly string[] | undefined;
  readonly maxMemoryMb?: number | undefined;
  readonly maxExecutionTimeMs?: number | undefined;
  readonly allowSubprocess?: boolean | undefined;
  readonly allowNetwork?: boolean | undefined;
  readonly maxOutputSizeBytes?: number | undefined;
}

export type ResourcePolicyConfig = SandboxPolicyConfig;

export interface ResourceUsageSnapshot {
  readonly timestamp: number;
  readonly elapsedMs: number;
  readonly memoryRssBytes: number;
  readonly memoryHeapBytes: number;
  readonly cpuPercent: number;
}

export interface QuotaViolation {
  readonly type: "memory_rss" | "memory_heap" | "cpu_spike" | "cpu_sustained" | "concurrency";
  readonly severity: "warning" | "fatal";
  readonly message: string;
  readonly observedValue: number;
  readonly thresholdValue: number;
  readonly timestamp: number;
}

export interface ResourceUsageReport {
  readonly peakRssBytes: number;
  readonly peakHeapBytes: number;
  readonly peakCpuPercent: number;
  readonly averageCpuPercent: number;
  readonly sampleCount: number;
  readonly durationMs: number;
  readonly violations: readonly QuotaViolation[];
}

export interface SandboxedExecutionResult<T = unknown> {
  readonly success: boolean;
  readonly output: T | null;
  readonly error?: string | undefined;
  readonly toolName: string;
  readonly durationMs: number;
  readonly terminationReason: SandboxTerminationReason;
  readonly resourceUsage: ResourceUsageReport;
}

export interface ChildProcessOptions {
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string> | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxBufferBytes?: number | undefined;
  readonly stdin?: string | undefined;
  readonly shell?: boolean | undefined;
  readonly killSignal?: NodeJS.Signals | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

export interface ChildProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly killed: boolean;
}

export interface IsolationViolation {
  readonly rule: string;
  readonly details: string;
  readonly timestamp: string;
}

export interface SandboxExecutionOptions {
  readonly policy?: SandboxPolicyConfig | undefined;
  readonly isolationLevel?: IsolationLevel | undefined;
  readonly timeoutMs?: number | undefined;
  readonly workingDir?: string | undefined;
  readonly environment?: Record<string, string> | undefined;
  readonly maxBufferBytes?: number | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

export interface SandboxExecutionResult<T = unknown> {
  readonly success: boolean;
  readonly result?: T | undefined;
  readonly error?: string | undefined;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly violations: readonly IsolationViolation[];
}
