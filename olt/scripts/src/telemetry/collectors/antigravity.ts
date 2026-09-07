import { join } from "node:path";
import { BaseTieredCollector, type TierResult } from "../base-collector.ts";
import { DefaultCollectorEnvironment, type CollectorEnvironment } from "./common.ts";
import { extractTier1Metrics } from "./antigravity-helpers.ts";

export class AntigravityCollector extends BaseTieredCollector {
  public readonly platformId = "antigravity";
  private readonly env: DefaultCollectorEnvironment;

  constructor(env: CollectorEnvironment = {}) {
    super();
    this.env = new DefaultCollectorEnvironment(env);
  }

  protected async probeTier1Cli(): Promise<TierResult | null> {
    const lsof = await this.env.exec("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n"]);
    const ports: string[] = [];
    if (lsof?.stdout) {
      for (const line of lsof.stdout.split("\n")) {
        if (/agy/i.test(line) && /LISTEN/i.test(line)) {
          const match = line.match(/127\.0\.0\.1:(\d+)/);
          if (match?.[1] && !ports.includes(match[1])) ports.push(match[1]);
        }
      }
    }

    const targetPorts =
      ports.length > 0 ? ports : this.env.hasFetchUserStatusOverride ? ["custom_override"] : [];
    for (const port of targetPorts) {
      const statusPayload = await this.env.fetchUserStatus(port);
      if (!statusPayload) continue;

      const result = extractTier1Metrics(
        statusPayload as Record<string, unknown>,
        this.env.activeModel,
        port,
      );
      if (result) return result;
    }

    const quotaResult = await this.env.exec("agy", ["quota", "--json"]);
    if (quotaResult?.stdout?.trim()) {
      try {
        const parsed = JSON.parse(quotaResult.stdout) as Record<string, unknown>;
        const rawFrac = parsed.remainingFraction;
        const remVal =
          typeof rawFrac === "number"
            ? rawFrac * 100
            : (parsed.remaining_percentage ?? parsed.remainingPercentage);
        const remaining = typeof remVal === "number" ? remVal : 0.0;
        return {
          sourceTier: "tier1_cli_command",
          metrics: [
            {
              rawMetricName: "gemini_requests_per_minute",
              canonicalProvider: "google",
              windowType: "minute",
              remainingPercentage:
                remaining === null ? null : Math.max(0, Math.min(100, remaining)),
              sourceTier: "tier1_cli_command",
              confidence: remaining === null ? "unknown" : "verified_exact",
              rawPayload: parsed,
            },
          ],
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
              remainingPercentage: null,
              sourceTier: "tier1_cli_command",
              confidence: "unknown",
              rawPayload: { rawOutput: quotaResult.stdout.trim() },
            },
          ],
          rawObservations: { rawOutput: quotaResult.stdout.trim() },
        };
      }
    }

    const verResult = await this.env.exec("agy", ["--version"]);
    if (verResult?.stdout?.trim()) {
      return {
        sourceTier: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "cli_presence",
            canonicalProvider: "google",
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
      ".gemini/antigravity-cli/state.json",
      ".gemini/antigravity-cli/quota.json",
      ".gemini/state.json",
      ".gemini/quota.json",
      ".config/antigravity/state.json",
      ".config/antigravity/quota.json",
    ].map((p) => join(home, p));

    const isExternalCache = !this.env.isHostActive("antigravity");
    for (const filePath of candidates) {
      const content = await this.env.readFile(filePath);
      if (content) {
        try {
          const parsed = JSON.parse(content) as Record<string, unknown>;
          const lq =
            typeof parsed.quotaInfo === "object" && parsed.quotaInfo !== null
              ? (parsed.quotaInfo as Record<string, unknown>)
              : undefined;
          const remaining =
            typeof parsed.remainingPercentage === "number"
              ? parsed.remainingPercentage
              : typeof parsed.quotaRemaining === "number"
                ? parsed.quotaRemaining
                : typeof lq?.remainingFraction === "number"
                  ? (lq.remainingFraction as number) * 100
                  : lq !== undefined
                    ? 0.0
                    : undefined;

          if (remaining !== undefined) {
            return {
              sourceTier: "tier2_local_storage",
              metrics: [
                {
                  rawMetricName: "local_state_quota",
                  canonicalProvider: "google",
                  windowType: "daily",
                  remainingPercentage: Math.max(
                    0,
                    Math.min(100, Math.round(remaining * 100) / 100),
                  ),
                  sourceTier: "tier2_local_storage",
                  confidence: "cached",
                  rawPayload: isExternalCache ? { ...parsed, isExternalCache: true } : parsed,
                },
              ],
              rawObservations: {
                storagePath: filePath,
                content: parsed,
                ...(isExternalCache ? { isExternalCache: true, isolatedFromActiveHost: true } : {}),
              },
            };
          }
        } catch {}
      }
    }
    return null;
  }

  protected async probeTier3Runtime(): Promise<TierResult | null> {
    const env = this.env.env;
    const keys = [
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "ANTIGRAVITY_APP_DIR",
      "ANTIGRAVITY_CLI_VERSION",
    ];
    const detected = keys.filter((k) => Boolean(env[k]));

    if (detected.length > 0) {
      return {
        sourceTier: "tier3_runtime",
        metrics: [
          {
            rawMetricName: "runtime_environment",
            canonicalProvider: "google",
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

  protected override getTerminalReason(): string {
    return "Daemon Offline · No Quota in Storage";
  }
}
