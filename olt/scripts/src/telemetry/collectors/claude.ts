import { join } from "node:path";
import { BaseTieredCollector, type TierResult } from "../base-collector.ts";
import type { NormalizedQuotaMetric } from "../types.ts";
import { DefaultCollectorEnvironment, type CollectorEnvironment } from "./common.ts";

export class ClaudeCollector extends BaseTieredCollector {
  public readonly platformId = "claude";
  private readonly env: DefaultCollectorEnvironment;

  constructor(env: CollectorEnvironment = {}) {
    super();
    this.env = new DefaultCollectorEnvironment(env);
  }

  protected async probeTier1Cli(): Promise<TierResult | null> {
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
      join(home, ".claude", "stats.json"),
      join(home, ".claude", "config.json"),
      join(home, ".config", "claude", "session.json"),
    ];

    for (const filePath of candidates) {
      const content = await this.env.readFile(filePath);
      if (content) {
        try {
          const parsed = JSON.parse(content) as Record<string, unknown>;
          const remaining =
            typeof parsed.remainingPercentage === "number"
              ? parsed.remainingPercentage
              : typeof parsed.quotaRemaining === "number"
                ? parsed.quotaRemaining
                : 95;
          return {
            sourceTier: "tier2_local_storage",
            metrics: [
              {
                rawMetricName: "local_session_stats",
                canonicalProvider: "anthropic",
                windowType: "session",
                remainingPercentage: Math.max(0, Math.min(100, remaining)),
                sourceTier: "tier2_local_storage",
                confidence: "inferred_metric",
                rawPayload: parsed,
              },
            ],
            rawObservations: { storagePath: filePath, content: parsed },
          };
        } catch {
          return {
            sourceTier: "tier2_local_storage",
            metrics: [
              {
                rawMetricName: "local_config_file",
                canonicalProvider: "anthropic",
                windowType: "session",
                remainingPercentage: 100,
                sourceTier: "tier2_local_storage",
                confidence: "heuristic",
                rawPayload: { filePath },
              },
            ],
            rawObservations: { storagePath: filePath },
          };
        }
      }
    }
    return null;
  }

  protected async probeTier3Runtime(): Promise<TierResult | null> {
    const env = this.env.env;
    const detected: string[] = [];
    if (env.ANTHROPIC_API_KEY) detected.push("ANTHROPIC_API_KEY");
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
            confidence: "heuristic",
            rawPayload: { detectedVariables: detected },
          },
        ],
        rawObservations: { detectedVariables: detected },
      };
    }
    return null;
  }
}
