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
): TierResult | null {
  if (!statusPayload || typeof statusPayload !== "object") {
    return null;
  }

  const parsedRoot = statusPayload as Record<string, unknown>;
  const cached = (parsedRoot.cachedUsageUtilization ?? parsedRoot) as Record<string, unknown>;
  const utilData = (cached.utilization ?? parsedRoot.utilization ?? parsedRoot) as Record<
    string,
    unknown
  >;

  if (!utilData || typeof utilData !== "object") {
    return null;
  }

  const metrics: NormalizedQuotaMetric[] = [];

  if (utilData.five_hour && typeof utilData.five_hour === "object") {
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

  if (utilData.seven_day && typeof utilData.seven_day === "object") {
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

  if (utilData.seven_day_opus && typeof utilData.seven_day_opus === "object") {
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

  if (utilData.seven_day_sonnet && typeof utilData.seven_day_sonnet === "object") {
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

  if (metrics.length === 0) {
    return null;
  }

  const oauth = (parsedRoot.oauthAccount ?? cached.oauthAccount) as
    | Record<string, unknown>
    | undefined;

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

  return {
    sourceTier,
    metrics,
    rawObservations,
  };
}

export function parseClaudeCliUsageOutput(stdout: string): TierResult {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const remaining =
      typeof parsed.remaining_percentage === "number"
        ? parsed.remaining_percentage
        : typeof parsed.remainingPercentage === "number"
          ? parsed.remainingPercentage
          : null;
    return {
      sourceTier: "tier1_cli_command",
      metrics: [
        {
          rawMetricName: "claude_session_tokens",
          canonicalProvider: "anthropic",
          windowType: "session",
          remainingPercentage: remaining === null ? null : Math.max(0, Math.min(100, remaining)),
          sourceTier: "tier1_cli_command",
          confidence: remaining === null ? "unknown" : "verified_exact",
          rawPayload: parsed,
        },
      ],
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

export function parseClaudeStoragePayload(content: string, filePath: string): TierResult | null {
  try {
    const parsedRoot = JSON.parse(content) as Record<string, unknown>;
    const utilizationResult = parseClaudeUsagePayload(
      parsedRoot,
      "tier2_local_storage",
      "cached",
      filePath,
    );
    if (utilizationResult) {
      return utilizationResult;
    }

    const remaining =
      typeof parsedRoot.remainingPercentage === "number"
        ? parsedRoot.remainingPercentage
        : typeof parsedRoot.quotaRemaining === "number"
          ? parsedRoot.quotaRemaining
          : undefined;

    if (remaining !== undefined) {
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
            rawPayload: parsedRoot,
          },
        ],
        rawObservations: { storagePath: filePath, content: parsedRoot },
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
