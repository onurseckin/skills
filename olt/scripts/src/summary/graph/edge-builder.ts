import type {
  EdgeExchange,
  EdgeKind,
  EdgeTrafficDetail,
  EdgeVariant,
  GraphEdgeData,
} from "./graph-types.ts";

const ACCENT_BY_KIND: Partial<Record<EdgeKind, string>> = {
  backtrack: "#f97316",
  branch: "#a855f7",
  collect: "#a855f7",
  critic: "#f43f5e",
  dependency: "#06b6d4",
  dispatch: "#3b82f6",
  gate: "#8b5cf6",
  handoff: "#8b5cf6",
  join: "#10b981",
  probe: "#22d3ee",
  pushback: "#f43f5e",
  sequence: "#64748b",
  signoff: "#10b981",
  spawn: "#3b82f6",
  validation: "#8b5cf6",
};

export interface ObservedTraffic {
  bytes?: number | undefined;
  durationMs?: number | undefined;
  messagesCount?: number | undefined;
}

export interface EdgeSpec {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  title: string;
  detail?: string | undefined;
  variant: EdgeVariant;
  icon?: string | undefined;
  stepNumber?: number | string | undefined;
  isCycle?: boolean | undefined;
  targetTab?: string | undefined;
  exchanges?: EdgeExchange[] | undefined;
  observed?: ObservedTraffic | undefined;
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length > 0 ? present.reduce((total, value) => total + value, 0) : undefined;
}

function buildTraffic(
  exchanges: readonly EdgeExchange[],
  observed: ObservedTraffic | undefined,
): EdgeTrafficDetail | undefined {
  const bytes = observed?.bytes ?? sumDefined(exchanges.map((exchange) => exchange.bytes));
  const durationMs =
    observed?.durationMs ?? sumDefined(exchanges.map((exchange) => exchange.durationMs));
  const messagesCount =
    observed?.messagesCount ?? (exchanges.length > 0 ? exchanges.length : undefined);

  if (bytes === undefined && durationMs === undefined && messagesCount === undefined) {
    return undefined;
  }
  return {
    evidence_class: "harness_observed",
    ...(messagesCount !== undefined ? { messagesCount } : {}),
    ...(bytes !== undefined ? { bytes } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

export function createEdge(spec: EdgeSpec): GraphEdgeData {
  const exchanges = spec.exchanges ?? [];
  const traffic = buildTraffic(exchanges, spec.observed);
  const accent = ACCENT_BY_KIND[spec.kind];

  const edge: GraphEdgeData = {
    id: spec.id,
    source: spec.source,
    target: spec.target,
    kind: spec.kind,
    label: spec.title,
    directed: true,
    ...(spec.stepNumber !== undefined ? { stepNumber: spec.stepNumber } : {}),
    badge: {
      text: spec.title,
      variant: spec.variant === "cyan" ? "info" : spec.variant,
      ...(spec.icon ? { icon: spec.icon } : {}),
      clickable: Boolean(spec.targetTab),
      ...(spec.targetTab ? { targetTab: spec.targetTab } : {}),
    },
    container: {
      stepBadge: spec.stepNumber === undefined ? "" : String(spec.stepNumber),
      title: spec.title,
      variant: spec.variant,
      ...(spec.icon ? { icon: spec.icon } : {}),
      ...(spec.detail ? { detail: spec.detail } : {}),
    },
    ...(accent !== undefined ? { accent } : {}),
    ...(traffic !== undefined ? { traffic } : {}),
    ...(exchanges.length > 0 ? { exchanges } : {}),
  };
  if (spec.isCycle !== undefined) edge.isCycle = spec.isCycle;
  return edge;
}
