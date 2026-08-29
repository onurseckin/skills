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

  const verResult = await env.exec(command, ["--version"]);
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

export async function parseOpenAIStorage(
  env: DefaultCollectorEnvironment,
): Promise<TierResult | null> {
  const home = env.homedir;
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
      } catch {}
    }
  }
  return null;
}

export async function parseCodexStorage(
  env: DefaultCollectorEnvironment,
): Promise<TierResult | null> {
  const home = env.homedir;
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

export function parseRuntimeEnv(
  env: Record<string, string | undefined>,
  variableNames: readonly string[],
): TierResult | null {
  const detected: string[] = [];
  for (const variableName of variableNames) {
    if (env[variableName]) {
      detected.push(variableName);
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
