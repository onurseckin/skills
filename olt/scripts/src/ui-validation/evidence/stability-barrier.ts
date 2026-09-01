import { createHmac } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";
import type {
  CompositeArtifactKey,
  ArtifactMetadata,
  OpticalStabilityInput,
  OpticalStabilityResult,
} from "./types.ts";
import { CompositeKeyParser } from "./composite-key-parser.ts";
export class OpticalStabilityBarrier {
  private static readonly TOKEN_SECRET = "optical-stability-barrier-token-secret-v1";
  public readonly minQuiescenceMs: number;

  public constructor(minQuiescenceMs: number = 500) {
    this.minQuiescenceMs = minQuiescenceMs;
  }

  /**
   * Generates an HMAC-signed readiness token
   */
  public generateReadinessToken(keyString: string, timestamp: number): string {
    const data = `${keyString}:${timestamp}`;
    const hmac = createHmac("sha256", OpticalStabilityBarrier.TOKEN_SECRET)
      .update(data)
      .digest("hex")
      .slice(0, 32);
    return `ost_${timestamp}_${hmac}`;
  }

  /**
   * Verifies the authenticity and freshness of a readiness token
   */
  public verifyReadinessToken(
    token: string,
    keyString: string,
    maxAgeMs: number = 60000,
  ): boolean {
    if (!token || !token.startsWith("ost_")) {
      return false;
    }

    const parts = token.split("_");
    if (parts.length !== 3) return false;

    const tsPart = parts[1];
    if (!tsPart) return false;

    const timestamp = parseInt(tsPart, 10);
    if (isNaN(timestamp)) return false;

    const age = Math.abs(Date.now() - timestamp);
    if (age > maxAgeMs) {
      return false;
    }

    const expected = this.generateReadinessToken(keyString, timestamp);
    return token === expected;
  }

  /**
   * Evaluates the 3-factor optical stability barrier
   */
  public evaluateStability(
    keyString: string,
    input: OpticalStabilityInput,
  ): OpticalStabilityResult {
    if (!input) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Optical stability input must not be undefined or null",
      );
    }

    const failureReasons: string[] = [];
    const minQuiescence = input.minQuiescenceMs ?? this.minQuiescenceMs;

    // Factor 1: Network Quiescence
    const networkSettled =
      input.inFlightRequests === 0 &&
      input.networkQuiescenceDurationMs >= minQuiescence;
    if (input.inFlightRequests > 0) {
      failureReasons.push(
        `Network active: ${input.inFlightRequests} in-flight HTTP/WebSocket requests`,
      );
    } else if (input.networkQuiescenceDurationMs < minQuiescence) {
      failureReasons.push(
        `Network quiescence duration (${input.networkQuiescenceDurationMs}ms) below required window (${minQuiescence}ms)`,
      );
    }

    // Factor 2: Font & Asset Settling
    const fontAndAssetsSettled =
      input.fontsReady && input.unrenderedAssetCount === 0;
    if (!input.fontsReady) {
      failureReasons.push("Document fonts (document.fonts.ready) not yet resolved");
    }
    if (input.unrenderedAssetCount > 0) {
      failureReasons.push(
        `${input.unrenderedAssetCount} unrendered/loading images, SVGs, or media assets`,
      );
    }

    // Factor 3: CSS Animation / Layout Settling
    const layoutAndAnimationsSettled =
      input.activeAnimationsCount === 0 && input.layoutShiftDelta <= 0.001;
    if (input.activeAnimationsCount > 0) {
      failureReasons.push(
        `${input.activeAnimationsCount} running CSS transitions or keyframe animations`,
      );
    }
    if (input.layoutShiftDelta > 0.001) {
      failureReasons.push(
        `Layout shift delta (${input.layoutShiftDelta.toFixed(4)}) exceeds stability threshold (0.001)`,
      );
    }

    // Calculate score (0.0 - 1.0)
    let score = 0;
    if (networkSettled) score += 0.35;
    if (fontAndAssetsSettled) score += 0.35;
    if (layoutAndAnimationsSettled) score += 0.3;

    const stable = score >= 0.99 && failureReasons.length === 0;
    const readinessToken = stable
      ? this.generateReadinessToken(keyString, Date.now())
      : undefined;

    return {
      stable,
      readinessScore: Number(score.toFixed(2)),
      networkSettled,
      fontAndAssetsSettled,
      layoutAndAnimationsSettled,
      ...(readinessToken !== undefined ? { readinessToken } : {}),
      failureReasons,
    };
  }
}

// ============================================================================
// 3. Three-Tier Visual Evidence Lifecycle Architecture
// ============================================================================

