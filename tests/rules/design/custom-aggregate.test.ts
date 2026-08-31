import { describe, expect, it } from "bun:test";
import { validateCustom } from "../../../olt/scripts/src/capture/validator/custom/index.ts";
import type {
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Design Rule: Custom Pillar Aggregate Evaluator", () => {
  it("evaluates empty elements list cleanly", () => {
    const ctx: ValidationContext = {
      screenId: "test",
      viewport: "desktop",
      elements: [],
    };
    const res = validateCustom(ctx);
    expect(res.pillar).toBe("custom");
    expect(res.passed).toBe(true);
    expect(res.defects.length).toBe(0);
    expect(res.evaluatedCount).toBe(0);
  });

  it("accumulates custom defects across multiple elements", () => {
    const elements: (ElementPhysicsSnapshot | undefined)[] = [
      undefined,
      {
        selector: "dialog.modal",
        tagName: "DIALOG",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
      {
        selector: "div.popover-overflow",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: -10, y: 0, width: 100, height: 100 },
      },
      {
        selector: "button.md3-bad",
        tagName: "BUTTON",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        stateLayers: { hover: 0.5 },
      },
      {
        selector: "h1.apple-bad",
        tagName: "H1",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: {
          fontSize: 12,
          letterSpacing: 2.0,
          fontFamily: "SF Pro Text",
        },
      },
      {
        selector: "div.geist-bad",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: {
          fontFamily: "Geist Sans",
          borderRadius: 7,
        },
      },
    ];

    const ctx: ValidationContext = {
      screenId: "test-multidefect",
      viewport: "desktop",
      elements: elements as ElementPhysicsSnapshot[],
    };

    const res = validateCustom(ctx);
    expect(res.passed).toBe(false);
    expect(res.defects.length).toBe(5);
    expect(res.evaluatedCount).toBe(6);
  });
});
