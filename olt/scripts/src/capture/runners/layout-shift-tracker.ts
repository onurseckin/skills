import type {
  AABB,
  DomPhysicsSnapshot,
  ExtractedComputedStyles,
  ExtractedElementPhysics,
} from "./types.ts";

export interface UnstableElementDisplacement {
  readonly selector: string;
  readonly tagName: string;
  readonly id?: string | undefined;
  readonly previousRect: AABB;
  readonly currentRect: AABB;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaWidth: number;
  readonly deltaHeight: number;
  readonly maxDisplacement: number;
  readonly horizontalDisplacement: number;
  readonly verticalDisplacement: number;
  readonly isRootCause: boolean;
  readonly rootCauseReason?: string | undefined;
  readonly isExcluded: boolean;
  readonly exclusionReason?:
    | "fixed_or_sticky"
    | "transform_only"
    | "opacity_only"
    | "out_of_bounds"
    | "zero_viewport"
    | "nested_child_of_shifting_container"
    | "user_input_recent"
    | undefined;
  readonly previousStyles?: ExtractedComputedStyles | undefined;
  readonly currentStyles?: ExtractedComputedStyles | undefined;
}

export interface LayoutShiftEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly impactFraction: number;
  readonly distanceFraction: number;
  readonly score: number;
  readonly hadRecentInput: boolean;
  readonly sources: readonly UnstableElementDisplacement[];
  readonly rootCauses: readonly UnstableElementDisplacement[];
  readonly viewport: { readonly width: number; readonly height: number };
  readonly isValidShift: boolean;
}

export interface LayoutShiftWindow {
  readonly windowIndex: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
  readonly entries: readonly LayoutShiftEntry[];
  readonly windowScore: number;
  readonly isMaxWindow: boolean;
}

export interface CumulativeLayoutShiftReport {
  readonly clsScore: number;
  readonly totalCumulativeScore: number;
  readonly sessionWindows: readonly LayoutShiftWindow[];
  readonly maxSessionWindow: LayoutShiftWindow | null;
  readonly totalEntries: number;
  readonly unstableElementsCount: number;
  readonly rootCauseElements: readonly UnstableElementDisplacement[];
  readonly rating: "good" | "needs-improvement" | "poor";
  readonly summary: string;
  readonly evaluatedAt: string;
}

export interface LayoutShiftTrackerOptions {
  readonly subpixelTolerance?: number | undefined;
  readonly userInputWindowMs?: number | undefined;
  readonly sessionMaxDurationMs?: number | undefined;
  readonly sessionMaxGapMs?: number | undefined;
  readonly excludeFixedSticky?: boolean | undefined;
  readonly excludeTransformOnly?: boolean | undefined;
  readonly excludeOpacityOnly?: boolean | undefined;
  readonly ignoreUserInputShifts?: boolean | undefined;
}

export interface ResolvedLayoutShiftTrackerOptions {
  readonly subpixelTolerance: number;
  readonly userInputWindowMs: number;
  readonly sessionMaxDurationMs: number;
  readonly sessionMaxGapMs: number;
  readonly excludeFixedSticky: boolean;
  readonly excludeTransformOnly: boolean;
  readonly excludeOpacityOnly: boolean;
  readonly ignoreUserInputShifts: boolean;
}

export const DEFAULT_LAYOUT_SHIFT_OPTIONS: ResolvedLayoutShiftTrackerOptions = {
  subpixelTolerance: 0.5,
  userInputWindowMs: 500,
  sessionMaxDurationMs: 5000,
  sessionMaxGapMs: 1000,
  excludeFixedSticky: true,
  excludeTransformOnly: true,
  excludeOpacityOnly: true,
  ignoreUserInputShifts: true,
};

export function resolveLayoutShiftTrackerOptions(
  options?: LayoutShiftTrackerOptions,
): ResolvedLayoutShiftTrackerOptions {
  return {
    subpixelTolerance: options?.subpixelTolerance ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.subpixelTolerance,
    userInputWindowMs: options?.userInputWindowMs ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.userInputWindowMs,
    sessionMaxDurationMs:
      options?.sessionMaxDurationMs ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.sessionMaxDurationMs,
    sessionMaxGapMs: options?.sessionMaxGapMs ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.sessionMaxGapMs,
    excludeFixedSticky:
      options?.excludeFixedSticky ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.excludeFixedSticky,
    excludeTransformOnly:
      options?.excludeTransformOnly ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.excludeTransformOnly,
    excludeOpacityOnly:
      options?.excludeOpacityOnly ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.excludeOpacityOnly,
    ignoreUserInputShifts:
      options?.ignoreUserInputShifts ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.ignoreUserInputShifts,
  };
}

