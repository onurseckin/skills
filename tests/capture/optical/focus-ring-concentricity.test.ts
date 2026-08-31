import { describe, expect, it } from "bun:test";
import {
  calculateConcentricRadius,
  validateNestedConcentricCorners,
} from "../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/concentricity.ts";

describe("Focus Ring Optical Engine: Concentricity", () => {
  it("calculateConcentricRadius computes outer radius correctly and clamps negative results", () => {
    expect(calculateConcentricRadius(8, 4)).toBe(12);
    expect(calculateConcentricRadius(0, 4)).toBe(4);
    expect(calculateConcentricRadius(-5, 2)).toBe(0);
    expect(calculateConcentricRadius(8, -12)).toBe(0);
  });

  it("validateNestedConcentricCorners validates concentric corners and reports optical compensation", () => {
    const resPass = validateNestedConcentricCorners(12, 8, 4, 1.0);
    expect(resPass.isConcentric).toBe(true);
    expect(resPass.delta).toBe(0);
    expect(resPass.expectedOuterRadius).toBe(12);
    expect(resPass.opticalCorrection).toBeCloseTo((Math.SQRT2 - 1) * 4, 3);
    expect(resPass.details).toContain("Corners are concentric within tolerance");

    const resFail = validateNestedConcentricCorners(8, 8, 4, 1.0);
    expect(resFail.isConcentric).toBe(false);
    expect(resFail.delta).toBe(4);
    expect(resFail.details).toContain("Concentric corner mismatch");

    const resZeroPad = validateNestedConcentricCorners(8, 8, 0, 1.0);
    expect(resZeroPad.opticalCorrection).toBe(0);
  });
});
