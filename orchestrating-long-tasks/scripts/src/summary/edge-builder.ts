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
): GraphEdgeData {
  const totalTokens = exchanges.reduce((acc, x) => acc + (x.tokens ?? 0), 0);
  const totalBytes = exchanges.reduce((acc, x) => acc + (x.bytes ?? 0), 0);
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
            bytes: totalBytes || 520,
            durationMs: 50,
            status: isCycle ? "warning" : "success",
            payloadSnippet: detail,
          },
        ];

  const trafficDetail: EdgeTrafficDetail = {
    volume: finalExchanges.length,
    messagesCount: finalExchanges.length,
    tokens: totalTokens || 140,
    bytes: totalBytes || 520,
    ratePerSec: isHighTraffic ? 8.5 : 2.0,
    status: isCycle ? "congested" : isHighTraffic ? "active" : "idle",
    glowColor: glowColor ?? (isCycle ? "#f59e0b" : isHighTraffic ? "#06b6d4" : undefined),
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
      icon,
      clickable: Boolean(targetTab),
      ...(targetTab ? { targetTab } : {}),
    },
    container: { stepBadge: String(stepNumber), title, detail, variant, icon },
    traffic: trafficDetail,
    exchanges: finalExchanges,
    isHighTraffic: isHighTraffic || Boolean(isCycle) || finalExchanges.length > 1,
    trafficVolume: trafficDetail.volume,
  };
  if (kind !== undefined) edge.kind = kind;
  if (isCycle !== undefined) edge.isCycle = isCycle;
  return edge;
}
