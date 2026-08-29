import type { UnstableElementDisplacement } from "./types.ts";

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
