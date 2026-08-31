import { describe, expect, it } from "bun:test";
import {
  analyzeGlassSurfaces,
  validateModalFocusTrap,
  validateSubpixelBorders,
  computePhysicalViewportMetrics,
} from "../../../olt/scripts/src/heuristics/index.ts";

describe("heuristics subsystem unit tests", () => {
  it("exports core heuristic analyzers", () => {
    expect(typeof analyzeGlassSurfaces).toBe("function");
    expect(typeof validateModalFocusTrap).toBe("function");
    expect(typeof validateSubpixelBorders).toBe("function");
    expect(typeof computePhysicalViewportMetrics).toBe("function");
  });

  it("evaluates glass surface heuristics safely", () => {
    const report = analyzeGlassSurfaces([]);
    expect(report).toBeDefined();
    expect(report.defects).toEqual([]);
  });

  it("evaluates modal focus trap heuristics safely", () => {
    const report = validateModalFocusTrap({
      isOpen: false,
      modalSelector: "#modal",
      focusableNodes: [],
      focusSequence: [],
      outsideSiblings: [],
      bodyScroll: {},
    });
    expect(report).toBeDefined();
    expect(report.passed).toBe(true);
  });

  it("evaluates subpixel border heuristics safely", () => {
    const report = validateSubpixelBorders([]);
    expect(report).toBeDefined();
    expect(report.isCompliant).toBe(true);
    expect(report.defects).toEqual([]);
  });
});