/**
 * Clips an axis-aligned bounding box to the visible viewport bounds.
 * Returns null if the bounding box has no intersection with the viewport.
 */
export function clipRectToViewport(
  rect: AABB,
  viewportWidth: number,
  viewportHeight: number,
): AABB | null {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }

  const left = Math.max(0, Math.min(viewportWidth, rect.left ?? rect.x));
  const right = Math.max(0, Math.min(viewportWidth, rect.right ?? rect.x + rect.width));
  const top = Math.max(0, Math.min(viewportHeight, rect.top ?? rect.y));
  const bottom = Math.max(0, Math.min(viewportHeight, rect.bottom ?? rect.y + rect.height));

  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: left,
    y: top,
    width,
    height,
    left,
    right,
    top,
    bottom,
  };
}

/**
 * Computes the exact 2D geometric union area of a collection of bounding boxes
 * using a 1D sweep-line algorithm to avoid double-counting overlapping areas.
 */
export function computeRectanglesUnionArea(rects: readonly AABB[]): number {
  if (rects.length === 0) return 0;
  if (rects.length === 1) {
    const r = rects[0]!;
    return Math.max(0, r.width) * Math.max(0, r.height);
  }

  // Collect and sort unique X boundary coordinates
  const xCoordinates: number[] = [];
  for (const r of rects) {
    const left = r.left ?? r.x;
    const right = r.right ?? r.x + r.width;
    if (right > left) {
      xCoordinates.push(left, right);
    }
  }

  if (xCoordinates.length === 0) return 0;
  xCoordinates.sort((a, b) => a - b);

  // Filter unique X coordinates
  const uniqueX: number[] = [];
  for (let i = 0; i < xCoordinates.length; i++) {
    if (i === 0 || Math.abs(xCoordinates[i]! - xCoordinates[i - 1]!) > 1e-6) {
      uniqueX.push(xCoordinates[i]!);
    }
  }

  let totalArea = 0;

  // Sweep across each X slice
  for (let i = 0; i < uniqueX.length - 1; i++) {
    const x1 = uniqueX[i]!;
    const x2 = uniqueX[i + 1]!;
    const dx = x2 - x1;
    if (dx <= 0) continue;

    // Collect vertical intervals of all rectangles covering this X slice
    const yIntervals: { top: number; bottom: number }[] = [];
    for (const r of rects) {
      const left = r.left ?? r.x;
      const right = r.right ?? r.x + r.width;
      if (left <= x1 && right >= x2) {
        const top = r.top ?? r.y;
        const bottom = r.bottom ?? r.y + r.height;
        if (bottom > top) {
          yIntervals.push({ top, bottom });
        }
      }
    }

    if (yIntervals.length === 0) continue;

    // Merge 1D vertical intervals
    yIntervals.sort((a, b) => a.top - b.top);
    let totalDy = 0;
    let currentTop = yIntervals[0]!.top;
    let currentBottom = yIntervals[0]!.bottom;

    for (let j = 1; j < yIntervals.length; j++) {
      const next = yIntervals[j]!;
      if (next.top <= currentBottom) {
        currentBottom = Math.max(currentBottom, next.bottom);
      } else {
        totalDy += currentBottom - currentTop;
        currentTop = next.top;
        currentBottom = next.bottom;
      }
    }
    totalDy += currentBottom - currentTop;

    totalArea += dx * totalDy;
  }

  return totalArea;
}

/**
 * Calculates the impact fraction of a layout shift for a single element or a set of shifted rectangles.
 * Impact Fraction = Impact Area (union of visible areas before and after shift) / Viewport Area.
 */
