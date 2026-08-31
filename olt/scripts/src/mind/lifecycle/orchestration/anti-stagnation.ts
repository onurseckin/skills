/**
 * Anti-stagnation heuristics and non-zero progress tracking for Mind Product Manager.
 * Enforces zero-delta silence, prevents idle loops, and triggers Socratic challenge prompts.
 */

import { createHash } from "node:crypto";
import type { AntiStagnationState } from "./types.ts";
import { readCognitiveMemory, updateCognitiveMemory } from "../../memory/core/index.ts";

export interface ProgressDeltaInput {
  readonly synthesizedCount: number;
  readonly enqueuedCount: number;
  readonly openDefectsCount: number;
  readonly feedbackCount: number;
  readonly hypothesisCount?: number | undefined;
  readonly previousSignature?: string | undefined;
}

export function computeProgressSignature(input: ProgressDeltaInput): string {
  const payload = [
    input.synthesizedCount,
    input.enqueuedCount,
    input.openDefectsCount,
    input.feedbackCount,
    input.hypothesisCount ?? 0,
  ].join(":");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function evaluateAntiStagnation(
  input: ProgressDeltaInput,
  options: {
    readonly memoryPath?: string | undefined;
    readonly zeroDeltaThreshold?: number | undefined;
    readonly maintenanceThreshold?: number | undefined;
    readonly now?: string | number | Date | undefined;
  } = {},
): AntiStagnationState {
  const memory = readCognitiveMemory(options.memoryPath);
  const nowIso = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  const zeroDeltaThreshold = options.zeroDeltaThreshold ?? 3;
  const maintenanceThreshold = options.maintenanceThreshold ?? 3;

  const currentSig = computeProgressSignature(input);
  const isZeroDelta =
    input.previousSignature !== undefined && currentSig === input.previousSignature;

  let zeroDeltaCycles = isZeroDelta ? 1 : 0;
  let maintenanceCycles = input.synthesizedCount === 0 && input.enqueuedCount === 0 ? 1 : 0;
  let lastProgress = isZeroDelta ? memory.last_updated : nowIso;

  const isCreativeStagnant =
    zeroDeltaCycles >= zeroDeltaThreshold || maintenanceCycles >= maintenanceThreshold;
  const isPreplanningStagnant =
    input.openDefectsCount > 0 && input.synthesizedCount === 0 && input.enqueuedCount === 0;

  const isStagnant = isCreativeStagnant || isPreplanningStagnant;
  const progressiveScore = Math.max(
    0,
    100 - zeroDeltaCycles * 20 - maintenanceCycles * 15 + input.synthesizedCount * 10,
  );

  return {
    consecutiveZeroDeltaCycles: zeroDeltaCycles,
    consecutiveMaintenanceCycles: maintenanceCycles,
    lastNonZeroProgressTimestamp: lastProgress,
    isStagnant,
    creativeStagnationDetected: isCreativeStagnant,
    preplanningStagnationDetected: isPreplanningStagnant,
    activeHypothesisCount: Array.isArray(memory.active_hypotheses)
      ? memory.active_hypotheses.length
      : 0,
    progressiveScore,
  };
}

export function recordNonZeroProgress(
  stepSummary: string,
  state: AntiStagnationState,
  options: {
    readonly memoryPath?: string | undefined;
    readonly charterGoals?: readonly string[] | undefined;
  } = {},
): void {
  try {
    updateCognitiveMemory((curr) => {
      const activeHypotheses = Array.isArray(curr.active_hypotheses)
        ? [...curr.active_hypotheses]
        : [];
      const updatedHypotheses = activeHypotheses.map((h) => ({
        ...h,
        updated_at: new Date().toISOString(),
      }));

      return {
        ...curr,
        strategic_focus: [
          "Mode A Creative Product Manager Autonomous Expansion",
          "Continuous Invariant Hygiene (0 any, 0 suppressions, strict type soundness)",
          "Perpetual Product & UX Perfection across multi-tier viewports",
          "Radical First-Principles Simplification & Feature Synthesis",
          `Last Step: ${stepSummary}`,
        ],
        active_hypotheses: updatedHypotheses,
        last_updated: new Date().toISOString(),
      };
    }, options.memoryPath);
  } catch {}
}
