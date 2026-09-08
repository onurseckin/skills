import type { TelemetryNormalizationEngine } from "./engine.ts";
import type { UnifiedTelemetryReport } from "./types.ts";
import { formatCircuitBreakerMarkdown } from "./circuit-breaker-markdown.ts";
import {
  AUTO_WAKE_PROMPT,
  CRITICAL_WRAP_UP_MESSAGE,
  DEFAULT_AUTO_WAKE_BUFFER_SECONDS,
  DEFAULT_COOLDOWN_SECONDS,
  DEFAULT_QUOTA_THRESHOLD,
  DEFAULT_RECOVERY_THRESHOLD,
  DEFAULT_SAFE_WINDOW_SECONDS,
  UNMEASURED_QUOTA_WRAP_UP_MESSAGE,
  detectActiveHost,
  evaluateCircuitBreaker,
  extractResetTime,
  isPlatformMatchingHost,
  normalizeCanonicalHost,
  type AutoWakeSchedulePayload,
  type CircuitBreakerEvaluation,
  type CircuitBreakerStatus,
  type ConstrainedModelInfo,
  type QuotaCircuitBreakerOptions,
  type WrapUpDirective,
} from "./circuit-breaker-evaluator.ts";

export type {
  AutoWakeSchedulePayload,
  CircuitBreakerEvaluation,
  CircuitBreakerStatus,
  ConstrainedModelInfo,
  QuotaCircuitBreakerOptions,
  WrapUpDirective,
};

export {
  AUTO_WAKE_PROMPT,
  CRITICAL_WRAP_UP_MESSAGE,
  DEFAULT_AUTO_WAKE_BUFFER_SECONDS,
  DEFAULT_COOLDOWN_SECONDS,
  DEFAULT_QUOTA_THRESHOLD,
  DEFAULT_RECOVERY_THRESHOLD,
  DEFAULT_SAFE_WINDOW_SECONDS,
  UNMEASURED_QUOTA_WRAP_UP_MESSAGE,
  detectActiveHost,
  evaluateCircuitBreaker,
  extractResetTime,
  formatCircuitBreakerMarkdown,
  isPlatformMatchingHost,
  normalizeCanonicalHost,
};

export interface QuotaState {
  readonly remainingPercentage?: number | undefined;
  readonly remainingFraction?: number | undefined;
  readonly remainingPercent?: number | undefined;
  readonly remaining?: number | undefined;
  readonly total?: number | undefined;
  readonly used?: number | undefined;
  readonly resetTime?: string | undefined;
  readonly platformId?: string | undefined;
  readonly modelName?: string | undefined;
}

export interface CircuitBreakerVerdict {
  readonly tripped: boolean;
  readonly remainingPercentage: number;
  readonly thresholdPercentage: number;
  readonly status: "OK" | "TRIPPED";
  readonly reason?: string | undefined;
  readonly wrapUpMessage?: string | undefined;
  readonly resetTime?: string | undefined;
  readonly checkedAt: string;
}

export function checkQuotaCircuitBreaker(
  quota: QuotaState | number | unknown,
  thresholdPercentage = DEFAULT_QUOTA_THRESHOLD,
): CircuitBreakerVerdict {
  let remaining: number;
  let resetTime: string | undefined;

  if (typeof quota === "number") {
    remaining = quota <= 1.0 && quota > 0 ? quota * 100 : quota;
  } else if (typeof quota === "object" && quota !== null) {
    const record = quota as Record<string, unknown>;
    if (typeof record["remainingPercentage"] === "number") {
      remaining = record["remainingPercentage"] as number;
    } else if (typeof record["remainingPercent"] === "number") {
      remaining = record["remainingPercent"] as number;
    } else if (typeof record["remainingFraction"] === "number") {
      remaining = (record["remainingFraction"] as number) * 100;
    } else if (
      typeof record["remaining"] === "number" &&
      typeof record["total"] === "number" &&
      (record["total"] as number) > 0
    ) {
      remaining = ((record["remaining"] as number) / (record["total"] as number)) * 100;
    } else if (
      typeof record["used"] === "number" &&
      typeof record["total"] === "number" &&
      (record["total"] as number) > 0
    ) {
      remaining = Math.max(
        0,
        (((record["total"] as number) - (record["used"] as number)) / (record["total"] as number)) *
          100,
      );
    } else {
      remaining = 0;
    }

    if (typeof record["resetTime"] === "string") {
      resetTime = record["resetTime"] as string;
    } else if (typeof record["reset_time"] === "string") {
      resetTime = record["reset_time"] as string;
    }
  } else {
    remaining = 0;
  }

  const tripped = remaining <= thresholdPercentage;
  const status: "OK" | "TRIPPED" = tripped ? "TRIPPED" : "OK";
  const reason = tripped
    ? `Remaining quota ${remaining.toFixed(2)}% is at or below threshold ${thresholdPercentage.toFixed(2)}%`
    : undefined;
  const wrapUpMessage = tripped ? CRITICAL_WRAP_UP_MESSAGE : undefined;

  return {
    tripped,
    remainingPercentage: remaining,
    thresholdPercentage,
    status,
    reason,
    wrapUpMessage,
    resetTime,
    checkedAt: new Date().toISOString(),
  };
}

