import { createHash } from "node:crypto";

export interface MindAntiStagnationConfig {
  readonly zeroDeltaThreshold: number;
  readonly maintenanceThreshold: number;
  readonly targetCadenceSeconds: number;
  readonly enableAutonomousInit: boolean;
}

export interface StagnationMetrics {
  readonly synthesizedCount: number;
  readonly enqueuedCount: number;
  readonly openDefectsCount: number;
  readonly feedbackCount: number;
  readonly previousSignature?: string;
}

export interface AntiStagnationEvaluation {
  readonly signature: string;
  readonly isStagnant: boolean;
  readonly zeroDeltaCycles: number;
  readonly progressiveScore: number;
  readonly actionRecommended: "continue" | "socratic_challenge" | "force_sync";
}

export interface AutonomousInitResult {
  readonly initialized: boolean;
  readonly activeEngines: readonly string[];
  readonly initialSignature: string;
  readonly timestamp: string;
}

const DEFAULT_CONFIG: MindAntiStagnationConfig = {
  zeroDeltaThreshold: 3,
  maintenanceThreshold: 3,
  targetCadenceSeconds: 60,
  enableAutonomousInit: true,
};

export function computeStagnationSignature(metrics: StagnationMetrics): string {
  const parts = [
    metrics.synthesizedCount,
    metrics.enqueuedCount,
    metrics.openDefectsCount,
    metrics.feedbackCount,
  ];
  return createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 16);
}

export function evaluateAntiStagnationState(
  metrics: StagnationMetrics,
  config?: MindAntiStagnationConfig,
): AntiStagnationEvaluation {
  const cfg = config !== undefined ? config : DEFAULT_CONFIG;
  const signature = computeStagnationSignature(metrics);
  const isZeroDelta =
    metrics.previousSignature !== undefined && metrics.previousSignature === signature;
  const zeroDeltaCycles = isZeroDelta ? 1 : 0;
  const isStagnant = zeroDeltaCycles >= cfg.zeroDeltaThreshold;
  const scoreBase = 100 - zeroDeltaCycles * 30 + metrics.synthesizedCount * 10;
  const progressiveScore = Math.max(0, Math.min(100, scoreBase));

  let actionRecommended: "continue" | "socratic_challenge" | "force_sync" = "continue";
  if (isStagnant) {
    actionRecommended = "socratic_challenge";
  } else if (metrics.openDefectsCount > 5) {
    actionRecommended = "force_sync";
  }

  return {
    signature,
    isStagnant,
    zeroDeltaCycles,
    progressiveScore,
    actionRecommended,
  };
}

export function runAutonomousInitialization(
  config?: MindAntiStagnationConfig,
): AutonomousInitResult {
  const cfg = config !== undefined ? config : DEFAULT_CONFIG;
  const initialMetrics: StagnationMetrics = {
    synthesizedCount: 0,
    enqueuedCount: 0,
    openDefectsCount: 0,
    feedbackCount: 0,
  };
  const initialSignature = computeStagnationSignature(initialMetrics);
  const engines = ["anti-stagnation", "cognitive-memory", "pareto-arbitration"];
  return {
    initialized: cfg.enableAutonomousInit,
    activeEngines: engines,
    initialSignature,
    timestamp: new Date().toISOString(),
  };
}
