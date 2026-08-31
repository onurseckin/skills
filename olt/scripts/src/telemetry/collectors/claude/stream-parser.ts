import type { TierResult } from "../../base-collector.ts";
import type { NormalizedQuotaMetric } from "../../types.ts";

function calculateRemainingPercentage(utilization: number): number {
  return Math.max(0, Math.min(100, Math.round((100 - utilization) * 100) / 100));
}

export function parseClaudeUsagePayload(
  statusPayload: unknown,
  sourceTier: "tier1_cli_command" | "tier2_local_storage",
  confidence: "verified_exact" | "cached",
  storagePath?: string,
  options?: { isExternalCache?: boolean },
): TierResult | null {
  if (!statusPayload) return null;
  if (typeof statusPayload !== "object") return null;

  const parsedRoot = statusPayload as Record<string, unknown>;
  const cached = (parsedRoot.cachedUsageUtilization !== undefined ? parsedRoot.cachedUsageUtilization : parsedRoot) as Record<string, unknown>;

  let utilDataCandidate: unknown = cached.utilization;
  if (utilDataCandidate === undefined) {
    utilDataCandidate = parsedRoot.utilization !== undefined ? parsedRoot.utilization : parsedRoot;
  }
  const utilData = utilDataCandidate as Record<string, unknown>;

  if (!utilData) return null;
  if (typeof utilData !== "object") return null;

  const metrics: NormalizedQuotaMetric[] = [];

  if (utilData.five_hour) {
    if (typeof utilData.five_hour === "object") {
      const fh = utilData.five_hour as Record<string, unknown>;
      const util = typeof fh.utilization === "number" ? fh.utilization : 0;
      metrics.push({
        rawMetricName: "Claude Code (5-Hour Window)",
        canonicalProvider: "anthropic",
        windowType: "5_hour",
        remainingPercentage: calculateRemainingPercentage(util),
        sourceTier,
        confidence,
        rawPayload: fh,
      });
    }
  }

  if (utilData.seven_day) {
    if (typeof utilData.seven_day === "object") {
      const sd = utilData.seven_day as Record<string, unknown>;
      const util = typeof sd.utilization === "number" ? sd.utilization : 0;
      metrics.push({
        rawMetricName: "Claude Code (7-Day Weekly Limit)",
        canonicalProvider: "anthropic",
        windowType: "weekly",
        remainingPercentage: calculateRemainingPercentage(util),
        sourceTier,
        confidence,
        rawPayload: sd,
      });
    }
  }

  if (utilData.seven_day_opus) {
    if (typeof utilData.seven_day_opus === "object") {
      const sdo = utilData.seven_day_opus as Record<string, unknown>;
      if (typeof sdo.utilization === "number") {
        metrics.push({
          rawMetricName: "Claude Opus (7-Day Limit)",
          canonicalProvider: "anthropic",
          windowType: "weekly",
          remainingPercentage: calculateRemainingPercentage(sdo.utilization),
          sourceTier,
          confidence,
          rawPayload: sdo,
        });
      }
    }
  }

  if (utilData.seven_day_sonnet) {
    if (typeof utilData.seven_day_sonnet === "object") {
      const sds = utilData.seven_day_sonnet as Record<string, unknown>;
      if (typeof sds.utilization === "number") {
        metrics.push({
          rawMetricName: "Claude Sonnet (7-Day Limit)",
          canonicalProvider: "anthropic",
          windowType: "weekly",
          remainingPercentage: calculateRemainingPercentage(sds.utilization),
          sourceTier,
          confidence,
          rawPayload: sds,
        });
      }
    }
  }

  if (metrics.length === 0) {
    return null;
  }

  let oauthCandidate = parsedRoot.oauthAccount;
  if (oauthCandidate === undefined) {
    oauthCandidate = cached.oauthAccount;
  }
  const oauth = oauthCandidate as Record<string, unknown> | undefined;

  const rawObservations: Record<string, unknown> = {
    utilization: utilData,
    oauthAccount: oauth,
    spend: utilData.spend,
    limits: utilData.limits,
    email: oauth?.emailAddress,
    accountUuid: oauth?.accountUuid,
    billingType: oauth?.billingType,
    planTier: oauth?.planTier,
  };

  if (storagePath) {
    rawObservations.storagePath = storagePath;
  }

  const isExt = options?.isExternalCache === true;
  if (isExt) {
    rawObservations.storagePath = storagePath !== undefined ? storagePath : "external_claude_cache";
  }

  const reason = isExt ? "[Isolated External Cache] Inactive host cache" : undefined;

  return {
    sourceTier,
    metrics: isExt
      ? metrics.map((m) => ({ ...m, rawPayload: { ...m.rawPayload, isExternalCache: true } }))
      : metrics,
    rawObservations,
    reason,
  };
}

