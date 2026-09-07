import type { NormalizedQuotaMetric } from "../index.ts";

export function extractTier1Metrics(
  statusPayload: Record<string, unknown>,
  activeModel: string | undefined,
  port: string,
): {
  sourceTier: "tier1_cli_command";
  metrics: NormalizedQuotaMetric[];
  rawObservations: Record<string, unknown>;
} | null {
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
  if (quotaInfo) {
    const fraction =
      typeof quotaInfo.remainingFraction === "number" ? quotaInfo.remainingFraction : 0.0;
    metrics.push({
      rawMetricName: "overall_5_hour_quota",
      canonicalProvider: "google",
      windowType: "5_hour",
      remainingPercentage: Math.max(0, Math.min(100, Math.round(fraction * 10000) / 100)),
      sourceTier: "tier1_cli_command",
      confidence: "verified_exact",
      rawPayload: quotaInfo,
    });
  }

  for (const model of models) {
    const label =
      [model.label, model.name, model.modelId].find((v): v is string => typeof v === "string") ??
      "unknown_model";
    const lower = label.toLowerCase();
    const canonicalProvider = lower.includes("claude")
      ? "anthropic"
      : lower.includes("gpt")
        ? "openai"
        : "google";
    const mQuota =
      typeof model.quotaInfo === "object" && model.quotaInfo !== null
        ? (model.quotaInfo as Record<string, unknown>)
        : undefined;
    const hasFraction = typeof mQuota?.remainingFraction === "number";
    const isProto3Zero = mQuota !== undefined && !hasFraction;
    const remainingPercentage = hasFraction
      ? Math.max(0, Math.min(100, Math.round((mQuota!.remainingFraction as number) * 10000) / 100))
      : isProto3Zero
        ? 0.0
        : null;

    metrics.push({
      rawMetricName: label,
      canonicalProvider,
      windowType: "5_hour",
      remainingPercentage,
      sourceTier: "tier1_cli_command",
      confidence: hasFraction || isProto3Zero ? "verified_exact" : "unknown",
      rawPayload: model,
    });
  }

  if (metrics.length === 0) return null;

  const userTier =
    typeof userStatus.userTier === "object" && userStatus.userTier !== null
      ? (userStatus.userTier as Record<string, unknown>)
      : undefined;
  const ps =
    typeof userStatus.planStatus === "object" && userStatus.planStatus !== null
      ? (userStatus.planStatus as Record<string, unknown>)
      : undefined;
  const pi =
    typeof ps?.planInfo === "object" && ps.planInfo !== null
      ? (ps.planInfo as Record<string, unknown>)
      : undefined;
  const plan =
    (typeof pi?.planName === "string" ? pi.planName : undefined) ??
    (typeof ps?.planName === "string" ? ps.planName : undefined) ??
    (typeof userStatus.plan === "string" ? userStatus.plan : undefined);

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
        const p = m.rawPayload as { modelId?: string } | undefined;
        const matches =
          m.rawMetricName.toLowerCase().includes(activeModel.toLowerCase()) ||
          (typeof p?.modelId === "string" &&
            p.modelId.toLowerCase().includes(activeModel.toLowerCase()));
        return matches ? { ...m, rawPayload: { ...m.rawPayload, name: activeModel } } : m;
      })
    : metrics;

  return { sourceTier: "tier1_cli_command", metrics: enrichedMetrics, rawObservations };
}
