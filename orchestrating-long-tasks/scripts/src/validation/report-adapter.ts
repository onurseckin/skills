/**
 * Bridges what the harness actually ingests (`reporting/screenshot-types.ts`, the flat shape a
 * `visual-report.json` file and the capture ledger produce) into the richer per-viewport shape the
 * dual-channel analyzer reasons over. The analyzer's shape predates any real producer for it; this
 * is the one place that turns real evidence into its input rather than inventing evidence to match.
 */
import type { CaptureRecord } from "../store/captures.ts";
import type {
  ClippingViolation as IngestedClippingViolation,
  OverflowViolation as IngestedOverflowViolation,
  StackingViolation as IngestedStackingViolation,
  VisualMetricsReport as IngestedVisualReport,
} from "../reporting/screenshot-types.ts";
// Imported through the analyzer's own re-export, its public surface for these shapes, rather than
// reaching past it into `dual-channel-types.ts` directly.
import type {
  ClippingViolation,
  OverflowViolation,
  ScreenshotMetadata,
  StackingViolation,
  ViewportMetrics,
  VisualMetricsReport,
} from "./dual-channel-analyzer.ts";

/** Where an ingested violation names no viewport of its own, or names one the report never defined. */
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

/**
 * The ingested schema records a clipping violation's content size as `scrollWidth`/`clientWidth`
 * (the same field names the overflow record uses), not `scrollHeight`/`clientHeight`. That is the
 * ingestion contract as it stands, so the mapping carries the numbers through under the analyzer's
 * expected names rather than inventing a height nobody measured.
 */
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
  // The ingested record carries one `zIndex` for the collision and never says which of the two
  // elements it belongs to, so neither slot is filled: copying it into both would state a z-index
  // for an element nothing measured. The raw report is persisted alongside the audit either way.
  return {
    topElementSelector: topSelector ?? "unknown element",
    bottomElementSelector: bottomSelector ?? "unknown element",
    viewport,
    ...(sv.overlapArea === undefined ? {} : { collisionArea: sv.overlapArea }),
    message: `Z-index stacking collision between '${topSelector}' and '${bottomSelector}'.`,
  };
}

/**
 * Converts the flat report the ingestion pipeline actually stores into the per-viewport shape
 * `analyzeDualChannel` audits. Violation categories the ingested schema has no field for at all
 * (contrast ratios, origin-orphan coordinates, render-cache resets) are left absent rather than
 * defaulted, so the analyzer reports what it was given, never what was guessed on its behalf.
 *
 * The three categories the schema does carry are always named, empty or not: the analyzer reads an
 * empty array as "inspected, nothing found" and an absent one as "never inspected", and that
 * distinction is what keeps a proof from claiming a check the evidence never supported.
 */
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
      // A bucket the report defined no dimensions for keeps none; `0x0` would be a size nobody
      // measured, and the consistency check would then read it as a malformed dimension.
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

/**
 * Screenshot capture records carry no recorded viewport or pixel dimensions of their own; the
 * analyzer resolves a screenshot's viewport from its file name (`normalizeViewportName` falls back
 * to `name` when `viewport` is absent), which is genuinely what the capture ledger has.
 */
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
