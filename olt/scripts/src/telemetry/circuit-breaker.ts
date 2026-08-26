/**
 * Quota Circuit-Breaker & Dynamic Auto-Wake Scheduler Engine
 *
 * Provides autonomous quota threshold monitoring (<5%), wrap-up directive generation
 * for active agents (preserving memory/state without terminating), and precise
 * reset-time-based one-shot auto-wake schedule computation with safe-window fallback.
 */

import type { TelemetryNormalizationEngine } from "./engine.ts";
import type { NormalizedQuotaMetric, UnifiedTelemetryReport } from "./types.ts";

export type CircuitBreakerStatus = "OK" | "QUOTA_EXHAUSTED_CIRCUIT_BROKEN";

export const DEFAULT_QUOTA_THRESHOLD = 5.0; // 5.0%
export const DEFAULT_SAFE_WINDOW_SECONDS = 18000; // 5 hours in seconds (18,000s)
export const DEFAULT_AUTO_WAKE_BUFFER_SECONDS = 60; // 60 seconds (+1m buffer)

export const CRITICAL_WRAP_UP_MESSAGE =
  "CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (<5%). Wrap up current micro-step immediately. Do not claim or start new tasks. Keep working tree changes unstaged/stashed safely without destructive actions. Enter idle state.";

export const AUTO_WAKE_PROMPT =
  "Quota limit refreshed (+1m buffer). Resuming autonomous execution from idle state.";

export interface WrapUpDirective {
  readonly recipient: string;
  readonly message: string;
  readonly action: "idle";
  readonly forbidKill: true;
  readonly reason: string;
}

export interface AutoWakeSchedulePayload {
  readonly type: "one_shot_timer";
  readonly durationSeconds: number;
  readonly targetWakeupIso: string;
  readonly prompt: string;
  readonly timerCondition: "never";
  readonly activeAgentsCount: number;
}

export interface ConstrainedModelInfo {
  readonly platformId: string;
  readonly modelName: string;
  readonly remainingPercentage: number;
  readonly resetTime?: string | undefined;
  readonly sourceTier?: string | undefined;
  readonly confidence?: string | undefined;
}

export interface CircuitBreakerEvaluation {
  readonly status: CircuitBreakerStatus;
  readonly isTriggered: boolean;
  readonly thresholdPercentage: number;
  readonly lowestRemainingQuota: number | null;
  readonly constrainedModels: readonly ConstrainedModelInfo[];
  readonly wrapUpDirectives: readonly WrapUpDirective[];
  readonly autoWakeSchedule: AutoWakeSchedulePayload | null;
  readonly summary: string;
  readonly evaluatedAt: string;
}

export interface QuotaCircuitBreakerOptions {
  readonly thresholdPercentage?: number | undefined;
  readonly activeAgentsCount?: number | undefined;
  readonly activeAgentIds?: readonly string[] | undefined;
  readonly now?: number | Date | string | undefined;
  readonly defaultSafeWindowSeconds?: number | undefined;
  readonly bufferSeconds?: number | undefined;
}

/**
 * Extracts ISO resetTime string from a normalized quota metric's raw payload,
 * inspecting standard Connect-RPC structures, quotaInfo, and userStatus.
 */
export function extractResetTime(metric: NormalizedQuotaMetric): string | undefined {
  const payload = metric.rawPayload;
  if (!payload || typeof payload !== "object") return undefined;

  const record = payload as Record<string, unknown>;

  // 1. Direct resetTime / reset_time on rawPayload
  if (typeof record.resetTime === "string" && record.resetTime.trim()) {
    return record.resetTime.trim();
  }
  if (typeof record.reset_time === "string" && record.reset_time.trim()) {
    return record.reset_time.trim();
  }

  // 2. Inside quotaInfo
  if (typeof record.quotaInfo === "object" && record.quotaInfo !== null) {
    const quotaInfo = record.quotaInfo as Record<string, unknown>;
    if (typeof quotaInfo.resetTime === "string" && quotaInfo.resetTime.trim()) {
      return quotaInfo.resetTime.trim();
    }
    if (typeof quotaInfo.reset_time === "string" && quotaInfo.reset_time.trim()) {
      return quotaInfo.reset_time.trim();
    }
  }

  // 3. Nested inside userStatus
  if (typeof record.userStatus === "object" && record.userStatus !== null) {
    const userStatus = record.userStatus as Record<string, unknown>;
    if (typeof userStatus.quotaInfo === "object" && userStatus.quotaInfo !== null) {
      const qInfo = userStatus.quotaInfo as Record<string, unknown>;
      if (typeof qInfo.resetTime === "string" && qInfo.resetTime.trim()) {
        return qInfo.resetTime.trim();
      }
      if (typeof qInfo.reset_time === "string" && qInfo.reset_time.trim()) {
        return qInfo.reset_time.trim();
      }
    }
    if (typeof userStatus.resetTime === "string" && userStatus.resetTime.trim()) {
      return userStatus.resetTime.trim();
    }
  }

  return undefined;
}

