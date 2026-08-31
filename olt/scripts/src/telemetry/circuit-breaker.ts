import type { TelemetryNormalizationEngine } from "./engine.ts";
import type { NormalizedQuotaMetric, UnifiedTelemetryReport } from "./types.ts";
import { formatCircuitBreakerMarkdown } from "./circuit-breaker-markdown.ts";
import {
  AUTO_WAKE_PROMPT,
  CRITICAL_WRAP_UP_MESSAGE,
  DEFAULT_AUTO_WAKE_BUFFER_SECONDS,
  DEFAULT_QUOTA_THRESHOLD,
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
  DEFAULT_QUOTA_THRESHOLD,
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

export class QuotaCircuitBreaker {
  private readonly defaultThreshold: number;
  private readonly defaultSafeWindowSeconds: number;
  private readonly defaultBufferSeconds: number;
  private readonly defaultActiveHost?: string | undefined;

  constructor(
    options: {
      thresholdPercentage?: number;
      defaultSafeWindowSeconds?: number;
      bufferSeconds?: number;
      activeHost?: string;
    } = {},
  ) {
    this.defaultThreshold =
      typeof options.thresholdPercentage === "number"
        ? options.thresholdPercentage
        : DEFAULT_QUOTA_THRESHOLD;
    this.defaultSafeWindowSeconds =
      typeof options.defaultSafeWindowSeconds === "number"
        ? options.defaultSafeWindowSeconds
        : DEFAULT_SAFE_WINDOW_SECONDS;
    this.defaultBufferSeconds =
      typeof options.bufferSeconds === "number"
        ? options.bufferSeconds
        : DEFAULT_AUTO_WAKE_BUFFER_SECONDS;
    this.defaultActiveHost = options.activeHost;
  }

  public evaluate(
    report: UnifiedTelemetryReport,
    options?: QuotaCircuitBreakerOptions,
  ): CircuitBreakerEvaluation {
    const activeHost =
      options && typeof options.activeHost === "string"
        ? options.activeHost
        : this.defaultActiveHost;
    const mergedOptions: QuotaCircuitBreakerOptions = {
      ...options,
      ...(activeHost !== undefined ? { activeHost } : {}),
    };
    return evaluateCircuitBreaker(report, mergedOptions, {
      threshold: this.defaultThreshold,
      safeWindow: this.defaultSafeWindowSeconds,
      buffer: this.defaultBufferSeconds,
    });
  }

  public async evaluateAsync(
    engine: TelemetryNormalizationEngine,
    options?: QuotaCircuitBreakerOptions,
  ): Promise<CircuitBreakerEvaluation> {
    const report = await engine.probeAll();
    return this.evaluate(report, options);
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
