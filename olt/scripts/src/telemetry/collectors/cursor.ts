import { join } from "node:path";
import { BaseTieredCollector, type TierResult } from "../base-collector.ts";
import type { NormalizedQuotaMetric } from "../types.ts";
import { DefaultCollectorEnvironment, type CollectorEnvironment } from "./common.ts";

export class CursorCollector extends BaseTieredCollector {
  public readonly platformId = "cursor";
  private readonly env: DefaultCollectorEnvironment;

  constructor(env: CollectorEnvironment = {}) {
    super();
    this.env = new DefaultCollectorEnvironment(env);
  }

  protected async probeTier1Cli(): Promise<TierResult | null> {
    const statusResult = await this.env.exec("cursor", ["status", "--json"]);
    if (statusResult && statusResult.stdout.trim()) {
      try {
        const parsed = JSON.parse(statusResult.stdout) as Record<string, unknown>;
        const remaining =
          typeof parsed.remaining_percentage === "number"
            ? parsed.remaining_percentage
            : typeof parsed.remainingPercentage === "number"
              ? parsed.remainingPercentage
              : null;
        const metrics: NormalizedQuotaMetric[] = [
          {
            rawMetricName: "cursor_fast_requests",
            canonicalProvider: "cursor",
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
          rawObservations: { cliOutput: parsed, command: "cursor status --json" },
        };
      } catch {
        return {
          sourceTier: "tier1_cli_command",
          metrics: [
            {
              rawMetricName: "cli_presence",
              canonicalProvider: "cursor",
              windowType: "session",
              remainingPercentage: null,
              sourceTier: "tier1_cli_command",
              confidence: "unknown",
              rawPayload: { rawOutput: statusResult.stdout.trim() },
            },
          ],
          rawObservations: { rawOutput: statusResult.stdout.trim() },
        };
      }
    }

    const verResult = await this.env.exec("cursor", ["--version"]);
    if (verResult && verResult.stdout.trim()) {
      return {
        sourceTier: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "cli_presence",
            canonicalProvider: "cursor",
            windowType: "session",
            remainingPercentage: null,
            sourceTier: "tier1_cli_command",
            confidence: "unknown",
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
      join(
        home,
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
        "storage.json",
      ),
      join(home, ".config", "Cursor", "User", "globalStorage", "storage.json"),
      join(home, ".cursor", "state.json"),
    ];

    const isExternalCache = !this.env.isHostActive("cursor");
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
                : null;
          return {
            sourceTier: "tier2_local_storage",
            metrics: [
              {
                rawMetricName: "local_cursor_storage",
                canonicalProvider: "cursor",
                windowType: "monthly",
                remainingPercentage:
                  remaining === null ? null : Math.max(0, Math.min(100, remaining)),
                sourceTier: "tier2_local_storage",
                confidence: remaining === null ? "unknown" : "inferred_metric",
                rawPayload: isExternalCache ? { ...parsed, isExternalCache: true } : parsed,
              },
            ],
            rawObservations: {
              storagePath: filePath,
              content: parsed,
            },
            reason: isExternalCache ? "[Isolated External Cache] Inactive host cache" : undefined,
          };
        } catch {
          return {
            sourceTier: "tier2_local_storage",
            metrics: [
              {
                rawMetricName: "local_storage_file",
                canonicalProvider: "cursor",
                windowType: "session",
                remainingPercentage: null,
                sourceTier: "tier2_local_storage",
                confidence: "unknown",
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
    if (env.CURSOR_DIR) detected.push("CURSOR_DIR");
    if (env.CURSOR_CHANNEL) detected.push("CURSOR_CHANNEL");
    if (env.CURSOR_API_KEY) detected.push("CURSOR_API_KEY");
    if (env.VSCODE_INJECTION) detected.push("VSCODE_INJECTION");

    if (detected.length > 0) {
      return {
        sourceTier: "tier3_runtime",
        metrics: [
          {
            rawMetricName: "runtime_environment",
            canonicalProvider: "cursor",
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
}
