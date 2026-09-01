import { HarnessError } from "../../core/errors/index.ts";
import type {
  KeyframeSamplePoint,
  TemporalKeyframeInspectionInput,
  TemporalKeyframeInspectionResult,
} from "./types.ts";
export class TemporalKeyframeStepSampler {
  /**
   * Analyzes keyframe samples at 0% inception, 50% midpoint, and 100% final resting state
   */
  public sampleAndAnalyze(
    input: TemporalKeyframeInspectionInput,
  ): TemporalKeyframeInspectionResult {
    if (!input || !input.animationName || !input.samples) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Animation name and samples are required for keyframe step-sampling",
      );
    }

    const violations: string[] = [];
    const samples = [...input.samples].sort((a, b) => a.timestampMs - b.timestampMs);

    // Identify standard sampling checkpoints
    const inceptionSample = samples.find(
      (s) => s.point === "0%" || s.point === 0 || s.timestampMs === 0,
    );
    const midpointSample = samples.find(
      (s) =>
        s.point === "50%" ||
        s.point === 0.5 ||
        (s.timestampMs >= input.durationMs * 0.45 && s.timestampMs <= input.durationMs * 0.55),
    );
    const finalSample = samples.find(
      (s) => s.point === "100%" || s.point === 1 || s.timestampMs >= input.durationMs * 0.95,
    );

    const sampledInception0 = inceptionSample !== undefined;
    const sampledMidpoint50 = midpointSample !== undefined;
    const sampledFinal100 = finalSample !== undefined;

    if (!sampledInception0) {
      violations.push("Missing 0% Inception resting state keyframe sample");
    }
    if (!sampledMidpoint50) {
      violations.push("Missing 50% Midpoint interpolation keyframe sample");
    }
    if (!sampledFinal100) {
      violations.push("Missing 100% Final resting state keyframe sample");
    }

    // Check for blur artifacts across all samples
    let blurArtifactDetected = false;
    for (const sample of samples) {
      if (sample.blurDetected) {
        blurArtifactDetected = true;
        violations.push(
          `Blur or sub-pixel rendering artifact detected at keyframe sample ${String(sample.point)} (timestamp ${sample.timestampMs}ms)`,
        );
      }
    }

    // Overshoot detection
    const targetValue = input.targetRestingValue ?? finalSample?.value ?? 1.0;
    const initialValue = inceptionSample?.value ?? 0.0;
    const range = Math.abs(targetValue - initialValue) || 1.0;

    let maxOvershoot = 0;
    for (const sample of samples) {
      if (targetValue >= initialValue) {
        if (sample.value > targetValue) {
          const excess = (sample.value - targetValue) / range;
          if (excess > maxOvershoot) maxOvershoot = excess;
        }
      } else {
        if (sample.value < targetValue) {
          const excess = (targetValue - sample.value) / range;
          if (excess > maxOvershoot) maxOvershoot = excess;
        }
      }
    }

    const bounceOvershootDetected = maxOvershoot > 0.01;
    if (
      bounceOvershootDetected &&
      !input.allowOvershoot &&
      input.easingType !== "spring" &&
      input.easingType !== "bouncy"
    ) {
      violations.push(
        `Unexpected bounce overshoot detected (${(maxOvershoot * 100).toFixed(1)}%) for non-spring easing '${input.easingType || "unknown"}'`,
      );
    }

    // Easing curve consistency check
    let easingCurveValid = true;
    if (inceptionSample && midpointSample && finalSample) {
      // For standard monotonic transitions, midpoint value should be between start and end
      if (!input.allowOvershoot && input.easingType !== "spring" && input.easingType !== "bouncy") {
        const isProgressive =
          (inceptionSample.value <= midpointSample.value &&
            midpointSample.value <= finalSample.value) ||
          (inceptionSample.value >= midpointSample.value &&
            midpointSample.value >= finalSample.value);

        if (!isProgressive) {
          easingCurveValid = false;
          violations.push(
            `Non-monotonic easing curve anomaly: Inception=${inceptionSample.value}, Midpoint=${midpointSample.value}, Final=${finalSample.value}`,
          );
        }
      }
    }

    return {
      animationName: input.animationName,
      passed: violations.length === 0,
      sampledInception0,
      sampledMidpoint50,
      sampledFinal100,
      easingCurveValid,
      bounceOvershootDetected,
      overshootRatio: maxOvershoot,
      blurArtifactDetected,
      violations,
    };
  }
}

// ============================================================================
// 3. Microcraft & Tactile Feedback Inspection
// ============================================================================
