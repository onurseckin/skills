/**
 * Anti-stagnation heuristics and non-zero progress tracking for Mind Product Manager.
 * Enforces zero-delta silence, prevents idle loops, and triggers Socratic challenge prompts.
 */

import { createHash } from "node:crypto";
import type { AntiStagnationState } from "./types.ts";
import { readCognitiveMemory, updateCognitiveMemory } from "../../memory/core/index.ts";

export const CLOSING_FORBIDDEN_FOR_MIND = "CLOSING_FORBIDDEN_FOR_MIND" as const;
export const STAGNATION_DEFECT_CATEGORY = "stagnation_defect" as const;

export interface ProgressDeltaInput {
  readonly synthesizedCount: number;
  readonly enqueuedCount: number;
  readonly openDefectsCount: number;
  readonly feedbackCount: number;
  readonly hypothesisCount?: number | undefined;
  readonly previousSignature?: string | undefined;
}

export interface AntiStagnationOptions {
  readonly memoryPath?: string | undefined;
  readonly zeroDeltaThreshold?: number | undefined;
  readonly maintenanceThreshold?: number | undefined;
  readonly now?: string | number | Date | undefined;
  readonly previousState?: AntiStagnationState | undefined;
  readonly consecutiveZeroDeltaCycles?: number | undefined;
  readonly consecutiveMaintenanceCycles?: number | undefined;
  readonly persistToMemory?: boolean | undefined;
}

