import {
  applyIntervalJitter,
  calculateDeterministicInterval,
} from "../../core/scheduling/index.ts";
import { integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";


export { schedEvalCommand, executeSchedEval } from "./sched-eval.ts";
export { schedBackoffCommand, executeSchedBackoff } from "./sched-backoff.ts";

export function schedJitterCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const rawIntervalMs =
    integerFlag(flags, "interval") ??
    integerFlag(flags, "interval-ms") ??
    integerFlag(flags, "raw-interval-ms") ??
    1000;
  const jitterRatioStr = textFlag(flags, "jitter-ratio", false);
  const jitterRatio = jitterRatioStr !== undefined ? Number(jitterRatioStr) : undefined;
  const minRatioStr = textFlag(flags, "min-ratio", false);
  const minRatio = minRatioStr !== undefined ? Number(minRatioStr) : undefined;
  const maxRatioStr = textFlag(flags, "max-ratio", false);
  const maxRatio = maxRatioStr !== undefined ? Number(maxRatioStr) : undefined;
  const minIntervalMs = integerFlag(flags, "min-interval") ?? integerFlag(flags, "min-interval-ms");
  const maxIntervalMs = integerFlag(flags, "max-interval") ?? integerFlag(flags, "max-interval-ms");
  const seed = integerFlag(flags, "seed");

  const intervalMs =
    seed !== undefined
      ? calculateDeterministicInterval(rawIntervalMs, seed, {
          jitterRatio,
          minRatio,
          maxRatio,
          minIntervalMs,
          maxIntervalMs,
        })
      : applyIntervalJitter(rawIntervalMs, {
          jitterRatio,
          minRatio,
          maxRatio,
          minIntervalMs,
          maxIntervalMs,
        });

  return {
    intervalMs,
    rawIntervalMs,
    jitteredIntervalMs: intervalMs,
  };
}
