import { join } from "node:path";
import { BaseTieredCollector, type TierResult } from "../base-collector.ts";
import type { ConfidenceLevel, NormalizedQuotaMetric } from "../types.ts";
import { DefaultCollectorEnvironment, type CollectorEnvironment } from "./common.ts";

export class ClaudeCollector extends BaseTieredCollector {
  public readonly platformId = "claude";
  private readonly env: DefaultCollectorEnvironment;

  constructor(env: CollectorEnvironment = {}) {
    super();
    this.env = new DefaultCollectorEnvironment(env);
  }

  protected async probeTier1Cli(): Promise<TierResult | null> {
    // 1. Claude OAuth / Usage Utilization Discovery
    const statusPayload = await this.env.fetchClaudeUsage();
    if (statusPayload) {
      const parsedRoot = statusPayload as Record<string, unknown>;
      const cached = (parsedRoot.cachedUsageUtilization ?? parsedRoot) as Record<string, unknown>;
      const utilData = (cached.utilization ?? parsedRoot.utilization ?? parsedRoot) as Record<
        string,
        unknown
      >;

      const metrics: NormalizedQuotaMetric[] = [];

      if (utilData && typeof utilData === "object") {
        if (utilData.five_hour && typeof utilData.five_hour === "object") {
          const fh = utilData.five_hour as Record<string, unknown>;
          const util = typeof fh.utilization === "number" ? fh.utilization : 0;
          const remaining = Math.max(0, Math.min(100, Math.round((100 - util) * 100) / 100));
          metrics.push({
            rawMetricName: "Claude Code (5-Hour Window)",
            canonicalProvider: "anthropic",
            windowType: "5_hour",
            remainingPercentage: remaining,
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: fh,
          });
        }

        if (utilData.seven_day && typeof utilData.seven_day === "object") {
          const sd = utilData.seven_day as Record<string, unknown>;
          const util = typeof sd.utilization === "number" ? sd.utilization : 0;
          const remaining = Math.max(0, Math.min(100, Math.round((100 - util) * 100) / 100));
          metrics.push({
            rawMetricName: "Claude Code (7-Day Weekly Limit)",
            canonicalProvider: "anthropic",
            windowType: "weekly",
            remainingPercentage: remaining,
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: sd,
          });
        }

        if (utilData.seven_day_opus && typeof utilData.seven_day_opus === "object") {
          const sdo = utilData.seven_day_opus as Record<string, unknown>;
          if (typeof sdo.utilization === "number") {
            const remaining = Math.max(
              0,
              Math.min(100, Math.round((100 - sdo.utilization) * 100) / 100),
            );
            metrics.push({
              rawMetricName: "Claude Opus (7-Day Limit)",
              canonicalProvider: "anthropic",
              windowType: "weekly",
              remainingPercentage: remaining,
              sourceTier: "tier1_cli_command",
              confidence: "verified_exact",
              rawPayload: sdo,
            });
          }
        }

        if (utilData.seven_day_sonnet && typeof utilData.seven_day_sonnet === "object") {
          const sds = utilData.seven_day_sonnet as Record<string, unknown>;
          if (typeof sds.utilization === "number") {
            const remaining = Math.max(
              0,
              Math.min(100, Math.round((100 - sds.utilization) * 100) / 100),
            );
            metrics.push({
              rawMetricName: "Claude Sonnet (7-Day Limit)",
              canonicalProvider: "anthropic",
              windowType: "weekly",
              remainingPercentage: remaining,
              sourceTier: "tier1_cli_command",
              confidence: "verified_exact",
              rawPayload: sds,
            });
          }
        }
      }

      if (metrics.length > 0) {
        const oauth = parsedRoot.oauthAccount as Record<string, unknown> | undefined;
        return {
          sourceTier: "tier1_cli_command",
          metrics,
          rawObservations: {
            utilization: utilData,
            oauthAccount: oauth,
            spend: utilData.spend,
            limits: utilData.limits,
            email: oauth?.emailAddress,
            accountUuid: oauth?.accountUuid,
            billingType: oauth?.billingType,
            planTier: oauth?.planTier,
          },
        };
      }
    }

    // 2. Legacy / CLI Output Fallbacks
    const usageResult = await this.env.exec("claude", ["/usage", "--json"]);
    if (usageResult && usageResult.stdout.trim()) {
      try {
        const parsed = JSON.parse(usageResult.stdout) as Record<string, unknown>;
        const remaining =
          typeof parsed.remaining_percentage === "number"
            ? parsed.remaining_percentage
            : typeof parsed.remainingPercentage === "number"
              ? parsed.remainingPercentage
              : 100;
        const metrics: NormalizedQuotaMetric[] = [
          {
            rawMetricName: "claude_session_tokens",
            canonicalProvider: "anthropic",
            windowType: "session",
            remainingPercentage: Math.max(0, Math.min(100, remaining)),
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
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
              remainingPercentage: 100,
              sourceTier: "tier1_cli_command",
              confidence: "inferred_metric",
              rawPayload: { rawOutput: usageResult.stdout.trim() },
            },
          ],
          rawObservations: { rawOutput: usageResult.stdout.trim() },
        };
      }
    }

