import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { validateCustom } from "../../../olt/scripts/src/capture/validator/custom/index.ts";
import type {
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../olt/scripts/src/capture/validator/types.ts";
import { cleanupVirtualRulesFS, setupVirtualRulesFS } from "../fixture.ts";

describe("Design Rule: Custom Pillar Aggregate Evaluator", () => {
  beforeEach(() => {
    setupVirtualRulesFS();
  });

  afterEach(() => {
    cleanupVirtualRulesFS();
  });

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

  it("handles sparse arrays containing undefined elements without crashing", () => {
    const sparseElements: (ElementPhysicsSnapshot | undefined)[] = [
      undefined,
      undefined,
      {
        selector: "div.clean",
        tagName: "DIV",
        bounds: { x: 50, y: 50, width: 100, height: 100 },
      },
      undefined,
    ];

    const ctx: ValidationContext = {
      screenId: "test-sparse",
      viewport: "desktop",
      elements: sparseElements as ElementPhysicsSnapshot[],
    };

    const res = validateCustom(ctx);
    expect(res.passed).toBe(true);
    expect(res.defects.length).toBe(0);
    expect(res.evaluatedCount).toBe(4);
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

  it("accumulates multiple defects originating from a single element violating multiple pillars", () => {
    const multiPillarElement: ElementPhysicsSnapshot = {
      selector: "dialog.floating-unconstrained-modal",
      tagName: "DIALOG",
      isFloating: true,
      bounds: { x: -20, y: -20, width: 200, height: 200 },
    };

    const ctx: ValidationContext = {
      screenId: "test-single-element-multi-pillar",
      viewport: "desktop",
      elements: [multiPillarElement],
    };

    const res = validateCustom(ctx);
    expect(res.passed).toBe(false);
    expect(res.defects.length).toBe(2);
    const categories = res.defects.map((d) => d.category);
    expect(categories).toContain("aria-focus-trap");
    expect(categories).toContain("floating-ui-collision");
    expect(res.evaluatedCount).toBe(1);
  });

  it("propagates custom viewportBounds to child floating collision validator", () => {
    const ctx: ValidationContext = {
      screenId: "test-viewport-propagation",
      viewport: "custom",
      viewportBounds: { width: 500, height: 400 },
      elements: [
        {
          selector: "div.popover-edge",
          tagName: "DIV",
          isFloating: true,
          bounds: { x: 420, y: 50, width: 100, height: 50 },
        },
      ],
    };

    const res = validateCustom(ctx);
    expect(res.passed).toBe(false);
    expect(res.defects.length).toBe(1);
    expect(res.defects[0]?.category).toBe("floating-ui-collision");
    expect(res.defects[0]?.message).toContain("right edge");
  });
});