export function calculateImpactFraction(
  elementRectPairs: readonly { previousRect: AABB; currentRect: AABB }[],
  viewport: { width: number; height: number },
): number {
  if (viewport.width <= 0 || viewport.height <= 0 || elementRectPairs.length === 0) {
    return 0;
  }

  const viewportArea = viewport.width * viewport.height;
  const visibleRects: AABB[] = [];

  for (const pair of elementRectPairs) {
    const prevClipped = clipRectToViewport(pair.previousRect, viewport.width, viewport.height);
    if (prevClipped) {
      visibleRects.push(prevClipped);
    }
    const currClipped = clipRectToViewport(pair.currentRect, viewport.width, viewport.height);
    if (currClipped) {
      visibleRects.push(currClipped);
    }
  }

  if (visibleRects.length === 0) {
    return 0;
  }

  const unionArea = computeRectanglesUnionArea(visibleRects);
  const fraction = unionArea / viewportArea;
  return Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
}

/**
 * Calculates the distance fraction of a layout shift.
 * Distance Fraction = Max Displacement (horizontal or vertical) / Max Viewport Dimension (width or height).
 */
export function calculateDistanceFraction(
  maxDisplacement: number,
  viewport: { width: number; height: number },
): number {
  if (viewport.width <= 0 || viewport.height <= 0 || maxDisplacement <= 0) {
    return 0;
  }

  const maxDimension = Math.max(viewport.width, viewport.height);
  if (maxDimension <= 0) return 0;

  const fraction = maxDisplacement / maxDimension;
  return Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
}

/**
 * Calculates the layout shift score for a shift entry.
 * Layout Shift Score = Impact Fraction * Distance Fraction.
 */
export function calculateLayoutShiftScore(
  impactFraction: number,
  distanceFraction: number,
): number {
  const score = impactFraction * distanceFraction;
  return Math.max(0, Number.isFinite(score) ? score : 0);
}

/**
 * Categorizes and groups layout shift entries into session windows according to Web Vitals specification:
 * - Session windows have a maximum total duration of 5 seconds (5000ms).
 * - Consecutive shifts are grouped into the same window if the gap between shifts is at most 1 second (1000ms).
 * - A gap > 1s or reaching the 5s window cap ends the session window and begins a new window.
 */
export function groupSessionWindows(
  entries: readonly LayoutShiftEntry[],
  options?: LayoutShiftTrackerOptions,
): readonly LayoutShiftWindow[] {
  if (entries.length === 0) return [];

  const resolved = resolveLayoutShiftTrackerOptions(options);
  const maxDuration = resolved.sessionMaxDurationMs;
  const maxGap = resolved.sessionMaxGapMs;

  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const windows: LayoutShiftWindow[] = [];

  let currentWindowEntries: LayoutShiftEntry[] = [];
  let windowIndex = 0;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;

    if (currentWindowEntries.length === 0) {
      currentWindowEntries.push(entry);
      continue;
    }

    const previousEntry = currentWindowEntries[currentWindowEntries.length - 1]!;
    const gap = entry.timestamp - previousEntry.timestamp;
    const windowStart = currentWindowEntries[0]!.timestamp;
    const totalDuration = entry.timestamp - windowStart;

    if (gap > maxGap || totalDuration > maxDuration) {
      const startTime = currentWindowEntries[0]!.timestamp;
      const endTime = previousEntry.timestamp;
      const windowScore = currentWindowEntries.reduce(
        (sum, e) => (e.isValidShift ? sum + e.score : sum),
        0,
      );

      windows.push({
        windowIndex: windowIndex++,
        startTime,
        endTime,
        duration: Math.max(0, endTime - startTime),
        entries: currentWindowEntries,
        windowScore,
        isMaxWindow: false,
      });

      currentWindowEntries = [entry];
    } else {
      currentWindowEntries.push(entry);
    }
  }

  if (currentWindowEntries.length > 0) {
    const startTime = currentWindowEntries[0]!.timestamp;
    const endTime = currentWindowEntries[currentWindowEntries.length - 1]!.timestamp;
    const windowScore = currentWindowEntries.reduce(
      (sum, e) => (e.isValidShift ? sum + e.score : sum),
      0,
    );

    windows.push({
      windowIndex: windowIndex++,
      startTime,
      endTime,
      duration: Math.max(0, endTime - startTime),
      entries: currentWindowEntries,
      windowScore,
      isMaxWindow: false,
    });
  }

  // Find maximum window score
  let maxScore = -1;
  let maxIndex = -1;
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]!;
    if (w.windowScore > maxScore) {
      maxScore = w.windowScore;
      maxIndex = i;
    }
  }

  return windows.map((w, idx) => ({
    ...w,
    isMaxWindow: idx === maxIndex && w.windowScore > 0,
  }));
}

