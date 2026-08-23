import type {
  ClippingViolation,
  OverflowViolation,
  StackingViolation,
  ViewportMetrics,
  VisualMetricsReport,
} from "./screenshot-types.ts";

export function normalizeVisualReport(
  parsed: unknown,
  fallbackTimestamp: string | undefined,
): VisualMetricsReport | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  const timestamp = typeof value.timestamp === "string" ? value.timestamp : fallbackTimestamp;
  const viewports =
    typeof value.viewports === "object" &&
    value.viewports !== null &&
    !Array.isArray(value.viewports)
      ? (value.viewports as Record<string, ViewportMetrics>)
      : {};
  return {
    ...(timestamp === undefined ? {} : { timestamp }),
    viewports,
    layoutOverflows: Array.isArray(value.layoutOverflows)
      ? (value.layoutOverflows as OverflowViolation[])
      : [],
    textClippings: Array.isArray(value.textClippings)
      ? (value.textClippings as ClippingViolation[])
      : [],
    collisions: Array.isArray(value.collisions) ? (value.collisions as StackingViolation[]) : [],
    ...(typeof value.metadata === "object" &&
    value.metadata !== null &&
    !Array.isArray(value.metadata)
      ? { metadata: value.metadata as Record<string, unknown> }
      : {}),
  };
}
