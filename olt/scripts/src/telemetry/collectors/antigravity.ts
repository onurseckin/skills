import { join } from "node:path";
import { BaseTieredCollector, type TierResult } from "../base-collector.ts";
import type { NormalizedQuotaMetric } from "../types.ts";
import { DefaultCollectorEnvironment, type CollectorEnvironment } from "./common.ts";

export class AntigravityCollector extends BaseTieredCollector {
  public readonly platformId = "antigravity";
  private readonly env: DefaultCollectorEnvironment;

  constructor(env: CollectorEnvironment = {}) {
    super();
    this.env = new DefaultCollectorEnvironment(env);
  }

  protected async probeTier1Cli(): Promise<TierResult | null> {
    const quotaResult = await this.env.exec("agy", ["quota", "--json"]);
    if (quotaResult && quotaResult.stdout.trim()) {
      try {
        const parsed = JSON.parse(quotaResult.stdout) as Record<string, unknown>;
        const remaining =
          typeof parsed.remaining_percentage === "number"
            ? parsed.remaining_percentage
            : typeof parsed.remainingPercentage === "number"
              ? parsed.remainingPercentage
              : 100;
        const metrics: NormalizedQuotaMetric[] = [
          {
            rawMetricName: "gemini_requests_per_minute",
            canonicalProvider: "google",
            windowType: "minute",
            remainingPercentage: Math.max(0, Math.min(100, remaining)),
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: parsed,
          },
        ];
        return {
          sourceTier: "tier1_cli_command",
          metrics,
          rawObservations: { cliOutput: parsed, command: "agy quota --json" },
        };
      } catch {
        return {
          sourceTier: "tier1_cli_command",
          metrics: [
            {
              rawMetricName: "cli_presence",
              canonicalProvider: "google",
              windowType: "session",
              remainingPercentage: 100,
              sourceTier: "tier1_cli_command",
              confidence: "inferred_metric",
              rawPayload: { rawOutput: quotaResult.stdout.trim() },
            },
          ],
          rawObservations: { rawOutput: quotaResult.stdout.trim() },
        };
      }
    }

    const verResult = await this.env.exec("agy", ["--version"]);
    if (verResult && verResult.stdout.trim()) {
      return {
        sourceTier: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "cli_presence",
            canonicalProvider: "google",
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
      join(home, ".gemini", "antigravity-cli", "state.json"),
      join(home, ".gemini", "antigravity-cli", "quota.json"),
      join(home, ".config", "antigravity", "state.json"),
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
                : 90;
          return {
            sourceTier: "tier2_local_storage",
            metrics: [
              {
                rawMetricName: "local_state_quota",
                canonicalProvider: "google",
                windowType: "daily",
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
                rawMetricName: "local_state_file",
                canonicalProvider: "google",
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
    if (env.GEMINI_API_KEY) detected.push("GEMINI_API_KEY");
    if (env.ANTIGRAVITY_APP_DIR) detected.push("ANTIGRAVITY_APP_DIR");
    if (env.GOOGLE_API_KEY) detected.push("GOOGLE_API_KEY");
    if (env.ANTIGRAVITY_CLI_VERSION) detected.push("ANTIGRAVITY_CLI_VERSION");

    if (detected.length > 0) {
      return {
        sourceTier: "tier3_runtime",
        metrics: [
          {
            rawMetricName: "runtime_environment",
            canonicalProvider: "google",
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