export class QuotaCircuitBreaker {
  private readonly defaultThreshold: number;
  private readonly defaultSafeWindowSeconds: number;
  private readonly defaultBufferSeconds: number;

  constructor(
    options: {
      thresholdPercentage?: number;
      defaultSafeWindowSeconds?: number;
      bufferSeconds?: number;
    } = {},
  ) {
    this.defaultThreshold = options.thresholdPercentage ?? DEFAULT_QUOTA_THRESHOLD;
    this.defaultSafeWindowSeconds = options.defaultSafeWindowSeconds ?? DEFAULT_SAFE_WINDOW_SECONDS;
    this.defaultBufferSeconds = options.bufferSeconds ?? DEFAULT_AUTO_WAKE_BUFFER_SECONDS;
  }

  /**
   * Evaluates a UnifiedTelemetryReport synchronously against quota threshold limits.
   */
  public evaluate(
    report: UnifiedTelemetryReport,
    options?: QuotaCircuitBreakerOptions,
  ): CircuitBreakerEvaluation {
    const threshold = options?.thresholdPercentage ?? this.defaultThreshold;
    const defaultSafeWindow = options?.defaultSafeWindowSeconds ?? this.defaultSafeWindowSeconds;
    const bufferSec = options?.bufferSeconds ?? this.defaultBufferSeconds;
    const activeAgentsCount = options?.activeAgentsCount ?? options?.activeAgentIds?.length ?? 0;

    const nowMs =
      options?.now !== undefined
        ? options.now instanceof Date
          ? options.now.getTime()
          : typeof options.now === "string"
            ? new Date(options.now).getTime()
            : options.now
        : Date.now();

    const constrainedModels: ConstrainedModelInfo[] = [];
    let lowestRemainingQuota: number | null = null;

    for (const res of report.results) {
      if (res.isDetected === false || res.metrics.length === 0) {
        continue;
      }
      for (const metric of res.metrics) {
        if (metric.remainingPercentage === null) {
          continue;
        }

        if (lowestRemainingQuota === null || metric.remainingPercentage < lowestRemainingQuota) {
          lowestRemainingQuota = metric.remainingPercentage;
        }

        if (metric.remainingPercentage < threshold) {
          constrainedModels.push({
            platformId: res.platformId,
            modelName: metric.rawMetricName,
            remainingPercentage: metric.remainingPercentage,
            resetTime: extractResetTime(metric),
            sourceTier: metric.sourceTier,
            confidence: metric.confidence,
          });
        }
      }
    }

    if (
      typeof report.summary?.lowestRemainingQuota === "number" &&
      (lowestRemainingQuota === null || report.summary.lowestRemainingQuota < lowestRemainingQuota)
    ) {
      lowestRemainingQuota = report.summary.lowestRemainingQuota;
    }

    const isTriggered =
      (lowestRemainingQuota !== null && lowestRemainingQuota < threshold) ||
      constrainedModels.length > 0;

    if (!isTriggered) {
      const summary =
        lowestRemainingQuota !== null
          ? `Quota healthy at ${lowestRemainingQuota.toFixed(2)}% (threshold: ${threshold.toFixed(2)}%). Circuit breaker inactive.`
          : "No quota metrics detected; execution running normally.";

      return {
        status: "OK",
        isTriggered: false,
        thresholdPercentage: threshold,
        lowestRemainingQuota,
        constrainedModels: [],
        wrapUpDirectives: [],
        autoWakeSchedule: null,
        summary,
        evaluatedAt: new Date(nowMs).toISOString(),
      };
    }

    // 1. Generate Wrap-Up Directives
    const wrapUpDirectives: WrapUpDirective[] =
      options?.activeAgentIds && options.activeAgentIds.length > 0
        ? options.activeAgentIds.map((agentId) => ({
            recipient: agentId,
            message: CRITICAL_WRAP_UP_MESSAGE,
            action: "idle" as const,
            forbidKill: true as const,
            reason: `Quota threshold breached (<${threshold}%).`,
          }))
        : [
            {
              recipient: "all_active_agents",
              message: CRITICAL_WRAP_UP_MESSAGE,
              action: "idle" as const,
              forbidKill: true as const,
              reason: `Quota threshold breached (<${threshold}%).`,
            },
          ];

    // 2. Dynamic Auto-Wake Scheduler Calculation
    // Find earliest upcoming resetTime among constrained models
    const validResetDates: Date[] = [];
    for (const model of constrainedModels) {
      if (model.resetTime) {
        const parsed = new Date(model.resetTime);
        if (!isNaN(parsed.getTime())) {
          validResetDates.push(parsed);
        }
      }
    }

    let targetWakeupMs: number;
    let durationSeconds: number;

    if (validResetDates.length > 0) {
      // Sort ascending to pick the earliest relevant reset time
      validResetDates.sort((a, b) => a.getTime() - b.getTime());
      const earliestResetDate = validResetDates[0]!;

      targetWakeupMs = earliestResetDate.getTime() + bufferSec * 1000;
      const diffSeconds = Math.ceil((targetWakeupMs - nowMs) / 1000);
      durationSeconds = Math.max(bufferSec, diffSeconds);
    } else {
      // Fall back to default 5-hour safe window (18000s + 60s)
      durationSeconds = defaultSafeWindow + bufferSec;
      targetWakeupMs = nowMs + durationSeconds * 1000;
    }

    const autoWakeSchedule: AutoWakeSchedulePayload = {
      type: "one_shot_timer",
      durationSeconds,
      targetWakeupIso: new Date(targetWakeupMs).toISOString(),
      prompt: AUTO_WAKE_PROMPT,
      timerCondition: "never",
      activeAgentsCount,
    };

    const summary = `🚨 CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (<${threshold}%). Lowest quota: ${
      lowestRemainingQuota !== null ? `${lowestRemainingQuota.toFixed(2)}%` : "unknown"
    }. ${constrainedModels.length} constrained models. Auto-wake in ${durationSeconds}s at ${autoWakeSchedule.targetWakeupIso}.`;

    return {
      status: "QUOTA_EXHAUSTED_CIRCUIT_BROKEN",
      isTriggered: true,
      thresholdPercentage: threshold,
      lowestRemainingQuota,
      constrainedModels,
      wrapUpDirectives,
      autoWakeSchedule,
      summary,
      evaluatedAt: new Date(nowMs).toISOString(),
    };
  }

