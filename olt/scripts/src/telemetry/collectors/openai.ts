import { join } from "node:path";
import { BaseTieredCollector, type TierResult } from "../base-collector.ts";
import type { ConfidenceLevel, NormalizedQuotaMetric } from "../types.ts";
import { DefaultCollectorEnvironment, type CollectorEnvironment } from "./common.ts";

export class OpenAICollector extends BaseTieredCollector {
  public override readonly platformId: string = "openai";
  protected readonly env: DefaultCollectorEnvironment;

  constructor(env: CollectorEnvironment = {}) {
    super();
    this.env = new DefaultCollectorEnvironment(env);
  }

  protected async probeTier1Cli(): Promise<TierResult | null> {
    const quotaResult = await this.env.exec("openai", ["quota", "--json"]);
    if (quotaResult && quotaResult.stdout.trim()) {
      try {
        const parsed = JSON.parse(quotaResult.stdout) as Record<string, unknown>;
        const remaining =
          typeof parsed.remaining_percentage === "number"
            ? parsed.remaining_percentage
            : typeof parsed.remainingPercentage === "number"
              ? parsed.remainingPercentage
              : null;
        const metrics: NormalizedQuotaMetric[] = [
          {
            rawMetricName: "openai_tokens_remaining",
            canonicalProvider: "openai",
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
          rawObservations: { cliOutput: parsed, command: "openai quota --json" },
        };
      } catch {
        return {
          sourceTier: "tier1_cli_command",
          metrics: [
            {
              rawMetricName: "cli_presence",
              canonicalProvider: "openai",
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

    const verResult = await this.env.exec("openai", ["--version"]);
    if (verResult && verResult.stdout.trim()) {
      return {
        sourceTier: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "cli_presence",
            canonicalProvider: "openai",
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
      join(home, ".openai", "usage.json"),
      join(home, ".openai", "credentials"),
      join(home, ".config", "openai", "usage.json"),
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
                : undefined;
          if (remaining !== undefined) {
            return {
              sourceTier: "tier2_local_storage",
              metrics: [
                {
                  rawMetricName: "local_openai_usage",
                  canonicalProvider: "openai",
                  windowType: "monthly",
                  remainingPercentage: Math.max(0, Math.min(100, remaining)),
                  sourceTier: "tier2_local_storage",
                  confidence: "cached",
                  rawPayload: parsed,
                },
              ],
              rawObservations: { storagePath: filePath, content: parsed },
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
    if (env.OPENAI_API_KEY) detected.push("OPENAI_API_KEY");
    if (env.CODEX_API_KEY) detected.push("CODEX_API_KEY");
    if (env.OPENAI_ORG_ID) detected.push("OPENAI_ORG_ID");
    if (env.OPENAI_PROJECT_ID) detected.push("OPENAI_PROJECT_ID");

    if (detected.length > 0) {
      return {
        sourceTier: "tier3_runtime",
        metrics: [
          {
            rawMetricName: "runtime_environment",
            canonicalProvider: "openai",
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
    return "No Codex Sessions · No API Key";
  }
}

export class CodexCollector extends BaseTieredCollector {
  public override readonly platformId: string = "codex";
  private readonly env: DefaultCollectorEnvironment;

  constructor(env: CollectorEnvironment = {}) {
    super();
    this.env = new DefaultCollectorEnvironment(env);
  }

  protected async probeTier1Cli(): Promise<TierResult | null> {
    // 1. Live Rollout Token Count & Quota Discovery
    const codexUsage = await this.env.fetchCodexUsage();
    if (codexUsage) {
      const root = codexUsage as Record<string, unknown>;
      const payload = (root.payload ?? root) as Record<string, unknown>;
      const rateLimits = (payload.rate_limits ?? root.rate_limits ?? payload) as Record<
        string,
        unknown
      >;
      const info = (payload.info ?? root.info) as Record<string, unknown> | undefined;
      const totalTokenUsage = info?.total_token_usage;
      const modelContextWindow = info?.model_context_window;
      const planType = (rateLimits?.plan_type ??
        payload.plan_type ??
        root.plan_type ??
        "unknown") as string;

      const primary = (rateLimits?.primary ?? rateLimits) as Record<string, unknown> | undefined;
      const usedPercent =
        typeof primary?.used_percent === "number"
          ? primary.used_percent
          : typeof primary?.usedPercent === "number"
            ? primary.usedPercent
            : typeof primary?.utilization === "number"
              ? primary.utilization
              : undefined;

      const windowMinutes =
        typeof primary?.window_minutes === "number"
          ? primary.window_minutes
          : typeof primary?.windowMinutes === "number"
            ? primary.windowMinutes
            : undefined;

      const resetsAtRaw = primary?.resets_at ?? primary?.resetsAt ?? primary?.resetTime;
      const resetsAtSec =
        typeof resetsAtRaw === "number"
          ? resetsAtRaw
          : typeof resetsAtRaw === "string"
            ? isNaN(Number(resetsAtRaw))
              ? Math.floor(new Date(resetsAtRaw).getTime() / 1000)
              : Number(resetsAtRaw)
            : undefined;

      const resetTimeIso =
        resetsAtSec !== undefined
          ? new Date(resetsAtSec * 1000).toISOString()
          : typeof resetsAtRaw === "string"
            ? resetsAtRaw
            : undefined;

      if (usedPercent !== undefined) {
        // Time-aware quota decay calculation
        const nowSec = Date.now() / 1000;
        let remainingPercentage: number;
        if (resetsAtSec !== undefined && nowSec >= resetsAtSec) {
          remainingPercentage = 100.0;
        } else {
          remainingPercentage = Math.max(
            0,
            Math.min(100, Math.round((100 - usedPercent) * 100) / 100),
          );
        }

        // Window detection
        const windowType =
          windowMinutes === 300 ? "5_hour" : windowMinutes === 10080 ? "weekly" : "session";

        const rawMetricName =
          windowMinutes === 10080 ? "Codex (7-Day Limit)" : `OpenAI Codex (${windowType})`;

        const metrics: NormalizedQuotaMetric[] = [
          {
            rawMetricName,
            canonicalProvider: "openai",
            windowType,
            remainingPercentage,
            sourceTier: "tier1_cli_command",
            confidence: "verified_exact",
            rawPayload: {
              ...(primary ?? {}),
              used_percent: usedPercent,
              window_minutes: windowMinutes,
              resets_at: resetsAtSec,
              resetTime: resetTimeIso,
              plan_type: planType,
              planType,
              total_token_usage: totalTokenUsage,
              model_context_window: modelContextWindow,
            },
          },
        ];

        return {
          sourceTier: "tier1_cli_command",
          metrics,
          rawObservations: {
            plan_type: planType,
            planType,
            total_token_usage: totalTokenUsage,
            resets_at: resetsAtSec,
            resetTime: resetTimeIso,
            model_context_window: modelContextWindow,
            rate_limits: rateLimits,
            info,
            rawPayload: root,
          },
        };
      }
    }

    // 2. Fallback CLI exec
    const quotaResult = await this.env.exec("codex", ["quota", "--json"]);
    if (quotaResult && quotaResult.stdout.trim()) {
      try {
        const parsed = JSON.parse(quotaResult.stdout) as Record<string, unknown>;
        const remaining =
          typeof parsed.remaining_percentage === "number"
            ? parsed.remaining_percentage
            : typeof parsed.remainingPercentage === "number"
              ? parsed.remainingPercentage
              : null;
        const metrics: NormalizedQuotaMetric[] = [
          {
            rawMetricName: "codex_tokens_remaining",
            canonicalProvider: "openai",
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
          rawObservations: { cliOutput: parsed, command: "codex quota --json" },
        };
      } catch {
        return {
          sourceTier: "tier1_cli_command",
          metrics: [
            {
              rawMetricName: "cli_presence",
              canonicalProvider: "openai",
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

    const verResult = await this.env.exec("codex", ["--version"]);
    if (verResult && verResult.stdout.trim()) {
      return {
        sourceTier: "tier1_cli_command",
        metrics: [
          {
            rawMetricName: "cli_presence",
            canonicalProvider: "openai",
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
      join(home, ".codex", "auth.json"),
      join(home, ".codex", "config.toml"),
      join(home, ".codex", "usage.json"),
      join(home, ".codex", "session.json"),
      join(home, ".config", "codex", "usage.json"),
      join(home, ".openai", "usage.json"),
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
                : undefined;

          if (remaining !== undefined) {
            return {
              sourceTier: "tier2_local_storage",
              metrics: [
                {
                  rawMetricName: "local_codex_usage",
                  canonicalProvider: "openai",
                  windowType: "monthly",
                  remainingPercentage: Math.max(0, Math.min(100, remaining)),
                  sourceTier: "tier2_local_storage",
                  confidence: "cached",
                  rawPayload: parsed,
                },
              ],
              rawObservations: { storagePath: filePath, content: parsed },
            };
          }

          if (
            parsed.tokens ||
            parsed.session_token ||
            parsed.auth_token ||
            parsed.account ||
            parsed.user_id ||
            parsed.plan_type
          ) {
            return {
              sourceTier: "tier2_local_storage",
              metrics: [
                {
                  rawMetricName: "cached_codex_auth",
                  canonicalProvider: "openai",
                  windowType: "session",
                  remainingPercentage: null,
                  sourceTier: "tier2_local_storage",
                  confidence: "unknown",
                  rawPayload: parsed,
                },
              ],
              rawObservations: { storagePath: filePath, content: parsed },
            };
          }
        } catch {
          // If it's a TOML or text config file (like config.toml)
          if (
            filePath.endsWith(".toml") &&
            (content.includes("[auth]") ||
              content.includes("api_key") ||
              content.includes("session") ||
              content.includes("model"))
          ) {
            return {
              sourceTier: "tier2_local_storage",
              metrics: [
                {
                  rawMetricName: "cached_codex_config",
                  canonicalProvider: "openai",
                  windowType: "session",
                  remainingPercentage: null,
                  sourceTier: "tier2_local_storage",
                  confidence: "unknown",
                  rawPayload: { rawConfig: content },
                },
              ],
              rawObservations: { storagePath: filePath, rawConfig: content },
            };
          }
        }
      }
    }
    return null;
  }

  protected async probeTier3Runtime(): Promise<TierResult | null> {
    const env = this.env.env;
    const detected: string[] = [];
    if (env.OPENAI_API_KEY) detected.push("OPENAI_API_KEY");
    if (env.CODEX_API_KEY) detected.push("CODEX_API_KEY");
    if (env.CODEX_SESSION_ID) detected.push("CODEX_SESSION_ID");

    if (detected.length > 0) {
      return {
        sourceTier: "tier3_runtime",
        metrics: [
          {
            rawMetricName: "runtime_environment",
            canonicalProvider: "openai",
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
    return "No Codex Sessions · No API Key";
  }
}
