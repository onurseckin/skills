/**
 * @file efficiency-scorer.ts
 * Mathematical quantitative efficiency scoring engine (0.0% - 100.0%) with itemized deductions.
 */

import type {
  BehavioralForensicsIncident,
  QuantitativeDeduction,
  QuantitativeEfficiencyReport,
} from "./types.ts";

export interface EfficiencyScoringInput {
  readonly incidents?: readonly BehavioralForensicsIncident[] | undefined;
  readonly totalToolCalls?: number | undefined;
  readonly fileReadCount?: number | undefined;
  readonly fileWriteCount?: number | undefined;
  readonly readToWriteRatio?: number | undefined;
  readonly pollingCallsCount?: number | undefined;
  readonly sequentialWaveBottlenecks?: number | undefined;
  readonly contextOverflowCount?: number | undefined;
}

export function calculateForensicsEfficiencyScore(
  input: EfficiencyScoringInput,
): QuantitativeEfficiencyReport {
  const incidents = input.incidents ?? [];
  const deductions: QuantitativeDeduction[] = [];
  const baseline = 100.0;
  let runningScore = baseline;

  for (const inc of incidents) {
    let penalty = 0;
    if (inc.severity === "CRITICAL") penalty = 25.0;
    else if (inc.severity === "HIGH") penalty = 15.0;
    else if (inc.severity === "MEDIUM") penalty = 8.0;
    else if (inc.severity === "LOW") penalty = 3.0;

    if (penalty > 0) {
      runningScore -= penalty;
      deductions.push({
        reason: `${inc.severity} incident in ${inc.category}: ${inc.title}`,
        pointsDeducted: penalty,
        category: inc.category,
      });
    }
  }

  const writeCount = input.fileWriteCount ?? 0;
  const readCount = input.fileReadCount ?? 0;
  const ratio =
    typeof input.readToWriteRatio === "number"
      ? input.readToWriteRatio
      : writeCount > 0
        ? readCount / writeCount
        : 0;

  if (ratio > 15.0) {
    const penalty = Math.min(20.0, Math.round((ratio - 15.0) * 1.5 * 10) / 10);
    runningScore -= penalty;
    deductions.push({
      reason: `Read-to-write ratio (${ratio.toFixed(1)}) exceeded threshold (15.0)`,
      pointsDeducted: penalty,
      category: "EFFICIENCY_RATIO",
    });
  }

  const pollingCalls = input.pollingCallsCount ?? 0;
  if (pollingCalls > 5) {
    const penalty = Math.min(15.0, Math.round((pollingCalls - 5) * 2.0 * 10) / 10);
    runningScore -= penalty;
    deductions.push({
      reason: `Polling calls count (${pollingCalls}) exceeded zero-polling tolerance threshold`,
      pointsDeducted: penalty,
      category: "POLLING",
    });
  }

  const bottlenecks = input.sequentialWaveBottlenecks ?? 0;
  if (bottlenecks > 0) {
    const penalty = Math.min(15.0, Math.round(bottlenecks * 5.0 * 10) / 10);
    runningScore -= penalty;
    deductions.push({
      reason: `Detected ${bottlenecks} sequential wave bottleneck(s) on disjoint tasks`,
      pointsDeducted: penalty,
      category: "BOTTLENECK",
    });
  }

  const rawScore = runningScore;
  const boundedScore = Math.max(0.0, Math.min(100.0, Math.round(rawScore * 10) / 10));
  const formattedScore = `${boundedScore.toFixed(1)}%`;

  return {
    rawScore,
    boundedScore,
    formattedScore,
    percentage: boundedScore,
    deductions,
    baseline,
  };
}