/**
 * Analyzes shifting elements to distinguish root causes from dependent shifts.
 * Identifies container elements whose displacement naturally carried child elements,
 * or top-level elements whose expansion/shift pushed downstream elements.
 */
export function identifyRootCausingElements(
  displacements: readonly UnstableElementDisplacement[],
): {
  rootCauses: readonly UnstableElementDisplacement[];
  dependentDisplacements: readonly UnstableElementDisplacement[];
} {
  if (displacements.length === 0) {
    return { rootCauses: [], dependentDisplacements: [] };
  }

  const rootCauses: UnstableElementDisplacement[] = [];
  const dependentDisplacements: UnstableElementDisplacement[] = [];

  for (let i = 0; i < displacements.length; i++) {
    const candidate = displacements[i]!;
    if (candidate.isExcluded) {
      dependentDisplacements.push(candidate);
      continue;
    }

    let isDependentChild = false;
    let rootReason = "Primary shifting element";

    for (let j = 0; j < displacements.length; j++) {
      if (i === j) continue;
      const other = displacements[j]!;
      if (other.isExcluded) continue;

      // Check if candidate is geometrically nested inside other element
      const otherPrev = other.previousRect;
      const candPrev = candidate.previousRect;
      const isContained =
        candPrev.x >= otherPrev.x - 1 &&
        candPrev.y >= otherPrev.y - 1 &&
        candPrev.x + candPrev.width <= otherPrev.x + otherPrev.width + 1 &&
        candPrev.y + candPrev.height <= otherPrev.y + otherPrev.height + 1;

      const sameDelta =
        Math.abs(candidate.deltaX - other.deltaX) < 1 &&
        Math.abs(candidate.deltaY - other.deltaY) < 1;

      if (isContained && sameDelta) {
        isDependentChild = true;
        break;
      }
    }

    if (isDependentChild) {
      dependentDisplacements.push({
        ...candidate,
        isRootCause: false,
        exclusionReason: "nested_child_of_shifting_container",
        rootCauseReason: "Carried by shifting parent container",
      });
    } else {
      if (candidate.deltaHeight > 5 || candidate.deltaWidth > 5) {
        rootReason = `Element resized (dH: ${candidate.deltaHeight}px, dW: ${candidate.deltaWidth}px), causing layout reflow`;
      } else if (Math.abs(candidate.deltaY) > 0) {
        rootReason = `Element translated vertically by ${candidate.deltaY}px`;
      } else if (Math.abs(candidate.deltaX) > 0) {
        rootReason = `Element translated horizontally by ${candidate.deltaX}px`;
      }

      rootCauses.push({
        ...candidate,
        isRootCause: true,
        rootCauseReason: rootReason,
      });
    }
  }

  return { rootCauses, dependentDisplacements };
}

/**
 * Compares two DOM physics snapshots and calculates layout shift displacement and score.
 */