export function computeProgressSignature(input: ProgressDeltaInput): string {
  const hypothesisCount =
    input.hypothesisCount !== undefined && input.hypothesisCount !== null
      ? input.hypothesisCount
      : 0;
  const payload = [
    input.synthesizedCount,
    input.enqueuedCount,
    input.openDefectsCount,
    input.feedbackCount,
    hypothesisCount,
  ].join(":");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function assertStagnationUnsuppressed(state: AntiStagnationState): void {
  if (state.isStagnant) {
    if (!state.creativeStagnationDetected && !state.preplanningStagnationDetected) {
      throw new Error(
        "Stagnation invariant violation: isStagnant is true but both creative and preplanning flags are suppressed.",
      );
    }
  }
}

export function evaluateAntiStagnation(
  input: ProgressDeltaInput,
  options: AntiStagnationOptions = {},
): AntiStagnationState {
  const memory = readCognitiveMemory(options.memoryPath);
  const nowIso = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  const zeroDeltaThreshold =
    typeof options.zeroDeltaThreshold === "number" ? options.zeroDeltaThreshold : 3;
  const maintenanceThreshold =
    typeof options.maintenanceThreshold === "number" ? options.maintenanceThreshold : 3;

  const memoryContext =
    memory.context && typeof memory.context === "object" ? memory.context : undefined;
  const antiStagMem =
    memoryContext &&
    typeof memoryContext["anti_stagnation"] === "object" &&
    memoryContext["anti_stagnation"] !== null
      ? (memoryContext["anti_stagnation"] as Readonly<Record<string, unknown>>)
      : undefined;

  const prevZeroDelta =
    options.previousState !== undefined
      ? options.previousState.consecutiveZeroDeltaCycles
      : options.consecutiveZeroDeltaCycles !== undefined
        ? options.consecutiveZeroDeltaCycles
        : typeof antiStagMem?.["consecutiveZeroDeltaCycles"] === "number"
          ? (antiStagMem["consecutiveZeroDeltaCycles"] as number)
          : 0;

  const prevMaintenance =
    options.previousState !== undefined
      ? options.previousState.consecutiveMaintenanceCycles
      : options.consecutiveMaintenanceCycles !== undefined
        ? options.consecutiveMaintenanceCycles
        : typeof antiStagMem?.["consecutiveMaintenanceCycles"] === "number"
          ? (antiStagMem["consecutiveMaintenanceCycles"] as number)
          : 0;

  const prevSigFromMemory =
    typeof antiStagMem?.["lastSignature"] === "string"
      ? (antiStagMem["lastSignature"] as string)
      : undefined;
  const lastProgressFromMemory =
    typeof antiStagMem?.["lastNonZeroProgressTimestamp"] === "string"
      ? (antiStagMem["lastNonZeroProgressTimestamp"] as string)
      : undefined;

  const currentSig = computeProgressSignature(input);
  const prevSig =
    input.previousSignature !== undefined ? input.previousSignature : prevSigFromMemory;
  const isZeroDelta = prevSig !== undefined && currentSig === prevSig;

  const consecutiveZeroDeltaCycles = isZeroDelta ? prevZeroDelta + 1 : 0;
  const isMaintenance = input.synthesizedCount === 0 && input.enqueuedCount === 0;
  const consecutiveMaintenanceCycles = isMaintenance ? prevMaintenance + 1 : 0;

  const isCreativeStagnant =
    consecutiveZeroDeltaCycles >= zeroDeltaThreshold
      ? true
      : consecutiveMaintenanceCycles >= maintenanceThreshold;

  const isPreplanningStagnant =
    input.openDefectsCount > 0 && input.synthesizedCount === 0 && input.enqueuedCount === 0;

  const isStagnant = isCreativeStagnant ? true : isPreplanningStagnant;
  const resolvedLastProgress =
    lastProgressFromMemory !== undefined ? lastProgressFromMemory : memory.last_updated;
  const lastProgress = isZeroDelta ? resolvedLastProgress : nowIso;

  const progressiveScore = Math.max(
    0,
    100 -
      consecutiveZeroDeltaCycles * 20 -
      consecutiveMaintenanceCycles * 15 +
      input.synthesizedCount * 10,
  );

  const state: AntiStagnationState = {
    consecutiveZeroDeltaCycles,
    consecutiveMaintenanceCycles,
    lastNonZeroProgressTimestamp: lastProgress,
    isStagnant,
    creativeStagnationDetected: isCreativeStagnant,
    preplanningStagnationDetected: isPreplanningStagnant,
    activeHypothesisCount: Array.isArray(memory.active_hypotheses)
      ? memory.active_hypotheses.length
      : 0,
    progressiveScore,
  };

  assertStagnationUnsuppressed(state);

  if (options.persistToMemory !== false && options.memoryPath) {
    try {
      updateCognitiveMemory((curr) => {
        const currCtx = curr.context && typeof curr.context === "object" ? curr.context : {};
        const existingHypotheses = Array.isArray(curr.active_hypotheses)
          ? [...curr.active_hypotheses]
          : [];

        let updatedHypotheses = existingHypotheses;
        let updatedStrategic = Array.isArray(curr.strategic_focus) ? [...curr.strategic_focus] : [];

        if (isStagnant) {
          const stagnationHypId = isPreplanningStagnant
            ? "hyp-preplanning-stagnation-unsuppressed"
            : "hyp-creative-stagnation-unsuppressed";
          const stagnationStatement = isPreplanningStagnant
            ? `Active preplanning stagnation: ${input.openDefectsCount} open defect(s) unresolved with 0 tasks synthesized.`
            : `Active creative stagnation: ${consecutiveZeroDeltaCycles} zero-delta cycles, ${consecutiveMaintenanceCycles} maintenance cycles (threshold: ${maintenanceThreshold}).`;

          const filtered = existingHypotheses.filter((h) => h.id !== stagnationHypId);
          filtered.push({
            id: stagnationHypId,
            statement: stagnationStatement,
            confidence: 1.0,
            status: "active",
            evidence: [
              `Evaluated at ${nowIso} under CLOSING_FORBIDDEN_FOR_MIND.`,
              `Zero-delta cycles: ${consecutiveZeroDeltaCycles}, Maintenance cycles: ${consecutiveMaintenanceCycles}, Open defects: ${input.openDefectsCount}.`,
            ],
            created_at: nowIso,
            updated_at: nowIso,
          });
          updatedHypotheses = filtered;

          const unsuppressedNotice = `STAGNATION DEFECT (UNSUPPRESSED): ${stagnationStatement}`;
          updatedStrategic = updatedStrategic.some((s) => s.startsWith("STAGNATION DEFECT"))
            ? updatedStrategic.map((s) =>
                s.startsWith("STAGNATION DEFECT") ? unsuppressedNotice : s,
              )
            : [unsuppressedNotice, ...updatedStrategic];
        }

        return {
          ...curr,
          strategic_focus: updatedStrategic,
          active_hypotheses: updatedHypotheses,
          context: {
            ...currCtx,
            anti_stagnation: {
              consecutiveZeroDeltaCycles,
              consecutiveMaintenanceCycles,
              lastSignature: currentSig,
              lastNonZeroProgressTimestamp: lastProgress,
              isStagnant,
              creativeStagnationDetected: isCreativeStagnant,
              preplanningStagnationDetected: isPreplanningStagnant,
              lastEvaluatedAt: nowIso,
              defectSuppressed: false,
            },
          },
        };
      }, options.memoryPath);
    } catch {}
  }

  return state;
}

export function recordNonZeroProgress(
  stepSummary: string,
  _state: AntiStagnationState,
  options: {
    readonly memoryPath?: string | undefined;
    readonly charterGoals?: readonly string[] | undefined;
  } = {},
): void {
  try {
    updateCognitiveMemory((curr) => {
      const activeHypotheses = Array.isArray(curr.active_hypotheses)
        ? [...curr.active_hypotheses].filter(
            (h) =>
              h.id !== "hyp-preplanning-stagnation-unsuppressed" &&
              h.id !== "hyp-creative-stagnation-unsuppressed",
          )
        : [];
      const updatedHypotheses = activeHypotheses.map((h) => ({
        ...h,
        updated_at: new Date().toISOString(),
      }));

      const existingStrategic = Array.isArray(curr.strategic_focus)
        ? curr.strategic_focus.filter((s) => !s.startsWith("STAGNATION DEFECT"))
        : [];

      const currCtx = curr.context && typeof curr.context === "object" ? curr.context : {};

      return {
        ...curr,
        strategic_focus: [
          "Mode A Creative Product Manager Autonomous Expansion",
          "Continuous Invariant Hygiene (0 any, 0 suppressions, strict type soundness)",
          "Perpetual Product & UX Perfection across multi-tier viewports",
          "Radical First-Principles Simplification & Feature Synthesis",
          `Last Step: ${stepSummary}`,
          ...existingStrategic.filter(
            (s) =>
              !s.startsWith("Mode A") &&
              !s.startsWith("Continuous Invariant") &&
              !s.startsWith("Perpetual Product") &&
              !s.startsWith("Radical First") &&
              !s.startsWith("Last Step"),
          ),
        ],
        active_hypotheses: updatedHypotheses,
        last_updated: new Date().toISOString(),
        context: {
          ...currCtx,
          anti_stagnation: {
            consecutiveZeroDeltaCycles: 0,
            consecutiveMaintenanceCycles: 0,
            lastSignature: undefined,
            lastNonZeroProgressTimestamp: new Date().toISOString(),
            isStagnant: false,
            creativeStagnationDetected: false,
            preplanningStagnationDetected: false,
            lastEvaluatedAt: new Date().toISOString(),
            defectSuppressed: false,
          },
        },
      };
    }, options.memoryPath);
  } catch {}
}
