import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

function isFractional(val: number): boolean {
  const frac = Math.abs(val % 1);
  return frac > 0.05 && frac < 0.95;
}

function extractTranslateFractions(transformStr?: string): readonly number[] {
  if (!transformStr || transformStr === "none") return [];
  const fractions: number[] = [];

  const matrixMatch = transformStr.match(/matrix\(([^)]+)\)/);
  if (matrixMatch && matrixMatch[1]) {
    const parts = matrixMatch[1].split(",").map((p) => parseFloat(p.trim()));
    const p4 = parts[4];
    const p5 = parts[5];
    if (p4 !== undefined && !isNaN(p4) && isFractional(p4)) fractions.push(p4);
    if (p5 !== undefined && !isNaN(p5) && isFractional(p5)) fractions.push(p5);
  }

  const translateMatch = transformStr.match(/translate(?:3d)?\(\s*([\d.-]+)(?:px)?\s*,\s*([\d.-]+)(?:px)?/);
  if (translateMatch && translateMatch[1] && translateMatch[2]) {
    const x = parseFloat(translateMatch[1]);
    const y = parseFloat(translateMatch[2]);
    if (!isNaN(x) && isFractional(x)) fractions.push(x);
    if (!isNaN(y) && isFractional(y)) fractions.push(y);
  }

  return fractions;
}

export function validateSubpixelSnapping(
  element: ElementPhysicsSnapshot,
  index: number
): ValidationDefect | null {
  const { x, y, width, height } = element.bounds;
  const transformFractions = extractTranslateFractions(element.computedStyles?.transform);

  const fractionalValues: string[] = [];

  if (isFractional(x)) fractionalValues.push(`x=${x.toFixed(2)}px`);
  if (isFractional(y)) fractionalValues.push(`y=${y.toFixed(2)}px`);
  if (isFractional(width)) fractionalValues.push(`width=${width.toFixed(2)}px`);
  if (isFractional(height)) fractionalValues.push(`height=${height.toFixed(2)}px`);
  for (const tf of transformFractions) {
    fractionalValues.push(`transform=${tf.toFixed(2)}px`);
  }

  if (fractionalValues.length > 0) {
    return {
      id: `mech-subpixel-${index}`,
      pillar: "mechanical",
      category: "subpixel-snapping",
      elementSelector: element.selector,
      message: `Element exhibits fractional subpixel positioning (${fractionalValues.join(", ")}), causing subpixel rendering blur.`,
      severity: "minor",
      remediations: generateRemediations("subpixel-snapping"),
      metadata: {
        fractionalValues: fractionalValues.join(", "),
      },
    };
  }

  return null;
}
