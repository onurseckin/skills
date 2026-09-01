import { HarnessError } from "../../core/errors/index.ts";
import type {
  PixelDeltaSeverity,
  PixelCoordinate,
  BoundingBox,
  VisualDeltaInput,
  VisualDeltaReport,
} from "./types.ts";
export class VisualDeltaComparator {
  /**
   * Classifies delta severity based on perceptual ratio
   */
  public classifySeverity(deltaRatio: number): PixelDeltaSeverity {
    if (deltaRatio <= 0.00001) return "NONE";
    if (deltaRatio <= 0.005) return "MINOR"; // <= 0.5%
    if (deltaRatio <= 0.05) return "SIGNIFICANT"; // <= 5.0%
    return "CRITICAL"; // > 5.0%
  }

  /**
   * Clusters adjacent differing pixels into spatial bounding boxes
   */
  public clusterDifferingPixels(
    coordinates: readonly PixelCoordinate[],
    clusterRadius: number = 20,
  ): readonly BoundingBox[] {
    if (!coordinates || coordinates.length === 0) {
      return [];
    }

    const clusters: PixelCoordinate[][] = [];

    for (const pt of coordinates) {
      let matchedCluster: PixelCoordinate[] | undefined;

      for (const cluster of clusters) {
        for (const existing of cluster) {
          const dx = Math.abs(pt.x - existing.x);
          const dy = Math.abs(pt.y - existing.y);
          if (dx <= clusterRadius && dy <= clusterRadius) {
            matchedCluster = cluster;
            break;
          }
        }
        if (matchedCluster) break;
      }

      if (matchedCluster) {
        matchedCluster.push(pt);
      } else {
        clusters.push([pt]);
      }
    }

    return clusters.map((cluster) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const pt of cluster) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }

      return {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(1, maxX - minX + 1),
        height: Math.max(1, maxY - minY + 1),
        pixelCount: cluster.length,
      };
    });
  }

  /**
   * Computes perceptual visual delta report
   */
  public computeDelta(input: VisualDeltaInput): VisualDeltaReport {
    if (!input) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Visual delta input must not be undefined or null",
      );
    }

    const totalPixels =
      input.totalPixels || input.baselineWidth * input.baselineHeight || 1;
    const differingPixelsCount = input.differingPixels || 0;
    const pixelDeltaRatio = differingPixelsCount / totalPixels;
    const severity = this.classifySeverity(pixelDeltaRatio);

    const boundingBoxes = this.clusterDifferingPixels(
      input.differingPixelCoordinates || [],
    );

    const shiftDetected =
      input.baselineWidth !== input.candidateWidth ||
      input.baselineHeight !== input.candidateHeight;

    const passed = severity === "NONE" || severity === "MINOR";
    const summary = `Delta: ${(pixelDeltaRatio * 100).toFixed(
      3,
    )}% (${differingPixelsCount}/${totalPixels} px), Severity: ${severity}, Clusters: ${
      boundingBoxes.length
    }${shiftDetected ? " [DIMENSION SHIFT DETECTED]" : ""}`;

    return {
      pixelDeltaRatio,
      differingPixelsCount,
      totalPixels,
      severity,
      boundingBoxes,
      clusterCount: boundingBoxes.length,
      shiftDetected,
      passed,
      summary,
    };
  }
}

// ============================================================================
// 5. Unified Evidence Lifecycle Engine & Singletons
// ============================================================================