export function detectLayoutShiftBetweenSnapshots(
  previousSnapshot: DomPhysicsSnapshot,
  currentSnapshot: DomPhysicsSnapshot,
  options?: LayoutShiftTrackerOptions & {
    timestamp?: number | undefined;
    hadRecentInput?: boolean | undefined;
  },
): LayoutShiftEntry {
  const mergedOptions = resolveLayoutShiftTrackerOptions(options);
  const viewport =
    currentSnapshot.viewport.width > 0 && currentSnapshot.viewport.height > 0
      ? currentSnapshot.viewport
      : previousSnapshot.viewport;

  const timestamp = options?.timestamp ?? Date.now();
  const hadRecentInput = options?.hadRecentInput ?? false;

  if (viewport.width <= 0 || viewport.height <= 0) {
    return {
      id: `shift-${timestamp}`,
      timestamp,
      impactFraction: 0,
      distanceFraction: 0,
      score: 0,
      hadRecentInput,
      sources: [],
      rootCauses: [],
      viewport: { width: viewport.width, height: viewport.height },
      isValidShift: false,
    };
  }

  // Create element map from previous snapshot
  const prevMap = new Map<string, ExtractedElementPhysics>();
  for (const el of previousSnapshot.elements) {
    prevMap.set(el.selector, el);
  }

  const rawDisplacements: UnstableElementDisplacement[] = [];

  for (const currEl of currentSnapshot.elements) {
    const prevEl = prevMap.get(currEl.selector);
    if (!prevEl) continue;

    const deltaX = currEl.bounds.x - prevEl.bounds.x;
    const deltaY = currEl.bounds.y - prevEl.bounds.y;
    const deltaWidth = currEl.bounds.width - prevEl.bounds.width;
    const deltaHeight = currEl.bounds.height - prevEl.bounds.height;
    const horizontalDisplacement = Math.abs(deltaX);
    const verticalDisplacement = Math.abs(deltaY);
    const maxDisplacement = Math.max(horizontalDisplacement, verticalDisplacement);

    // If movement is smaller than subpixel tolerance, ignore
    if (
      maxDisplacement < mergedOptions.subpixelTolerance &&
      Math.abs(deltaWidth) < mergedOptions.subpixelTolerance &&
      Math.abs(deltaHeight) < mergedOptions.subpixelTolerance
    ) {
      continue;
    }

    // Check exclusions
    let isExcluded = false;
    let exclusionReason: UnstableElementDisplacement["exclusionReason"] = undefined;

    // Check fixed / sticky exclusion
    const isFixedOrSticky =
      currEl.computedStyles.position === "fixed" ||
      currEl.computedStyles.position === "sticky" ||
      prevEl.computedStyles.position === "fixed" ||
      prevEl.computedStyles.position === "sticky";

    if (mergedOptions.excludeFixedSticky && isFixedOrSticky) {
      isExcluded = true;
      exclusionReason = "fixed_or_sticky";
    }

    // Check out of bounds exclusion (both before and after were completely off-screen)
    const prevVisible = clipRectToViewport(prevEl.bounds, viewport.width, viewport.height);
    const currVisible = clipRectToViewport(currEl.bounds, viewport.width, viewport.height);

    if (!prevVisible && !currVisible) {
      isExcluded = true;
      exclusionReason = "out_of_bounds";
    }

    // Check user input recent exclusion
    if (mergedOptions.ignoreUserInputShifts && hadRecentInput) {
      isExcluded = true;
      exclusionReason = "user_input_recent";
    }

    rawDisplacements.push({
      selector: currEl.selector,
      tagName: currEl.tagName,
      id: currEl.id,
      previousRect: prevEl.bounds,
      currentRect: currEl.bounds,
      deltaX,
      deltaY,
      deltaWidth,
      deltaHeight,
      maxDisplacement,
      horizontalDisplacement,
      verticalDisplacement,
      isRootCause: !isExcluded,
      isExcluded,
      exclusionReason,
      previousStyles: prevEl.computedStyles,
      currentStyles: currEl.computedStyles,
    });
  }

  // Disambiguate root causes vs nested shifting containers
  const { rootCauses, dependentDisplacements } = identifyRootCausingElements(rawDisplacements);
  const allDisplacements = [...rootCauses, ...dependentDisplacements];

  // Filter valid shifting rect pairs for impact fraction calculation
  const validPairs: { previousRect: AABB; currentRect: AABB }[] = [];
  let maxValidDisplacement = 0;

  for (const d of allDisplacements) {
    if (!d.isExcluded) {
      validPairs.push({ previousRect: d.previousRect, currentRect: d.currentRect });
      if (d.maxDisplacement > maxValidDisplacement) {
        maxValidDisplacement = d.maxDisplacement;
      }
    }
  }

  const impactFraction = calculateImpactFraction(validPairs, viewport);
  const distanceFraction = calculateDistanceFraction(maxValidDisplacement, viewport);
  const score = calculateLayoutShiftScore(impactFraction, distanceFraction);
  const isValidShift = score > 0 && (!hadRecentInput || !mergedOptions.ignoreUserInputShifts);

  return {
    id: `shift-${timestamp}`,
    timestamp,
    impactFraction,
    distanceFraction,
    score,
    hadRecentInput,
    sources: allDisplacements,
    rootCauses,
    viewport: { width: viewport.width, height: viewport.height },
    isValidShift,
  };
}