    const verResult = await this.env.exec("claude", ["--version"]);
    if (verResult && verResult.stdout.trim()) {
      return {
        sourceTier: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "cli_presence",
            canonicalProvider: "anthropic",
            windowType: "session",
            remainingPercentage: 100,
            sourceTier: "tier1_cli_command",
            confidence: "inferred_metric",
            rawPayload: { version: verResult.stdout.trim() },
          },
        ],
        rawObservations: { version: verResult.stdout.trim() },
      };
    }

    return null;
  }

  protected async probeTier2Storage(): Promise<TierResult | null> {
    const home = this.env.homedir;
    const candidates = [
      join(home, ".claude.json"),
      join(home, ".claude", "stats.json"),
      join(home, ".claude", "config.json"),
      join(home, ".config", "claude", "session.json"),
    ];

    for (const filePath of candidates) {
      const content = await this.env.readFile(filePath);
      if (content) {
        try {
          const parsedRoot = JSON.parse(content) as Record<string, unknown>;
          const cached = (parsedRoot.cachedUsageUtilization ?? parsedRoot) as Record<
            string,
            unknown
          >;
          const utilData = (cached.utilization ?? parsedRoot.utilization ?? parsedRoot) as Record<
            string,
            unknown
          >;

          const metrics: NormalizedQuotaMetric[] = [];

          if (utilData && typeof utilData === "object") {
            if (utilData.five_hour && typeof utilData.five_hour === "object") {
              const fh = utilData.five_hour as Record<string, unknown>;
              const util = typeof fh.utilization === "number" ? fh.utilization : 0;
              const remaining = Math.max(0, Math.min(100, Math.round((100 - util) * 100) / 100));
              metrics.push({
                rawMetricName: "Claude Code (5-Hour Window)",
                canonicalProvider: "anthropic",
                windowType: "5_hour",
                remainingPercentage: remaining,
                sourceTier: "tier2_local_storage",
                confidence: "cached",
                rawPayload: fh,
              });
            }

            if (utilData.seven_day && typeof utilData.seven_day === "object") {
              const sd = utilData.seven_day as Record<string, unknown>;
              const util = typeof sd.utilization === "number" ? sd.utilization : 0;
              const remaining = Math.max(0, Math.min(100, Math.round((100 - util) * 100) / 100));
              metrics.push({
                rawMetricName: "Claude Code (7-Day Weekly Limit)",
                canonicalProvider: "anthropic",
                windowType: "weekly",
                remainingPercentage: remaining,
                sourceTier: "tier2_local_storage",
                confidence: "cached",
                rawPayload: sd,
              });
            }

            if (utilData.seven_day_opus && typeof utilData.seven_day_opus === "object") {
              const sdo = utilData.seven_day_opus as Record<string, unknown>;
              if (typeof sdo.utilization === "number") {
                const remaining = Math.max(
                  0,
                  Math.min(100, Math.round((100 - sdo.utilization) * 100) / 100),
                );
                metrics.push({
                  rawMetricName: "Claude Opus (7-Day Limit)",
                  canonicalProvider: "anthropic",
                  windowType: "weekly",
                  remainingPercentage: remaining,
                  sourceTier: "tier2_local_storage",
                  confidence: "cached",
                  rawPayload: sdo,
                });
              }
            }

            if (utilData.seven_day_sonnet && typeof utilData.seven_day_sonnet === "object") {
              const sds = utilData.seven_day_sonnet as Record<string, unknown>;
              if (typeof sds.utilization === "number") {
                const remaining = Math.max(
                  0,
                  Math.min(100, Math.round((100 - sds.utilization) * 100) / 100),
                );
                metrics.push({
                  rawMetricName: "Claude Sonnet (7-Day Limit)",
                  canonicalProvider: "anthropic",
                  windowType: "weekly",
                  remainingPercentage: remaining,
                  sourceTier: "tier2_local_storage",
                  confidence: "cached",
                  rawPayload: sds,
                });
              }
            }
          }

          if (metrics.length > 0) {
            const oauth = (parsedRoot.oauthAccount ?? cached.oauthAccount) as
              | Record<string, unknown>
              | undefined;
            return {
              sourceTier: "tier2_local_storage",
              metrics,
              rawObservations: {
                storagePath: filePath,
                utilization: utilData,
                oauthAccount: oauth,
                spend: utilData.spend,
                limits: utilData.limits,
                email: oauth?.emailAddress,
                accountUuid: oauth?.accountUuid,
                billingType: oauth?.billingType,
                planTier: oauth?.planTier,
              },
            };
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
          // JSON parse failed or unreadable, continue to next candidate
        }
      }
    }
    return null;
  }

  protected async probeTier3Runtime(): Promise<TierResult | null> {
    const env = this.env.env;
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
            remainingPercentage: 100,
            sourceTier: "tier3_runtime",
            confidence: "inferred_metric",
            rawPayload: { detectedVariables: detected },
          },
        ],
        rawObservations: { detectedVariables: detected },
      };
    }
    return null;
  }

  protected override getTerminalReason(): string {
    return "No Claude Session · No API Key";
  }
}
