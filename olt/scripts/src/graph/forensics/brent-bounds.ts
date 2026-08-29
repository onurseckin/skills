import type { BrentsBoundResult } from "./types.ts";

export function calculateBrentsTheorem(
  totalWorkOrOptions:
    | number
    | {
        readonly totalWork: number;
        readonly criticalSpan: number;
        readonly availableProcessors?: number | undefined;
        readonly processorCount?: number | undefined;
      },
  criticalSpanArg?: number,
  processorCountArg?: number,
): BrentsBoundResult {
  const isObj = typeof totalWorkOrOptions === "object" && totalWorkOrOptions !== null;
  const rawWork = isObj ? totalWorkOrOptions.totalWork : totalWorkOrOptions;
  const rawSpan = isObj ? totalWorkOrOptions.criticalSpan : criticalSpanArg;
  const rawP = isObj
    ? (totalWorkOrOptions.availableProcessors ?? totalWorkOrOptions.processorCount ?? 1)
    : processorCountArg;

  const p = Math.max(1, Math.floor(typeof rawP === "number" ? rawP : 1));
  const W = Math.max(0, typeof rawWork === "number" ? rawWork : 0);
  const S = Math.max(1, typeof rawSpan === "number" ? rawSpan : 1);

  const lowerBound = Math.max(Math.ceil(W / p), S);
  const upperBound = Math.floor((W - S) / p) + S;
  const estimatedTime = Math.max(
    lowerBound,
    Math.min(upperBound, Math.round(W / p + S * (1 - 1 / p))),
  );
  const theoreticalSpeedup = estimatedTime > 0 ? Math.round((W / estimatedTime) * 100) / 100 : 0;
  const rawEfficiency = p > 0 && estimatedTime > 0 ? W / (p * estimatedTime) : 0;
  const theoreticalEfficiency = Math.round(rawEfficiency * 100) / 100;

  return {
    processorCount: p,
    lowerBound,
    upperBound,
    estimatedTime,
    theoreticalDuration: upperBound,
    speedup: theoreticalSpeedup,
    theoreticalSpeedup,
    efficiency: rawEfficiency,
    theoreticalEfficiency,
  };
}
