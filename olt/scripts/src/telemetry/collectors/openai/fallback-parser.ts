import { join } from "node:path";
import type { TierResult } from "../../base-collector.ts";
import type { NormalizedQuotaMetric } from "../../types.ts";
import type { DefaultCollectorEnvironment } from "../common.ts";

export async function parseCliFallback(
  env: DefaultCollectorEnvironment,
  command: string,
  tokenMetricName: string,
): Promise<TierResult | null> {
  const quotaResult = await env.exec(command, ["quota", "--json"]);
  if (quotaResult) {
    if (quotaResult.stdout.trim()) {
      try {
        const parsed = JSON.parse(quotaResult.stdout) as Record<string, unknown>;
        let remaining: number | null = null;
        if (typeof parsed.remaining_percentage === "number") {
          remaining = parsed.remaining_percentage;
        } else if (typeof parsed.remainingPercentage === "number") {
          remaining = parsed.remainingPercentage;
        }
        const metrics: NormalizedQuotaMetric[] = [
          {
            rawMetricName: tokenMetricName,
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
          rawObservations: { cliOutput: parsed, command: `${command} quota --json` },
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
  }

  const verResult = await env.exec(command, ["--version"]);
  if (verResult) {
    if (verResult.stdout.trim()) {
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
  }

  return null;
}

export async function parseOpenAIStorage(
  env: DefaultCollectorEnvironment,
): Promise<TierResult | null> {
  const home = env.homedir;
  const isExternalCache = !env.isHostActive("openai");
  const candidates = [
    join(home, ".openai", "usage.json"),
    join(home, ".openai", "credentials"),
    join(home, ".config", "openai", "usage.json"),
  ];

  for (const filePath of candidates) {
    const content = await env.readFile(filePath);
    if (content) {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        let remaining: number | undefined = undefined;
        if (typeof parsed.remainingPercentage === "number") {
          remaining = parsed.remainingPercentage;
        } else if (typeof parsed.quotaRemaining === "number") {
          remaining = parsed.quotaRemaining;
        }
        if (remaining !== undefined) {
          const reason = isExternalCache ? "[Isolated External Cache] Inactive host cache" : undefined;
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
                rawPayload: isExternalCache ? { ...parsed, isExternalCache: true } : parsed,
              },
            ],
            rawObservations: {
              storagePath: filePath,
              content: parsed,
            },
            reason,
          };
        }
      } catch {}
    }
  }
  return null;
}

export async function parseCodexStorage(
  env: DefaultCollectorEnvironment,
): Promise<TierResult | null> {
  const home = env.homedir;
  const isExternalCache = !env.isHostActive("codex");
  const candidates = [
    join(home, ".codex", "auth.json"),
    join(home, ".codex", "config.toml"),
    join(home, ".codex", "usage.json"),
    join(home, ".codex", "session.json"),
    join(home, ".config", "codex", "usage.json"),
    join(home, ".openai", "usage.json"),
  ];

  for (const filePath of candidates) {
    const content = await env.readFile(filePath);
    if (content) {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        let remaining: number | undefined = undefined;
        if (typeof parsed.remainingPercentage === "number") {
          remaining = parsed.remainingPercentage;
        } else if (typeof parsed.quotaRemaining === "number") {
          remaining = parsed.quotaRemaining;
        }

        if (remaining !== undefined) {
          const reason = isExternalCache ? "[Isolated External Cache] Inactive host cache" : undefined;
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
                rawPayload: isExternalCache ? { ...parsed, isExternalCache: true } : parsed,
              },
            ],
            rawObservations: {
              storagePath: filePath,
              content: parsed,
            },
            reason,
          };
        }

        let hasAuthToken = false;
        if (parsed.tokens) hasAuthToken = true;
        if (parsed.session_token) hasAuthToken = true;
        if (parsed.auth_token) hasAuthToken = true;
        if (parsed.account) hasAuthToken = true;
        if (parsed.user_id) hasAuthToken = true;
        if (parsed.plan_type) hasAuthToken = true;

        if (hasAuthToken) {
          const reason = isExternalCache ? "[Isolated External Cache] Inactive host cache" : undefined;
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
            reason,
          };
        }
      } catch {
        let isConfigToml = false;
        if (filePath.endsWith(".toml")) {
          if (content.includes("[auth]")) isConfigToml = true;
          if (content.includes("api_key")) isConfigToml = true;
          if (content.includes("session")) isConfigToml = true;
          if (content.includes("model")) isConfigToml = true;
        }
        if (isConfigToml) {
          const reason = isExternalCache ? "[Isolated External Cache] Inactive host cache" : undefined;
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
            reason,
          };
        }
      }
    }
  }
  return null;
}

export function parseRuntimeEnv(
  env: Record<string, string | undefined>,
  targetVars: readonly string[],
): TierResult | null {
  const detected: string[] = [];
  for (const v of targetVars) {
    if (env[v]) {
      detected.push(v);
    }
  }

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