/**
 * Builds a comprehensive Cumulative Layout Shift report from a list of shift entries.
 */
export function buildCumulativeLayoutShiftReport(
  entries: readonly LayoutShiftEntry[],
  options?: LayoutShiftTrackerOptions,
): CumulativeLayoutShiftReport {
  const sessionWindows = groupSessionWindows(entries, options);
  let maxSessionWindow: LayoutShiftWindow | null = null;
  let totalCumulativeScore = 0;

  for (const w of sessionWindows) {
    totalCumulativeScore += w.windowScore;
    if (!maxSessionWindow || w.windowScore > maxSessionWindow.windowScore) {
      maxSessionWindow = w;
    }
  }

  const clsScore = maxSessionWindow ? maxSessionWindow.windowScore : 0;
  const rating: CumulativeLayoutShiftReport["rating"] =
    clsScore <= 0.1 ? "good" : clsScore <= 0.25 ? "needs-improvement" : "poor";

  const allRootCauses: UnstableElementDisplacement[] = [];
  const seenSelectors = new Set<string>();

  for (const entry of entries) {
    for (const rc of entry.rootCauses) {
      if (!seenSelectors.has(rc.selector)) {
        seenSelectors.add(rc.selector);
        allRootCauses.push(rc);
      }
    }
  }

  let unstableCount = 0;
  for (const entry of entries) {
    unstableCount += entry.sources.filter((s) => !s.isExcluded).length;
  }

  const summary =
    clsScore <= 0.1
      ? `CLS Score ${clsScore.toFixed(4)} (Good). Visual stability is well maintained.`
      : clsScore <= 0.25
        ? `CLS Score ${clsScore.toFixed(4)} (Needs Improvement). Moderate unexpected layout shifts observed across ${unstableCount} element instances.`
        : `CLS Score ${clsScore.toFixed(4)} (Poor). Significant unexpected layout shifts detected; ${allRootCauses.length} root-causing elements identified.`;

  return {
    clsScore,
    totalCumulativeScore,
    sessionWindows,
    maxSessionWindow,
    totalEntries: entries.length,
    unstableElementsCount: unstableCount,
    rootCauseElements: allRootCauses,
    rating,
    summary,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Stateful layout shift tracker to measure and aggregate shifts during live capture runs.
 */
export class LayoutShiftTracker {
  private readonly entries: LayoutShiftEntry[] = [];
  private readonly options: ResolvedLayoutShiftTrackerOptions;
  private lastUserInputTime = 0;

  constructor(options?: LayoutShiftTrackerOptions) {
    this.options = resolveLayoutShiftTrackerOptions(options);
  }

  public recordUserInput(timestamp?: number): void {
    this.lastUserInputTime = timestamp ?? Date.now();
  }

  public hadRecentInput(timestamp?: number): boolean {
    const now = timestamp ?? Date.now();
    return now - this.lastUserInputTime < this.options.userInputWindowMs;
  }

  public recordShiftEntry(entry: LayoutShiftEntry): void {
    this.entries.push(entry);
  }

  public trackSnapshotDiff(
    previousSnapshot: DomPhysicsSnapshot,
    currentSnapshot: DomPhysicsSnapshot,
    timestamp?: number,
  ): LayoutShiftEntry {
    const time = timestamp ?? Date.now();
    const isRecent = this.hadRecentInput(time);
    const entry = detectLayoutShiftBetweenSnapshots(previousSnapshot, currentSnapshot, {
      ...this.options,
      timestamp: time,
      hadRecentInput: isRecent,
    });
    this.entries.push(entry);
    return entry;
  }

  public getEntries(): readonly LayoutShiftEntry[] {
    return [...this.entries];
  }

  public generateReport(): CumulativeLayoutShiftReport {
    return buildCumulativeLayoutShiftReport(this.entries, this.options);
  }

  public reset(): void {
    this.entries.length = 0;
    this.lastUserInputTime = 0;
  }
}
