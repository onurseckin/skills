import type { ContrastStandard, ContrastEvaluation } from "./types.ts";

export function resolveIsLargeText(
  isLarge?: boolean | undefined,
  fontSize?: number | undefined,
  fontWeight?: number | string | undefined,
): boolean {
  if (typeof isLarge === "boolean") return isLarge;
  const size = typeof fontSize === "number" ? fontSize : 16;
  const isBold =
    typeof fontWeight === "number"
      ? fontWeight >= 600
      : typeof fontWeight === "string"
        ? fontWeight === "bold" ||
          fontWeight === "bolder" ||
          fontWeight === "semibold" ||
          fontWeight === "semi-bold" ||
          parseInt(fontWeight, 10) >= 600
        : false;

  if (size >= 24) return true;
  if (size >= 18.66 && isBold) return true;
  if (size >= 16 && isBold) return true;
  return false;
}

export function getRequiredThreshold(standard: ContrastStandard, isLargeText: boolean): number {
  switch (standard) {
    case "wcag-aa":
      return isLargeText ? 3.0 : 4.5;
    case "wcag-aaa":
      return isLargeText ? 4.5 : 7.0;
    case "apca":
      return isLargeText ? 60.0 : 75.0;
  }
}

export function evaluateSingleStandard(
  standard: ContrastStandard,
  wcagRatio: number,
  apcaLc: number,
  isLargeText: boolean,
): ContrastEvaluation {
  const requiredThreshold = getRequiredThreshold(standard, isLargeText);
  let passed = false;
  let note: string;

  if (standard === "wcag-aa" || standard === "wcag-aaa") {
    passed = wcagRatio >= requiredThreshold;
    note = `Required CR ≥ ${requiredThreshold.toFixed(1)}:1 (${isLargeText ? "Large" : "Normal"} text), Measured: ${wcagRatio.toFixed(2)}:1`;
  } else {
    passed = Math.abs(apcaLc) >= requiredThreshold;
    note = `Required |Lc| ≥ ${requiredThreshold.toFixed(1)} (${isLargeText ? "Large" : "Normal"} text), Measured: ${Math.abs(apcaLc).toFixed(1)}`;
  }

  return {
    standard,
    contrastRatio: standard === "apca" ? Math.abs(apcaLc) : wcagRatio,
    requiredThreshold,
    passed,
    score: standard === "apca" ? Math.abs(apcaLc) : wcagRatio,
    note,
  };
}