let globalTelemetryQuotaProvider:
  | (() => number | null | undefined | QuotaState | UnifiedTelemetryReport | unknown)
  | undefined;

export function setTelemetryQuotaProvider(
  provider:
    | (() => number | null | undefined | QuotaState | UnifiedTelemetryReport | unknown)
    | undefined,
): void {
  globalTelemetryQuotaProvider = provider;
}

export function getTelemetryQuotaProvider(): (
  | (() => number | null | undefined | QuotaState | UnifiedTelemetryReport | unknown)
  | undefined
) {
  return globalTelemetryQuotaProvider;
}

export function resolveMeasuredQuotaPercentage(input?: unknown): number | undefined {
  let target = input;
  if (target === undefined && globalTelemetryQuotaProvider !== undefined) {
    try {
      target = globalTelemetryQuotaProvider();
    } catch {
      return undefined;
    }
  }
  if (typeof target === "function") {
    try {
      target = (target as () => unknown)();
    } catch {
      return undefined;
    }
  }
  if (typeof target === "number") {
    if (Number.isNaN(target) || !Number.isFinite(target)) return undefined;
    const val = target <= 1.0 && target > 0 ? target * 100 : target;
    return Math.max(0, Math.min(100, val));
  }
  if (typeof target === "object" && target !== null) {
    const record = target as Record<string, unknown>;
    if (Array.isArray(record["results"])) {
      let lowest: number | null = null;
      for (const res of record["results"] as readonly Record<string, unknown>[]) {
        if (res && Array.isArray(res["metrics"])) {
          for (const m of res["metrics"] as readonly Record<string, unknown>[]) {
            if (typeof m?.["remainingPercentage"] === "number") {
              if (lowest === null || m["remainingPercentage"] < lowest) {
                lowest = m["remainingPercentage"];
              }
            }
          }
        }
      }
      if (lowest !== null) return Math.max(0, Math.min(100, lowest));
    }
    if (Array.isArray(record["metrics"])) {
      let lowest: number | null = null;
      for (const m of record["metrics"] as readonly Record<string, unknown>[]) {
        if (typeof m?.["remainingPercentage"] === "number") {
          if (lowest === null || m["remainingPercentage"] < lowest) {
            lowest = m["remainingPercentage"];
          }
        }
      }
      if (lowest !== null) return Math.max(0, Math.min(100, lowest));
    }
    if (typeof record["remainingPercentage"] === "number") {
      return Math.max(0, Math.min(100, record["remainingPercentage"] as number));
    }
    if (typeof record["quotaPercentage"] === "number") {
      return Math.max(0, Math.min(100, record["quotaPercentage"] as number));
    }
    if (typeof record["quota_percentage"] === "number") {
      return Math.max(0, Math.min(100, record["quota_percentage"] as number));
    }
    if (typeof record["remaining_percentage"] === "number") {
      return Math.max(0, Math.min(100, record["remaining_percentage"] as number));
    }
    if (typeof record["lowestRemainingQuota"] === "number") {
      return Math.max(0, Math.min(100, record["lowestRemainingQuota"] as number));
    }
    if (typeof record["remainingPercent"] === "number") {
      return Math.max(0, Math.min(100, record["remainingPercent"] as number));
    }
    if (typeof record["remainingFraction"] === "number") {
      return Math.max(0, Math.min(100, (record["remainingFraction"] as number) * 100));
    }
    if (
      typeof record["remaining"] === "number" &&
      typeof record["total"] === "number" &&
      (record["total"] as number) > 0
    ) {
      return Math.max(
        0,
        Math.min(100, ((record["remaining"] as number) / (record["total"] as number)) * 100),
      );
    }
    if (
      typeof record["used"] === "number" &&
      typeof record["total"] === "number" &&
      (record["total"] as number) > 0
    ) {
      return Math.max(
        0,
        Math.min(
          100,
          (((record["total"] as number) - (record["used"] as number)) /
            (record["total"] as number)) *
            100,
        ),
      );
    }
  }
  return undefined;
}