  /**
   * Asynchronously probes the normalization engine and evaluates the resulting report.
   */
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

export function formatCircuitBreakerMarkdown(
  evaluation: CircuitBreakerEvaluation,
  detailed = false,
): string {
  const lines: string[] = [];

  if (evaluation.isTriggered) {
    lines.push(
      "┌──────────────────────────────────────────────────────────────────────────────────────────────────┐",
    );
    lines.push(
      "│                         🚨 CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (<5%) 🚨                      │",
    );
    lines.push(
      "├──────────────────────────────┬───────────────────────────────────────────────────────────────────┤",
    );
    lines.push(`│ State Status                 │ ${evaluation.status.padEnd(65).slice(0, 65)} │`);
    lines.push(
      `│ Lowest Remaining Quota       │ ${(evaluation.lowestRemainingQuota !== null ? `${evaluation.lowestRemainingQuota.toFixed(2)}%` : "None").padEnd(65).slice(0, 65)} │`,
    );
    lines.push(
      `│ Trigger Threshold            │ ${`${evaluation.thresholdPercentage.toFixed(2)}%`.padEnd(65).slice(0, 65)} │`,
    );
    lines.push(
      `│ Constrained Models Count     │ ${String(evaluation.constrainedModels.length).padEnd(65).slice(0, 65)} │`,
    );

    if (evaluation.autoWakeSchedule) {
      lines.push(
        `│ Target Wakeup Time (ISO)     │ ${evaluation.autoWakeSchedule.targetWakeupIso.padEnd(65).slice(0, 65)} │`,
      );
      lines.push(
        `│ Auto-Wake Timer Duration     │ ${`${evaluation.autoWakeSchedule.durationSeconds}s (${Math.floor(evaluation.autoWakeSchedule.durationSeconds / 60)}m ${evaluation.autoWakeSchedule.durationSeconds % 60}s)`.padEnd(65).slice(0, 65)} │`,
      );
      lines.push(
        `│ Scheduler Timer Condition    │ ${evaluation.autoWakeSchedule.timerCondition.padEnd(65).slice(0, 65)} │`,
      );
      lines.push(
        `│ Active Agents Retained       │ ${String(evaluation.autoWakeSchedule.activeAgentsCount).padEnd(65).slice(0, 65)} │`,
      );
    }

    lines.push(
      "├──────────────────────────────┴───────────────────────────────────────────────────────────────────┤",
    );
    lines.push(
      "│                                    AGENT WRAP-UP DIRECTIVES                                       │",
    );
    lines.push(
      "├──────────────────────────────────────────────────────────────────────────────────────────────────┤",
    );
    lines.push(
      "│ • Directives Broadcast: Wrap up current micro-step immediately. Do not claim or start new tasks. │",
    );
    lines.push(
      "│ • Preservation Rule: Keep working tree changes unstaged/stashed safely without destructive actions│",
    );
    lines.push(
      "│ • Non-Destructive Invariant: Do NOT kill active subagents (manage_subagents kill forbidden).     │",
    );
    lines.push(
      "│ • State Action: All active subagents transition to IDLE state in memory.                         │",
    );
    lines.push(
      "└──────────────────────────────────────────────────────────────────────────────────────────────────┘",
    );
    lines.push("");
    lines.push(`> ⚠️ **${evaluation.summary}**`);

    if (evaluation.constrainedModels.length > 0) {
      lines.push("");
      lines.push("### Constrained Models Breakdown");
      for (const m of evaluation.constrainedModels) {
        const resetNote = m.resetTime
          ? `(Resets at \`${m.resetTime}\`)`
          : "(No reset time detected; default safe window applied)";
        lines.push(
          `- **\`${m.platformId}\` / \`${m.modelName}\`**: ${m.remainingPercentage.toFixed(2)}% remaining ${resetNote}`,
        );
      }
    }

    if (evaluation.autoWakeSchedule) {
      lines.push("");
      lines.push("### One-Shot Scheduler Registration Payload");
      lines.push("```json");
      lines.push(JSON.stringify(evaluation.autoWakeSchedule, null, 2));
      lines.push("```");
    }
  } else {
    lines.push(
      "┌──────────────────────────────────────────────────────────────────────────────────────────────────┐",
    );
    lines.push(
      "│                                QUOTA CIRCUIT-BREAKER: STATUS NOMINAL                             │",
    );
    lines.push(
      "├──────────────────────────────┬───────────────────────────────────────────────────────────────────┤",
    );
    lines.push(`│ State Status                 │ ${evaluation.status.padEnd(65).slice(0, 65)} │`);
    lines.push(
      `│ Lowest Remaining Quota       │ ${(evaluation.lowestRemainingQuota !== null ? `${evaluation.lowestRemainingQuota.toFixed(2)}%` : "None").padEnd(65).slice(0, 65)} │`,
    );
    lines.push(
      `│ Trigger Threshold            │ ${`${evaluation.thresholdPercentage.toFixed(2)}%`.padEnd(65).slice(0, 65)} │`,
    );
    lines.push(`│ Circuit-Breaker Triggered    │ ${"false (Nominal)".padEnd(65).slice(0, 65)} │`);
    lines.push(
      "└──────────────────────────────┴───────────────────────────────────────────────────────────────────┘",
    );
    lines.push("");
    lines.push(`> ✅ **${evaluation.summary}**`);
  }

  if (detailed && evaluation.wrapUpDirectives.length > 0) {
    lines.push("");
    lines.push("### Wrap-Up Directives JSON");
    lines.push("```json");
    lines.push(JSON.stringify(evaluation.wrapUpDirectives, null, 2));
    lines.push("```");
  }

  return lines.join("\n");
}
