import { describe, expect, it } from "bun:test";
import { validateCustom } from "../../../olt/scripts/src/capture/validator/custom/index.ts";
import type {
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Custom Pillar Aggregate (validateCustom)", () => {
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

  it("handles undefined slots and accumulates all custom defects across elements", () => {
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
      screenId: "custom_screen",
      viewport: "desktop",
      elements: elements as unknown as ElementPhysicsSnapshot[],
    };

    const res = validateCustom(ctx);
    expect(res.pillar).toBe("custom");
    expect(res.passed).toBe(false);
    expect(res.evaluatedCount).toBe(elements.length);
    expect(res.defects.length).toBe(5);

    const categories = res.defects.map((d) => d.category);
    expect(categories).toContain("aria-focus-trap");
    expect(categories).toContain("floating-ui-collision");
    expect(categories).toContain("md3-state-layers");
    expect(categories).toContain("apple-hig-tracking");
    expect(categories).toContain("geist-tokens");
  });
});
