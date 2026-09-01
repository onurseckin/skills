import { HarnessError } from "../../../core/errors/index.ts";
import { computeSha256, type ImmutabilityManifest } from "../locks/index.ts";
import type {
  SocraticRoundNumber,
  CognitiveChallenge,
  InterRoundAuditResult,
  CollateralDefect,
} from "./types.ts";

export class InterRoundRegressionAuditor {
  /**
   * Audits the current state payload against all sealed upstream milestone manifests
   * to detect any collateral defects or unauthorized regressions.
   */
  public auditStateRegressions(
    currentRound: SocraticRoundNumber,
    currentStatePayload: Record<string, unknown>,
    sealedManifests: readonly ImmutabilityManifest[],
  ): InterRoundAuditResult {
    const collateralDefects: CollateralDefect[] = [];
    const violatedRoundsSet = new Set<number>();

    for (const manifest of sealedManifests) {
      if (manifest.roundNumber >= currentRound) {
        continue;
      }

      // Check each sealed property in the manifest state snapshot
      const sealedSnapshot = manifest.statePayloadSnapshot;
      if (!sealedSnapshot) continue;

      for (const [key, sealedVal] of Object.entries(sealedSnapshot)) {
        // If the key is present in current state and differs from sealed value
        if (key in currentStatePayload) {
          const currentVal = currentStatePayload[key];
          const sealedValHash = computeSha256(sealedVal);
          const currentValHash = computeSha256(currentVal);

          if (sealedValHash !== currentValHash) {
            // Find which scope this key falls under
            const matchingScope =
              manifest.sealedScope.find((s: string) => key.startsWith(s) || s.startsWith(key)) ??
              manifest.sealedScope[0] ??
              "general.scope";

            const defect: CollateralDefect = {
              defectId: `defect-r${manifest.roundNumber}-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
              upstreamRoundNumber: manifest.roundNumber,
              upstreamScope: matchingScope,
              currentRoundNumber: currentRound,
              propertyKey: key,
              sealedValue: sealedVal,
              currentValue: currentVal,
              severity: "HIGH",
              description: `Collateral Regression Detected: Property '${key}' was sealed in Round ${manifest.roundNumber} ("${manifest.roundName}") but was modified in Round ${currentRound}.`,
            };

            collateralDefects.push(defect);
            violatedRoundsSet.add(manifest.roundNumber);
          }
        }
      }
    }

    const hasRegressions = collateralDefects.length > 0;
    const regressionScore = hasRegressions ? Math.min(1.0, collateralDefects.length * 0.25) : 0.0;
    const violatedMilestoneRounds = Array.from(violatedRoundsSet).sort((a, b) => a - b);

    return {
      hasRegressions,
      collateralDefects,
      regressionScore,
      violatedMilestoneRounds,
      auditedAt: new Date().toISOString(),
    };
  }
}

/**
 * ============================================================================
 * 8. Pareto Arbitration Engine
 * ============================================================================
 */
