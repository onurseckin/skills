import type {
  ClippingViolation,
  OverflowViolation,
  StackingViolation,
  ViewportMetrics,
  VisualMetricsReport,
} from "./screenshot-types.ts";

function extractViewports(value: Record<string, unknown>): Record<string, ViewportMetrics> {
  const result: Record<string, ViewportMetrics> = {};
  if (Array.isArray(value.viewports)) {
    for (let i = 0; i < value.viewports.length; i++) {
      const item = value.viewports[i];
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const vp = item as Record<string, unknown>;
        const name =
          typeof vp.name === "string" && vp.name.length > 0
            ? vp.name
            : typeof vp.viewport === "string" && vp.viewport.length > 0
              ? vp.viewport
              : `viewport-${i + 1}`;
        const width = typeof vp.width === "number" && Number.isFinite(vp.width) ? vp.width : 0;
        const height = typeof vp.height === "number" && Number.isFinite(vp.height) ? vp.height : 0;
        if (width > 0 && height > 0) {
          result[name] = { width, height };
        }
      }
    }
    return result;
  }
  if (typeof value.viewports === "object" && value.viewports !== null) {
    for (const [key, val] of Object.entries(value.viewports as Record<string, unknown>)) {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        const vp = val as Record<string, unknown>;
        const width = typeof vp.width === "number" && Number.isFinite(vp.width) ? vp.width : 0;
        const height = typeof vp.height === "number" && Number.isFinite(vp.height) ? vp.height : 0;
        if (width > 0 && height > 0) {
          result[key] = { width, height };
        }
      }
    }
  }
  return result;
}

export function normalizeVisualReport(
  parsed: unknown,
  fallbackTimestamp: string | undefined,
): VisualMetricsReport | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  const timestamp = typeof value.timestamp === "string" ? value.timestamp : fallbackTimestamp;
  const viewports = extractViewports(value);
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
