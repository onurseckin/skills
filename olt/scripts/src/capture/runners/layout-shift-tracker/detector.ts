import type { AABB, DomPhysicsSnapshot, ExtractedElementPhysics } from "../types.ts";
import { identifyRootCausingElements } from "./exclusion.ts";
import {
  calculateDistanceFraction,
  calculateImpactFraction,
  calculateLayoutShiftScore,
  clipRectToViewport,
} from "./geometry.ts";
import { resolveLayoutShiftTrackerOptions } from "./options.ts";
import type {
  LayoutShiftEntry,
  LayoutShiftTrackerOptions,
  UnstableElementDisplacement,
} from "./types.ts";

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
