import type {
  ScreenshotMetadata,
  ViewportMetrics,
  VisualMetricsReport,
} from "./dual-channel-types.ts";

export function normalizeViewportName(name?: string, width?: number): string {
  if (typeof width === "number" && !isNaN(width) && width > 0) {
    if (width <= 480) return "mobile";
    if (width <= 900) return "tablet";
    if (width <= 1920) return "desktop";
    return "ultrawide";
  }
  if (typeof name === "string" && name.trim().length > 0) {
    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();
    if (lower.includes("mobile") || lower.includes("375")) return "mobile";
    if (lower.includes("tablet") || lower.includes("768")) return "tablet";
    if (lower.includes("desktop") || lower.includes("1280")) return "desktop";
    return lower;
  }
  return "unknown";
}

function dimensionText(width?: number, height?: number): string {
  if (typeof width !== "number" || typeof height !== "number") return "dimensions unknown";
  return `${width}x${height}`;
}

export function validateCrossChannelConsistency(
  domReport: VisualMetricsReport,
  screenshots: ScreenshotMetadata[],
): { consistent: boolean; discrepancies: string[] } {
  const discrepancies: string[] = [];

  const domViewports = new Map<string, ViewportMetrics>();
  for (const vp of domReport.viewports) {
    const norm = normalizeViewportName(vp.viewport, vp.width);
    domViewports.set(norm, vp);
  }

  const screenshotViewports = new Map<string, ScreenshotMetadata>();
  for (const sc of screenshots) {
    const norm = normalizeViewportName(sc.viewport ?? sc.name, sc.width);
    screenshotViewports.set(norm, sc);
  }

  for (const [name, vp] of domViewports) {
    const sc = screenshotViewports.get(name);
    if (!sc) {
      discrepancies.push(
        `DOM metrics report defines viewport '${name}' (${dimensionText(vp.width, vp.height)}) but no matching screenshot was captured`,
      );
      continue;
    }
    if (
      typeof sc.width !== "number" ||
      typeof sc.height !== "number" ||
      typeof vp.width !== "number" ||
      typeof vp.height !== "number"
    ) {
      continue;
    }
    if (
      isNaN(sc.width) ||
      isNaN(sc.height) ||
      sc.width <= 0 ||
      sc.height <= 0 ||
      isNaN(vp.width) ||
      isNaN(vp.height) ||
      vp.width <= 0 ||
      vp.height <= 0
    ) {
      discrepancies.push(
        `Malformed dimension detected for viewport '${name}': DOM report is ${vp.width}x${vp.height} while screenshot is ${sc.width}x${sc.height}`,
      );
    } else if (sc.width !== vp.width || sc.height !== vp.height) {
      discrepancies.push(
        `Dimension mismatch for viewport '${name}': DOM report is ${vp.width}x${vp.height} while screenshot is ${sc.width}x${sc.height}`,
      );
    }
  }

  for (const [name] of screenshotViewports) {
    if (!domViewports.has(name)) {
      discrepancies.push(
        `Screenshot captured for viewport '${name}' but DOM metrics report lacks corresponding viewport metrics`,
      );
    }
  }

  return {
    consistent: discrepancies.length === 0,
    discrepancies,
  };
}
