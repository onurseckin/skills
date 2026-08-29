import type { ToolContext, ToolHandler } from "../types.ts";
import { resolveSandboxQuota } from "./policy.ts";
import { type ResourceGovernorOptions, ResourceGovernor } from "./resource-governor.ts";
import { TimeoutWatcher } from "./timeout-watcher.ts";
import type {
  ResourcePolicyConfig,
  ResourceQuota,
  ResourceUsageReport,
  SandboxedExecutionResult,
  SandboxTerminationReason,
  SandboxTier,
} from "./types.ts";

export interface SandboxedExecutionOptions {
  readonly toolName: string;
  readonly category?: string;
  readonly tier?: SandboxTier;
  readonly quota?: ResourceQuota;
  readonly policy?: ResourcePolicyConfig;
  readonly context?: ToolContext;
  readonly governorOptions?: Partial<ResourceGovernorOptions>;
}

export class SandboxedToolExecutor {
  private readonly activeExecutions = new Map<string, number>();
  private defaultPolicy: ResourcePolicyConfig;

  constructor(policy?: ResourcePolicyConfig) {
    this.defaultPolicy =
      policy ??
      ({
        defaultTier: "balanced",
        tierQuotas: {
          strict: { timeoutMs: 5000, maxConcurrentRuns: 2 },
          balanced: { timeoutMs: 30000, maxConcurrentRuns: 5 },
          permissive: { timeoutMs: 120000, maxConcurrentRuns: 10 },
          unconstrained: { timeoutMs: 600000, maxConcurrentRuns: 20 },
        },
      } as ResourcePolicyConfig);
  }

  public getActiveCount(toolName?: string): number {
    if (toolName) return this.activeExecutions.get(toolName) ?? 0;
    let total = 0;
    for (const count of this.activeExecutions.values()) total += count;
    return total;
  }

  public async execute<T = unknown>(
    handler: ToolHandler,
    args: Record<string, unknown>,
    options: SandboxedExecutionOptions,
  ): Promise<SandboxedExecutionResult<T>> {
    const startTime = performance.now();
    const { toolName, category, tier, context } = options;

    const effectiveQuota =
      options.quota ??
      resolveSandboxQuota(options.policy ?? this.defaultPolicy, tier, category, toolName);

    const maxConcurrent = effectiveQuota.maxConcurrentRuns ?? 10;
    const currentActive = this.getActiveCount(toolName);
    if (currentActive >= maxConcurrent) {
      const emptyReport: ResourceUsageReport = {
        peakRssBytes: 0,
        peakHeapBytes: 0,
        peakCpuPercent: 0,
        averageCpuPercent: 0,
        sampleCount: 0,
        durationMs: 0,
        violations: [
          {
            type: "concurrency",
            severity: "fatal",
            message: `Max concurrent executions (${maxConcurrent}) reached for tool '${toolName}'`,
            observedValue: currentActive,
            thresholdValue: maxConcurrent,
            timestamp: Date.now(),
          },
        ],
      };

      return {
        success: false,
        output: null,
        error: `Concurrency quota exceeded for tool '${toolName}' (${currentActive}/${maxConcurrent})`,
        toolName,
        durationMs: performance.now() - startTime,
        terminationReason: "concurrency_exceeded",
        resourceUsage: emptyReport,
      };
    }

    this.incrementActive(toolName);

    let terminationReason: SandboxTerminationReason = "completed";
    let executionError: string | undefined;
    let executionOutput: T | null = null;
    let governorReport: ResourceUsageReport = {
      peakRssBytes: 0,
      peakHeapBytes: 0,
      peakCpuPercent: 0,
      averageCpuPercent: 0,
      sampleCount: 0,
      durationMs: 0,
      violations: [],
    };

    const timeoutWatcher = new TimeoutWatcher({
      timeoutMs: effectiveQuota.timeoutMs ?? 30000,
      gracePeriodMs: effectiveQuota.gracePeriodMs,
      heartbeatIntervalMs: effectiveQuota.heartbeatIntervalMs,
      onTimeout: () => {
        terminationReason = "timeout";
      },
    });

    const combinedAbortController = new AbortController();
    if (context?.abortSignal) {
      context.abortSignal.addEventListener("abort", () => {
        terminationReason = "aborted";
        combinedAbortController.abort(context.abortSignal?.reason);
      });
    }

    const governor = new ResourceGovernor({
      quota: effectiveQuota,
      metricsProvider: options.governorOptions?.metricsProvider,
      onFatalViolation: (violation) => {
        if (violation.type === "memory_rss" || violation.type === "memory_heap") {
          terminationReason = "memory_exceeded";
        } else if (violation.type === "cpu_sustained" || violation.type === "cpu_spike") {
          terminationReason = "cpu_exceeded";
        }
        combinedAbortController.abort(new Error(violation.message));
      },
    });

    const timeoutSignal = timeoutWatcher.start();
    timeoutSignal.addEventListener("abort", () => {
      combinedAbortController.abort(timeoutSignal.reason);
    });

    governor.start();

    const sandboxedContext: ToolContext = {
      ...context,
      abortSignal: combinedAbortController.signal,
    };

    try {
      if (context?.abortSignal?.aborted) {
        throw new Error("Execution aborted prior to start");
      }

      const resultPromise = Promise.resolve(handler(args, sandboxedContext));

      const abortPromise = new Promise<never>((_, reject) => {
        if (combinedAbortController.signal.aborted) {
          reject(combinedAbortController.signal.reason);
          return;
        }
        combinedAbortController.signal.addEventListener("abort", () => {
          reject(combinedAbortController.signal.reason);
        });
      });

      const rawResult = (await Promise.race([resultPromise, abortPromise])) as T;
      executionOutput = rawResult;
      terminationReason = "completed";
    } catch (err) {
      const isAbort =
        combinedAbortController.signal.aborted ||
        (err instanceof Error && err.name === "AbortError");

      if (isAbort && terminationReason === "completed") {
        terminationReason = timeoutWatcher.isExpired() ? "timeout" : "aborted";
      } else if (!isAbort && terminationReason === "completed") {
        terminationReason = "error";
      }

      executionError = err instanceof Error ? err.message : String(err);
      executionOutput = null;
    } finally {
      governorReport = governor.stop();
      timeoutWatcher.dispose();
      governor.dispose();
      this.decrementActive(toolName);
    }

    const durationMs = performance.now() - startTime;
    const isSuccess = terminationReason === "completed" && executionError === undefined;

    return {
      success: isSuccess,
      output: executionOutput,
      error: executionError,
      toolName,
      durationMs,
      terminationReason,
      resourceUsage: governorReport,
    };
  }

  private incrementActive(toolName: string): void {
    const current = this.activeExecutions.get(toolName) ?? 0;
    this.activeExecutions.set(toolName, current + 1);
  }

  private decrementActive(toolName: string): void {
    const current = this.activeExecutions.get(toolName) ?? 0;
    if (current <= 1) {
      this.activeExecutions.delete(toolName);
    } else {
      this.activeExecutions.set(toolName, current - 1);
    }
  }
}
