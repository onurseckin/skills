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

      const userStatus =
        typeof statusPayload.userStatus === "object" && statusPayload.userStatus !== null
          ? (statusPayload.userStatus as Record<string, unknown>)
          : statusPayload;

      const cascadeData =
        typeof userStatus.cascadeModelConfigData === "object" &&
        userStatus.cascadeModelConfigData !== null
          ? (userStatus.cascadeModelConfigData as Record<string, unknown>)
          : undefined;

      const rawModels =
        cascadeData?.clientModelConfigs ?? userStatus.models ?? userStatus.clientModelConfigs;
      const models = Array.isArray(rawModels) ? (rawModels as Array<Record<string, unknown>>) : [];
      const metrics: NormalizedQuotaMetric[] = [];

      const quotaInfo =
        typeof userStatus.quotaInfo === "object" && userStatus.quotaInfo !== null
          ? (userStatus.quotaInfo as Record<string, unknown>)
          : undefined;
      if (typeof quotaInfo?.remainingFraction === "number") {
        metrics.push({
          rawMetricName: "overall_5_hour_quota",
          canonicalProvider: "google",
          windowType: "5_hour",
          remainingPercentage: Math.max(
            0,
            Math.min(100, Math.round((quotaInfo.remainingFraction as number) * 10000) / 100),
          ),
          sourceTier: "tier1_cli_command",
          confidence: "verified_exact",
          rawPayload: quotaInfo,
        });
      }

      for (const model of models) {
        const label =
          typeof model.label === "string"
            ? model.label
            : typeof model.name === "string"
              ? model.name
              : typeof model.modelId === "string"
                ? model.modelId
                : "unknown_model";
        const canonicalProvider = label.toLowerCase().includes("claude")
          ? "anthropic"
          : label.toLowerCase().includes("gpt")
            ? "openai"
            : "google";
        const mQuota =
          typeof model.quotaInfo === "object" && model.quotaInfo !== null
            ? (model.quotaInfo as Record<string, unknown>)
            : undefined;
        const hasFraction = typeof mQuota?.remainingFraction === "number";
        const remainingPercentage = hasFraction
          ? Math.max(
              0,
              Math.min(100, Math.round((mQuota!.remainingFraction as number) * 10000) / 100),
            )
          : null;

        metrics.push({
          rawMetricName: label,
          canonicalProvider,
          windowType: "5_hour",
          remainingPercentage,
          sourceTier: "tier1_cli_command",
          confidence: hasFraction ? "verified_exact" : "unknown",
          rawPayload: model,
        });
      }

      if (metrics.length > 0) {
        const userTier =
          typeof userStatus.userTier === "object" && userStatus.userTier !== null
            ? (userStatus.userTier as Record<string, unknown>)
            : undefined;
        const planStatus =
          typeof userStatus.planStatus === "object" && userStatus.planStatus !== null
            ? (userStatus.planStatus as Record<string, unknown>)
            : undefined;
        const planInfo =
          typeof planStatus?.planInfo === "object" && planStatus.planInfo !== null
            ? (planStatus.planInfo as Record<string, unknown>)
            : undefined;
        const plan =
          typeof planInfo?.planName === "string"
            ? planInfo.planName
            : typeof planStatus?.planName === "string"
              ? planStatus.planName
              : typeof userStatus.plan === "string"
                ? userStatus.plan
                : undefined;
        const activeModel = this.env.activeModel;

        const rawObservations: Record<string, unknown> = {
          userStatus: statusPayload,
          userTier: userStatus.userTier,
          availableCredits: userTier?.availableCredits,
          plan,
          name: activeModel ?? (typeof plan === "string" ? plan : undefined),
          email: userStatus.email,
          activePort: port,
          queriedAt: new Date().toISOString(),
        };

        const enrichedMetrics = activeModel
          ? metrics.map((m) => {
              const matches =
                m.rawMetricName.toLowerCase().includes(activeModel.toLowerCase()) ||
                (typeof (m.rawPayload as { modelId?: string }).modelId === "string" &&
                  (m.rawPayload as { modelId: string }).modelId
                    .toLowerCase()
                    .includes(activeModel.toLowerCase()));
              return matches ? { ...m, rawPayload: { ...m.rawPayload, name: activeModel } } : m;
            })
          : metrics;

        return { sourceTier: "tier1_cli_command", metrics: enrichedMetrics, rawObservations };
      }
    }

    const quotaResult = await this.env.exec("agy", ["quota", "--json"]);
    if (quotaResult?.stdout?.trim()) {
      try {
        const parsed = JSON.parse(quotaResult.stdout) as Record<string, unknown>;
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
      join(home, ".gemini", "antigravity-cli", "state.json"),
      join(home, ".gemini", "antigravity-cli", "quota.json"),
      join(home, ".gemini", "state.json"),
      join(home, ".gemini", "quota.json"),
      join(home, ".config", "antigravity", "state.json"),
      join(home, ".config", "antigravity", "quota.json"),
    ];

    const isExternalCache = !this.env.isHostActive("antigravity");
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
                : typeof (parsed.quotaInfo as Record<string, unknown> | undefined)
                      ?.remainingFraction === "number"
                  ? ((parsed.quotaInfo as Record<string, unknown>).remainingFraction as number) *
                    100
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
    const detected: string[] = [];
    if (env.GEMINI_API_KEY) detected.push("GEMINI_API_KEY");
    if (env.GOOGLE_API_KEY) detected.push("GOOGLE_API_KEY");
    if (env.ANTIGRAVITY_APP_DIR) detected.push("ANTIGRAVITY_APP_DIR");
    if (env.ANTIGRAVITY_CLI_VERSION) detected.push("ANTIGRAVITY_CLI_VERSION");

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