export function parseClaudeCliUsageOutput(stdout: string): TierResult {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    let remaining: number | null = null;
    if (typeof parsed.remaining_percentage === "number") {
      remaining = parsed.remaining_percentage;
    } else if (typeof parsed.remainingPercentage === "number") {
      remaining = parsed.remainingPercentage;
    }
    const metricName =
      typeof parsed.metric_name === "string"
        ? parsed.metric_name
        : typeof parsed.metricName === "string"
          ? parsed.metricName
          : "claude_session_tokens";
    const metrics: NormalizedQuotaMetric[] = [
      {
        rawMetricName: metricName,
        canonicalProvider: "anthropic",
        windowType: "monthly",
        remainingPercentage: remaining === null ? null : Math.max(0, Math.min(100, remaining)),
        sourceTier: "tier1_cli_command",
        confidence: remaining === null ? "unknown" : "verified_exact",
        rawPayload: parsed,
      },
    ];
    return {
      sourceTier: "tier1_cli_command",
      metrics,
      rawObservations: { cliOutput: parsed, command: "claude /usage --json" },
    };
  } catch {
    return {
      sourceTier: "tier1_cli_command",
      metrics: [
        {
          rawMetricName: "cli_presence",
          canonicalProvider: "anthropic",
          windowType: "session",
          remainingPercentage: null,
          sourceTier: "tier1_cli_command",
          confidence: "unknown",
          rawPayload: { rawOutput: stdout.trim() },
        },
      ],
      rawObservations: { rawOutput: stdout.trim() },
    };
  }
}

export function parseClaudeCliVersionOutput(version: string): TierResult {
  return {
    sourceTier: "tier1_cli_command",
    metrics: [
      {
        rawMetricName: "cli_presence",
        canonicalProvider: "anthropic",
        windowType: "session",
        remainingPercentage: null,
        sourceTier: "tier1_cli_command",
        confidence: "unknown",
        rawPayload: { version: version.trim() },
      },
    ],
    rawObservations: { version: version.trim() },
  };
}

export function parseClaudeStoragePayload(
  content: string,
  filePath: string,
  options?: { isExternalCache?: boolean },
): TierResult | null {
  try {
    const parsedRoot = JSON.parse(content) as Record<string, unknown>;
    const utilizationResult = parseClaudeUsagePayload(
      parsedRoot,
      "tier2_local_storage",
      "cached",
      filePath,
      options,
    );
    if (utilizationResult) {
      return utilizationResult;
    }

    let remaining: number | undefined = undefined;
    if (typeof parsedRoot.remainingPercentage === "number") {
      remaining = parsedRoot.remainingPercentage;
    } else if (typeof parsedRoot.quotaRemaining === "number") {
      remaining = parsedRoot.quotaRemaining;
    }

    if (remaining !== undefined) {
      const isExt = options?.isExternalCache === true;
      const rawPayload = isExt ? { ...parsedRoot, isExternalCache: true } : parsedRoot;
      const rawObservations: Record<string, unknown> = {
        storagePath: filePath,
        content: parsedRoot,
      };
      const reason = isExt ? "[Isolated External Cache] Inactive host cache" : undefined;
      return {
        sourceTier: "tier2_local_storage",
        metrics: [
          {
            rawMetricName: "local_session_stats",
            canonicalProvider: "anthropic",
            windowType: "session",
            remainingPercentage: Math.max(0, Math.min(100, remaining)),
            sourceTier: "tier2_local_storage",
            confidence: "cached",
            rawPayload,
          },
        ],
        rawObservations,
        reason,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function parseClaudeRuntimeEnv(env: Record<string, string | undefined>): TierResult | null {
  const detected: string[] = [];
  if (env.ANTHROPIC_API_KEY) detected.push("ANTHROPIC_API_KEY");
  if (env.CLAUDE_API_KEY) detected.push("CLAUDE_API_KEY");
  if (env.CLAUDE_CODE_ENTRYPOINT) detected.push("CLAUDE_CODE_ENTRYPOINT");
  if (env.CLAUDE_SESSION_ID) detected.push("CLAUDE_SESSION_ID");

  if (detected.length > 0) {
    return {
      sourceTier: "tier3_runtime",
      metrics: [
        {
          rawMetricName: "runtime_environment",
          canonicalProvider: "anthropic",
          windowType: "session",
          remainingPercentage: null,
          sourceTier: "tier3_runtime",
          confidence: "unknown",
          rawPayload: { detectedVariables: detected },
        },
      ],
      rawObservations: { detectedVariables: detected },
    };
  }
  return null;
}
