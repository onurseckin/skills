import type { CaptureRecord } from "../store/captures.ts";
import type {
  ClippingViolation as IngestedClippingViolation,
  OverflowViolation as IngestedOverflowViolation,
  StackingViolation as IngestedStackingViolation,
  VisualMetricsReport as IngestedVisualReport,
} from "../reporting/screenshot-types.ts";
import type {
  ClippingViolation,
  OverflowViolation,
  ScreenshotMetadata,
  StackingViolation,
  ViewportMetrics,
  VisualMetricsReport,
} from "./dual-channel-analyzer.ts";

const UNSPECIFIED_VIEWPORT = "unspecified";

function bucketKey(viewport: string | undefined, known: ReadonlySet<string>): string {
  return viewport !== undefined && known.has(viewport) ? viewport : UNSPECIFIED_VIEWPORT;
}

function groupByViewport<T extends { viewport?: string | undefined }>(
  items: readonly T[],
  known: ReadonlySet<string>,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = bucketKey(item.viewport, known);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
}

function adaptOverflow(ov: IngestedOverflowViolation, viewport: string): OverflowViolation {
  const selector = ov.selector ?? ov.element;
  return {
    elementId: ov.element,
    selector,
    viewport,
    scrollWidth: ov.scrollWidth,
    clientWidth: ov.clientWidth,
    overflowX: ov.delta,
    message: `Horizontal layout overflow on '${selector}': scrollWidth (${ov.scrollWidth}px) > clientWidth (${ov.clientWidth}px), delta ${ov.delta}px.`,
  };
}

function adaptClipping(cv: IngestedClippingViolation, viewport: string): ClippingViolation {
  const selector = cv.selector ?? cv.element;
  return {
    elementId: cv.element,
    selector,
    viewport,
    ...(cv.text === undefined ? {} : { textContent: cv.text }),
    scrollHeight: cv.scrollWidth,
    clientHeight: cv.clientWidth,
    message: `Text clipping on '${selector}': content size (${cv.scrollWidth}px) exceeds visible size (${cv.clientWidth}px).`,
  };
}

function adaptStacking(sv: IngestedStackingViolation, viewport: string): StackingViolation {
  const [topSelector, bottomSelector] =
    sv.selectors && sv.selectors.length >= 2
      ? sv.selectors
      : sv.elements.length >= 2
        ? sv.elements
        : [sv.elements[0] ?? "unknown element", "unknown element"];
  return {
    topElementSelector: topSelector ?? "unknown element",
    bottomElementSelector: bottomSelector ?? "unknown element",
    viewport,
    ...(sv.overlapArea === undefined ? {} : { collisionArea: sv.overlapArea }),
    message: `Z-index stacking collision between '${topSelector}' and '${bottomSelector}'.`,
  };
}

export function adaptIngestedVisualReport(
  report: IngestedVisualReport | null,
): VisualMetricsReport | null {
  if (report === null) return null;

  const knownNames = new Set(Object.keys(report.viewports));
  const overflowByViewport = groupByViewport(report.layoutOverflows, knownNames);
  const clippingByViewport = groupByViewport(report.textClippings, knownNames);
  const stackingByViewport = groupByViewport(report.collisions, knownNames);

  const bucketNames = new Set<string>([
    ...knownNames,
    ...overflowByViewport.keys(),
    ...clippingByViewport.keys(),
    ...stackingByViewport.keys(),
  ]);
  if (bucketNames.size === 0) bucketNames.add(UNSPECIFIED_VIEWPORT);

  const viewports: ViewportMetrics[] = [...bucketNames].map((name) => {
    const dims = report.viewports[name];
    const overflowViolations = (overflowByViewport.get(name) ?? []).map((ov) =>
      adaptOverflow(ov, name),
    );
    const clippingViolations = (clippingByViewport.get(name) ?? []).map((cv) =>
      adaptClipping(cv, name),
    );
    const stackingViolations = (stackingByViewport.get(name) ?? []).map((sv) =>
      adaptStacking(sv, name),
    );
    return {
      viewport: name,
      ...(dims === undefined ? {} : { width: dims.width, height: dims.height }),
      overflowViolations,
      clippingViolations,
      stackingViolations,
    };
  });

  return {
    ...(report.timestamp === undefined ? {} : { timestamp: report.timestamp }),
    viewports,
  };
}

export function adaptScreenshotRecords(records: readonly CaptureRecord[]): ScreenshotMetadata[] {
  return records.map((record) => ({
    name: record.name,
    path: record.path,
    sizeBytes: record.bytes,
    ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
    ...(record.command_id === undefined ? {} : { commandId: record.command_id }),
    ...(record.task_id === undefined ? {} : { taskId: record.task_id }),
  }));
}
