// @ts-nocheck
import { HarnessError } from "../../core/errors/index.ts";
import {
  GPU_ACCELERATED_PROPERTIES,
  LAYOUT_TRIGGERING_PROPERTIES,
  JANK_FRAME_THRESHOLD_MS,
  MAX_PERMISSIBLE_JANK_RATE,
  MAX_PERMISSIBLE_CLS,
  type AnimatedPropertyAudit,
  type FrameSample,
  type LayoutShiftSample,
  type MotionHeadlessPreFlightInput,
  type MotionHeadlessPreFlightResult,
} from "./types.ts";
export class HeadlessMotionPreFlightAuditor {
  /**
   * Audits property list for GPU acceleration compliance
   */
  public auditProperties(
    properties: readonly string[],
  ): readonly AnimatedPropertyAudit[] {
    if (!properties) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Properties array must not be undefined or null",
      );
    }

    return properties.map((prop) => {
      const normalized = prop.trim().toLowerCase();
      const isGpuAccelerated = (GPU_ACCELERATED_PROPERTIES as readonly string[]).includes(
        normalized,
      );
      const isLayoutTriggering = (LAYOUT_TRIGGERING_PROPERTIES as readonly string[]).includes(
        normalized,
      );

      let recommendation: string | undefined;
      if (isLayoutTriggering) {
        recommendation = `Property '${prop}' triggers browser layout recalculations. Refactor to 'transform' or 'opacity' to leverage GPU compositor.`;
      }

      return {
        property: prop,
        isGpuAccelerated,
        isLayoutTriggering,
        ...(recommendation !== undefined ? { recommendation } : {}),
      };
    });
  }

  /**
   * Calculates frame jank metrics from frame duration samples
   */
  public calculateJankRate(
    frames: readonly FrameSample[],
    thresholdMs: number = JANK_FRAME_THRESHOLD_MS,
  ): {
    totalFrames: number;
    jankFrames: number;
    jankRate: number;
    averageFrameDurationMs: number;
    maxFrameDurationMs: number;
  } {
    if (!frames || frames.length === 0) {
      return {
        totalFrames: 0,
        jankFrames: 0,
        jankRate: 0,
        averageFrameDurationMs: 0,
        maxFrameDurationMs: 0,
      };
    }

    let jankFrames = 0;
    let totalDuration = 0;
    let maxFrameDurationMs = 0;

    for (const frame of frames) {
      totalDuration += frame.durationMs;
      if (frame.durationMs > thresholdMs) {
        jankFrames++;
      }
      if (frame.durationMs > maxFrameDurationMs) {
        maxFrameDurationMs = frame.durationMs;
      }
    }

    const totalFrames = frames.length;
    const jankRate = totalFrames > 0 ? jankFrames / totalFrames : 0;
    const averageFrameDurationMs = totalFrames > 0 ? totalDuration / totalFrames : 0;

    return {
      totalFrames,
      jankFrames,
      jankRate,
      averageFrameDurationMs,
      maxFrameDurationMs,
    };
  }

  /**
   * Calculates Cumulative Layout Shift (CLS)
   */
  public calculateCLS(shifts?: readonly LayoutShiftSample[]): number {
    if (!shifts || shifts.length === 0) {
      return 0;
    }
    return shifts.reduce((sum, sample) => sum + (sample.shiftScore || 0), 0);
  }

  /**
   * Performs complete Phase 1 Pre-flight audit
   */
  public auditAnimation(
    input: MotionHeadlessPreFlightInput,
  ): MotionHeadlessPreFlightResult {
    if (!input || !input.animationName || !input.targetSelector) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Animation name and target selector are required for pre-flight audit",
      );
    }

    const violations: string[] = [];
    const propertyAudits = this.auditProperties(input.animatedProperties || []);
    const layoutTriggeringViolations: string[] = [];

    for (const audit of propertyAudits) {
      if (audit.isLayoutTriggering) {
        const msg = `Layout-triggering property '${audit.property}' detected in animation '${input.animationName}'`;
        layoutTriggeringViolations.push(msg);
        violations.push(msg);
      }
    }

    const jankMetrics = this.calculateJankRate(input.frameSamples || []);
    if (jankMetrics.jankRate > MAX_PERMISSIBLE_JANK_RATE) {
      violations.push(
        `Jank rate ${(jankMetrics.jankRate * 100).toFixed(1)}% exceeds maximum allowable threshold ${(
          MAX_PERMISSIBLE_JANK_RATE * 100
        ).toFixed(1)}% (${jankMetrics.jankFrames}/${jankMetrics.totalFrames} frames dropped)`,
      );
    }

    const cls = this.calculateCLS(input.layoutShifts);
    if (cls > MAX_PERMISSIBLE_CLS) {
      violations.push(
        `Cumulative Layout Shift (CLS) ${cls.toFixed(4)} exceeds allowable threshold ${MAX_PERMISSIBLE_CLS}`,
      );
    }

    return {
      animationName: input.animationName,
      targetSelector: input.targetSelector,
      passed: violations.length === 0,
      totalFrames: jankMetrics.totalFrames,
      jankFrames: jankMetrics.jankFrames,
      jankRate: jankMetrics.jankRate,
      averageFrameDurationMs: jankMetrics.averageFrameDurationMs,
      maxFrameDurationMs: jankMetrics.maxFrameDurationMs,
      cumulativeLayoutShift: cls,
      propertyAudits,
      layoutTriggeringViolations,
      violations,
    };
  }
}

// ============================================================================
// 2. Phase 2: Temporal Keyframe Step-Sampling
// ============================================================================