export class QuotaCircuitBreaker {
  private readonly defaultThreshold: number;
  private readonly defaultRecoveryThreshold: number;
  private readonly defaultSafeWindowSeconds: number;
  private readonly defaultBufferSeconds: number;
  private readonly defaultCooldownSeconds: number;
  private readonly defaultActiveHost?: string | undefined;
  private lastEvaluation?: CircuitBreakerEvaluation | undefined;
  private lastTrippedAt?: number | undefined;

  constructor(
    options: {
      thresholdPercentage?: number;
      recoveryThresholdPercentage?: number;
      defaultSafeWindowSeconds?: number;
      bufferSeconds?: number;
      cooldownSeconds?: number;
      activeHost?: string;
    } = {},
  ) {
    this.defaultThreshold = options.thresholdPercentage ?? DEFAULT_QUOTA_THRESHOLD;
    this.defaultRecoveryThreshold =
      options.recoveryThresholdPercentage ?? DEFAULT_RECOVERY_THRESHOLD;
    this.defaultSafeWindowSeconds = options.defaultSafeWindowSeconds ?? DEFAULT_SAFE_WINDOW_SECONDS;
    this.defaultBufferSeconds = options.bufferSeconds ?? DEFAULT_AUTO_WAKE_BUFFER_SECONDS;
    this.defaultCooldownSeconds = options.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;
    this.defaultActiveHost = options.activeHost;
  }

  public evaluate(
    report: UnifiedTelemetryReport,
    options?: QuotaCircuitBreakerOptions,
  ): CircuitBreakerEvaluation {
    const activeHost = options?.activeHost ?? this.defaultActiveHost;
    const previousStatus = options?.previousStatus;
    const lastTrippedAt = options?.lastTrippedAt ?? this.lastTrippedAt;
    const recoveryThresholdPercentage =
      options?.recoveryThresholdPercentage ?? this.defaultRecoveryThreshold;
    const cooldownSeconds = options?.cooldownSeconds ?? this.defaultCooldownSeconds;

    const mergedOptions: QuotaCircuitBreakerOptions = {
      ...options,
      ...(activeHost !== undefined ? { activeHost } : {}),
      ...(previousStatus !== undefined ? { previousStatus } : {}),
      ...(lastTrippedAt !== undefined ? { lastTrippedAt } : {}),
      recoveryThresholdPercentage,
      cooldownSeconds,
    };

    const evaluation = evaluateCircuitBreaker(report, mergedOptions, {
      threshold: this.defaultThreshold,
      safeWindow: this.defaultSafeWindowSeconds,
      buffer: this.defaultBufferSeconds,
    });

    this.lastEvaluation = evaluation;
    if (evaluation.isTriggered) {
      if (this.lastTrippedAt === undefined) {
        this.lastTrippedAt =
          options?.now !== undefined ? new Date(options.now).getTime() : Date.now();
      }
    } else {
      this.lastTrippedAt = undefined;
    }

    return evaluation;
  }

  public async evaluateAsync(
    engine: TelemetryNormalizationEngine,
    options?: QuotaCircuitBreakerOptions,
  ): Promise<CircuitBreakerEvaluation> {
    const report = await engine.probeAll();
    return this.evaluate(report, options);
  }

  public reset(): void {
    this.lastEvaluation = undefined;
    this.lastTrippedAt = undefined;
  }

  public getLastEvaluation(): CircuitBreakerEvaluation | undefined {
    return this.lastEvaluation;
  }

  public static evaluate(
    report: UnifiedTelemetryReport,
    options?: QuotaCircuitBreakerOptions,
  ): CircuitBreakerEvaluation {
    return new QuotaCircuitBreaker().evaluate(report, options);
  }

  public static formatMarkdown(evaluation: CircuitBreakerEvaluation, detailed = false): string {
    return formatCircuitBreakerMarkdown(evaluation, detailed);
  }
}
