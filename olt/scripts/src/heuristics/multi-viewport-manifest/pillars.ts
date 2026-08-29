/**
 * @file pillars.ts
 * Mandatory validation pillars and normalization
 */

import type { MandatoryPillar } from "./types.ts";

/**
 * Normalizes pillar identifier to standard lowercase form.
 */
export function normalizePillar(rawPillar?: string): MandatoryPillar | null {
  if (!rawPillar) return null;
  const lower = rawPillar.trim().toLowerCase();
  if (lower === "mechanical" || lower === "mech") return "mechanical";
  if (lower === "cognitive" || lower === "cogn") return "cognitive";
  if (lower === "product" || lower === "prod") return "product";
  if (
    lower === "ux" ||
    lower === "ux ergonomics" ||
    lower === "ux_ergonomics" ||
    lower === "ux-ergonomics"
  ) {
    return "ux";
  }
  return null;
}
