import { HarnessError } from "../../core/errors/index.ts";
import {
  SPRING_PRESETS,
  type FocusRingMetrics,
  type FocusRingInspectionResult,
  type HoverLiftMetrics,
  type HoverLiftInspectionResult,
  type TrajectoryPoint,
  type SpringPhysicsInspectionInput,
  type SpringPhysicsInspectionResult,
} from "./types.ts";
export class MicrocraftInspector {
  /**
   * Inspects focus rings for accessibility and tactile clarity
   */
  public inspectFocusRing(metrics: FocusRingMetrics): FocusRingInspectionResult {
    if (!metrics || !metrics.selector) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Focus ring metrics must include selector",
      );
    }

    const violations: string[] = [];
    const outlineWidthValid = metrics.outlineWidthPx >= 2;
    const offsetValid = metrics.outlineOffsetPx >= 1;
    const contrastValid = metrics.contrastRatioWithBackground >= 3.0; // WCAG 2.1 AA 3:1 for non-text focus indicators

    if (!outlineWidthValid) {
      violations.push(
        `Focus ring outline width ${metrics.outlineWidthPx}px is below 2px minimum standard`,
      );
    }
    if (metrics.outlineStyle === "none" || metrics.outlineStyle === "hidden") {
      violations.push("Focus ring outline style is hidden or none");
    }
    if (!offsetValid) {
      violations.push(
        `Focus ring outline offset ${metrics.outlineOffsetPx}px is below 1px minimum separation`,
      );
    }
    if (!contrastValid) {
      violations.push(
        `Focus ring contrast ratio ${metrics.contrastRatioWithBackground}:1 fails minimum 3:1 requirement`,
      );
    }
    if (metrics.isCrisp === false) {
      violations.push("Focus ring outline is blurry or antialiased unevenly");
    }

    return {
      selector: metrics.selector,
      passed: violations.length === 0,
      outlineWidthValid,
      offsetValid,
      contrastValid,
      violations,
    };
  }

  /**
   * Inspects hover lift tactile feedback (translateY elevation & shadow depth)
   */
  public inspectHoverLift(metrics: HoverLiftMetrics): HoverLiftInspectionResult {
    if (!metrics || !metrics.selector) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Hover lift metrics must include selector",
      );
    }

    const violations: string[] = [];
    // Hover translateY should typically elevate by -1px to -6px
    const elevationValid = metrics.translateYPx <= -1 && metrics.translateYPx >= -8;
    const shadowValid = metrics.shadowDepthChange > 0;

    if (!elevationValid) {
      violations.push(
        `Hover lift translateY of ${metrics.translateYPx}px outside standard tactile elevation range [-8px, -1px]`,
      );
    }
    if (!shadowValid) {
      violations.push(
        "Hover state does not deepen box shadow depth in conjunction with elevation",
      );
    }

    return {
      selector: metrics.selector,
      passed: violations.length === 0,
      elevationValid,
      shadowValid,
      violations,
    };
  }

  /**
   * Detects jitter or high-frequency oscillations in motion trajectory
   */
  public detectMotionJitter(samples: readonly TrajectoryPoint[]): {
    hasJitter: boolean;
    signChanges: number;
  } {
    if (!samples || samples.length < 3) {
      return { hasJitter: false, signChanges: 0 };
    }

    let signChanges = 0;
    let lastVelocity = 0;

    for (let i = 1; i < samples.length; i++) {
      const curr = samples[i];
      const prev = samples[i - 1];
      if (!curr || !prev) continue;
      const dt = curr.timeMs - prev.timeMs;
      if (dt <= 0) continue;
      const velocity = (curr.value - prev.value) / dt;

      if (i > 1 && Math.abs(velocity) > 0.001 && Math.abs(lastVelocity) > 0.001) {
        if ((velocity > 0 && lastVelocity < 0) || (velocity < 0 && lastVelocity > 0)) {
          signChanges++;
        }
      }
      lastVelocity = velocity;
    }

    // More than 4 direction changes within a short transition implies jitter/oscillation noise
    const hasJitter = signChanges > 4;
    return { hasJitter, signChanges };
  }

  /**
   * Inspects spring physics trajectory against preset expectations
   */
  public inspectSpringPhysics(
    input: SpringPhysicsInspectionInput,
  ): SpringPhysicsInspectionResult {
    if (!input || !input.trajectorySamples || input.trajectorySamples.length === 0) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Trajectory samples are required for spring physics inspection",
      );
    }

    const violations: string[] = [];
    const samples = [...input.trajectorySamples].sort((a, b) => a.timeMs - b.timeMs);
    const target = input.targetValue;
    const firstSample = samples[0];
    const lastSample = samples[samples.length - 1];
    if (!firstSample || !lastSample) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Trajectory samples are required for spring physics inspection",
      );
    }
    const start = firstSample.value;
    const range = Math.abs(target - start) || 1.0;

    let maxOvershoot = 0;
    let settlingTimeMs = lastSample.timeMs;

    // Calculate overshoot
    for (const sample of samples) {
      if (target >= start) {
        if (sample.value > target) {
          const over = (sample.value - target) / range;
          if (over > maxOvershoot) maxOvershoot = over;
        }
      } else {
        if (sample.value < target) {
          const over = (target - sample.value) / range;
          if (over > maxOvershoot) maxOvershoot = over;
        }
      }
    }

    // Calculate settling time (time after which value stays within 1% of target)
    for (let i = samples.length - 1; i >= 0; i--) {
      const sample = samples[i];
      if (!sample) continue;
      const diff = Math.abs(sample.value - target) / range;
      if (diff > 0.01) {
        const nextSample = samples[Math.min(i + 1, samples.length - 1)];
        if (nextSample) {
          settlingTimeMs = nextSample.timeMs;
        }
        break;
      }
    }

    const { hasJitter, signChanges } = this.detectMotionJitter(samples);
    if (hasJitter) {
      violations.push(
        `Motion jitter detected: trajectory exhibited ${signChanges} direction reversals`,
      );
    }

    const preset = input.presetName
      ? SPRING_PRESETS[input.presetName.toUpperCase()]
      : undefined;

    if (preset) {
      if (settlingTimeMs > preset.maxDurationMs) {
        violations.push(
          `Spring settling time ${settlingTimeMs}ms exceeded max allowed duration ${preset.maxDurationMs}ms for preset '${preset.name}'`,
        );
      }
      if (preset.name === "cockpit" && maxOvershoot > 0.01) {
        violations.push(
          `Cockpit spring preset mandates zero overshoot, but observed ${(maxOvershoot * 100).toFixed(1)}% overshoot`,
        );
      }
    }

    return {
      passed: violations.length === 0,
      settlingTimeMs,
      maxOvershoot,
      oscillationsCount: signChanges,
      jitterDetected: hasJitter,
      violations,
    };
  }
}

// ============================================================================
// 4. Unified Motion Verification Engine & Singletons
// ============================================================================

