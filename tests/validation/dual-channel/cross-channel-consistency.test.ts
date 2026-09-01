import { afterEach, describe, expect, test } from "bun:test";
import {
  normalizeViewportName,
  validateCrossChannelConsistency,
} from "../../../olt/scripts/src/validation/channels/cross-channel-consistency.ts";
import type {
  ScreenshotMetadata,
  VisualMetricsReport,
} from "../../../olt/scripts/src/validation/channels/dual-channel-types.ts";
import {
  cleanupVirtualValidationFS,
  createMockDualChannelFinding,
  createMockFeedbackItem,
  createMockPngBuffer,
  createMockTaskRecord,
  createSandboxDir,
  scratchRoot,
} from "../validation-fixture.ts";

afterEach(() => {
  cleanupVirtualValidationFS();
});

describe("normalizeViewportName", () => {
  test("falls back to width-based classification when the name is blank or absent", () => {
    expect(normalizeViewportName("", 375)).toBe("mobile");
    expect(normalizeViewportName("   ", 800)).toBe("tablet");
    expect(normalizeViewportName(undefined, 1920)).toBe("desktop");
    expect(normalizeViewportName(undefined, 3000)).toBe("ultrawide");
  });

  test("gives up as 'unknown' when neither a name nor a usable width is available", () => {
    expect(normalizeViewportName(undefined, undefined)).toBe("unknown");
    expect(normalizeViewportName("", Number.NaN)).toBe("unknown");
    expect(normalizeViewportName("   ", -10)).toBe("unknown");
  });

  test("prefers a real measured width over a misleading name when both are present", () => {
    expect(normalizeViewportName("desktop-preview.png", 375)).toBe("mobile");
    expect(normalizeViewportName("mobile-thumbnail.png", 1280)).toBe("desktop");
    expect(normalizeViewportName("tablet-shot.png", 3000)).toBe("ultrawide");
  });

  test("falls back to name-based classification only when width is unusable", () => {
    expect(normalizeViewportName("desktop-preview.png", undefined)).toBe("desktop");
    expect(normalizeViewportName("desktop-preview.png", Number.NaN)).toBe("desktop");
    expect(normalizeViewportName("desktop-preview.png", -1)).toBe("desktop");
  });
});

describe("validateCrossChannelConsistency", () => {
  test("flags a DOM-reported viewport with no matching screenshot, dimensions unknown", () => {
    const domReport: VisualMetricsReport = {
      viewports: [{ viewport: "mobile" }],
    };
    const consistency = validateCrossChannelConsistency(domReport, []);
    expect(consistency.consistent).toBe(false);
    expect(consistency.discrepancies).toHaveLength(1);
    expect(consistency.discrepancies[0]).toContain("dimensions unknown");
    expect(consistency.discrepancies[0]).toContain("no matching screenshot was captured");
  });

  test("flags a captured screenshot whose viewport has no DOM metrics counterpart", () => {
    const domReport: VisualMetricsReport = { viewports: [] };
    const screenshots: ScreenshotMetadata[] = [
      { name: "tablet.png", path: "/screens/tablet.png", viewport: "tablet", sizeBytes: 100 },
    ];
    const consistency = validateCrossChannelConsistency(domReport, screenshots);
    expect(consistency.consistent).toBe(false);
    expect(consistency.discrepancies).toEqual([
      "Screenshot captured for viewport 'tablet' but DOM metrics report lacks corresponding viewport metrics",
    ]);
  });

  test("is consistent when every DOM viewport has a same-sized matching screenshot", () => {
    const domReport: VisualMetricsReport = {
      viewports: [{ viewport: "desktop", width: 1280, height: 800 }],
    };
    const screenshots: ScreenshotMetadata[] = [
      {
        name: "desktop.png",
        path: "/screens/desktop.png",
        viewport: "desktop",
        width: 1280,
        height: 800,
        sizeBytes: 500,
      },
    ];
    expect(validateCrossChannelConsistency(domReport, screenshots)).toEqual({
      consistent: true,
      discrepancies: [],
    });
  });

  test("in-memory validation fixture helpers create valid RAM structures", () => {
    const png = createMockPngBuffer(10, 10);
    expect(png.length).toBeGreaterThan(0);
    expect(png[0]).toBe(137); // PNG signature magic byte

    const fb = createMockFeedbackItem({ feedback: "test feedback" });
    expect(fb.feedback).toBe("test feedback");
    expect(fb.status).toBe("pending");

    const task = createMockTaskRecord({ priority: "critical" });
    expect(task.priority).toBe("critical");
    expect(task.id).toBe("task-001");

    const finding = createMockDualChannelFinding({ ruleId: "TEST_RULE" });
    expect(finding.ruleId).toBe("TEST_RULE");
    expect(finding.channel).toBe("headless");

    const root = scratchRoot(import.meta.path, "test");
    expect(typeof root).toBe("string");
    const sandbox = createSandboxDir("test-sandbox");
    expect(typeof sandbox).toBe("string");
  });
});
