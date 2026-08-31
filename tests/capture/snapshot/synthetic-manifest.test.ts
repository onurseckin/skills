import { describe, expect, it } from "bun:test";
import { synthesizeCompanionManifest } from "../../../olt/scripts/src/capture/validator/index.ts";
import { createSyntheticPngBuffer } from "../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";

describe("Companion Manifest Synthesis & 4-Pillar Criteria", () => {
  it("synthesizes criteria covering all 4 mandatory pillars for clean elements", () => {
    const manifest = synthesizeCompanionManifest({
      screenId: "dashboard",
      viewport: "desktop",
      elements: [
        {
          selector: "button.primary-btn",
          tagName: "BUTTON",
          text: "Submit Action",
          bounds: { x: 100, y: 100, width: 120, height: 48 },
          computedStyles: {
            color: "#ffffff",
            backgroundColor: "#000000",
            fontSize: 16,
            fontWeight: 600,
            borderRadius: 8,
          },
          interactive: true,
          isTouchTarget: true,
          implementedStates: ["default", "hover", "active", "focus"],
        },
      ],
      viewportBounds: { width: 1440, height: 900 },
    });

    expect(manifest.version).toBe("2.0");
    expect(manifest.screenId).toBe("dashboard");
    expect(manifest.viewport).toBe("desktop");
    expect(manifest.criteria.length).toBeGreaterThanOrEqual(4);

    const pillarSet = new Set(manifest.criteria.map((c) => c.pillar));
    expect(pillarSet.has("mechanical")).toBe(true);
    expect(pillarSet.has("cognitive")).toBe(true);
    expect(pillarSet.has("product")).toBe(true);
    expect(pillarSet.has("ux")).toBe(true);

    for (const c of manifest.criteria) {
      expect(typeof c.passed).toBe("boolean");
      expect(typeof c.details).toBe("string");
      expect(c.details.trim().length).toBeGreaterThan(0);
      expect(typeof c.evidence).toBe("string");
      expect(c.evidence.trim().length).toBeGreaterThan(0);
      expect(c.id).toMatch(/^CRIT-(MECH|COGN|PROD|CUST|UX)-/);
    }
  });

  it("createSyntheticPngBuffer generates a valid PNG buffer >= 1024 bytes", () => {
    const buf = createSyntheticPngBuffer(10, 10, 1024);
    expect(buf.byteLength).toBeGreaterThanOrEqual(1024);

    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
    expect(buf[4]).toBe(0x0d);
    expect(buf[5]).toBe(0x0a);
    expect(buf[6]).toBe(0x1a);
    expect(buf[7]).toBe(0x0a);

    const last12 = buf.subarray(buf.byteLength - 12);
    expect(last12.toString("ascii", 4, 8)).toBe("IEND");
  });
});
