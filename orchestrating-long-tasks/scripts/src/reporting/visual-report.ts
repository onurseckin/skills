import type {
  ClippingViolation,
  OverflowViolation,
  StackingViolation,
  ViewportMetrics,
  VisualMetricsReport,
} from "./screenshot-types.ts";

/**
 * Reads a captured visual report. One reader for both the ingestion and the query side, so what a
 * report is taken to say cannot depend on which of them happened to open the file.
 *
 * `fallbackTimestamp` is the file's own mtime. It is used only when the report carries no timestamp
 * of its own: the moment something read the file is not the moment the report was produced.
 */
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
