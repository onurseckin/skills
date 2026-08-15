import type { EdgeTrafficDetail, EdgeTrafficExchange, GraphEdgeData } from "./types.ts";

export function createEdge(
  id: string,
  source: string,
  target: string,
  kind: GraphEdgeData["kind"],
  stepNumber: number | string,
  title: string,
  detail: string,
  variant: "info" | "warning" | "error" | "success" | "neutral" | "cyan",
  icon: string,
  isCycle?: boolean,
  targetTab?: string,
  exchanges: EdgeTrafficExchange[] = [],
  isHighTraffic = false,
  glowColor?: string,
  glowIntensity?: number,
  trafficOptions?: {
    latencyMs?: number;
    tokensIn?: number;
    tokensOut?: number;
    status?: "nominal" | "high" | "congested" | "active" | "idle" | "error" | string;
  },
): GraphEdgeData {
  const totalTokens = exchanges.reduce(
    (acc, x) => acc + (x.tokens ?? ((x.tokensIn ?? 0) + (x.tokensOut ?? 0))),
    0,
  );
  const totalTokensIn =
    trafficOptions?.tokensIn ??
    exchanges.reduce((acc, x) => acc + (x.tokensIn ?? 0), 0);
  const totalTokensOut =
    trafficOptions?.tokensOut ??
    exchanges.reduce((acc, x) => acc + (x.tokensOut ?? 0), 0);
  const totalBytes = exchanges.reduce((acc, x) => acc + (x.bytes ?? 0), 0);
  const totalLatencyMs =
    trafficOptions?.latencyMs ??
    (exchanges.length > 0
      ? exchanges.reduce((acc, x) => acc + (x.durationMs ?? 0), 0)
      : 50);

  const finalExchanges =
    exchanges.length > 0
      ? exchanges
      : [
          {
            id: `exch-${id}-01`,
            timestamp: new Date().toISOString(),
            source,
            target,
            kind:
              kind === "spawn"
                ? "prompt"
                : kind === "sequence"
                  ? "file"
                  : kind === "loop"
                    ? "decision"
                    : "artifact",
            summary: title,
            tokens: totalTokens || 140,
            tokensIn: totalTokensIn || (kind === "spawn" ? 100 : 40),
            tokensOut: totalTokensOut || (kind === "spawn" ? 40 : 100),
            bytes: totalBytes || 520,
            durationMs: totalLatencyMs,
            status: isCycle ? "warning" : "success",
            payloadSnippet: detail,
          },
        ];

  const resolvedGlowColor =
    glowColor ??
    (isCycle
      ? "#f43f5e"
      : isHighTraffic
        ? "#06b6d4"
        : kind === "spawn"
          ? "#3b82f6"
          : kind === "join" || kind === "critic"
            ? "#10b981"
            : undefined);

  const resolvedStatus =
    trafficOptions?.status ??
    (isCycle
      ? "congested"
      : isHighTraffic
        ? "high"
        : "nominal");

  const trafficDetail: EdgeTrafficDetail = {
    volume: finalExchanges.length,
    messagesCount: finalExchanges.length,
    tokens: totalTokens || 140,
    tokensIn: totalTokensIn || (totalTokens ? Math.round(totalTokens * 0.35) : 50),
    tokensOut: totalTokensOut || (totalTokens ? Math.round(totalTokens * 0.65) : 90),
    latencyMs: totalLatencyMs,
    bytes: totalBytes || 520,
    ratePerSec: isHighTraffic ? 8.5 : 2.0,
    status: resolvedStatus,
    ...(resolvedGlowColor !== undefined ? { glowColor: resolvedGlowColor } : {}),
    glowIntensity: glowIntensity ?? (isCycle ? 0.85 : isHighTraffic ? 0.75 : 0.35),
    exchanges: finalExchanges,
  };

  const edge: GraphEdgeData = {
    id,
    source,
    target,
    stepNumber,
    badge: {
      text: title,
      variant: variant === "cyan" ? "info" : variant,
      ...(icon ? { icon } : {}),
      clickable: Boolean(targetTab),
      ...(targetTab ? { targetTab } : {}),
    },
    container: {
      stepBadge: String(stepNumber),
      title,
      variant,
      ...(icon ? { icon } : {}),
      ...(detail ? { detail } : {}),
    },
    traffic: trafficDetail,
    exchanges: finalExchanges,
    isHighTraffic: isHighTraffic || Boolean(isCycle) || finalExchanges.length > 1,
    ...(trafficDetail.volume !== undefined ? { trafficVolume: trafficDetail.volume } : {}),
  };
  if (kind !== undefined) edge.kind = kind;
  if (isCycle !== undefined) edge.isCycle = isCycle;
  return edge;
}
