import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSyntheticPngBuffer } from "../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import {
  analyzeDualChannel,
  validateCrossChannelConsistency,
  type ScreenshotMetadata,
  type VisualMetricsReport,
} from "../../../olt/scripts/src/validation/dual-channel-analyzer/index.ts";

describe("Dual-Channel Visual Analyzer - Malformed Dimensions", () => {
  describe("Negative & Malformed Coordinates / Dimensions", () => {
    test("handles NaN and negative orphan coordinates safely without throwing", () => {
      const domReport: VisualMetricsReport = {
        renderCacheReset: true,
        viewports: [
          {
            viewport: "mobile",
            width: 375,
            height: 667,
            orphanViolations: [
              { selector: "", x: NaN, y: -10, message: "Invalid coord" },
              { selector: ".stuck", x: 0, y: 0, message: "Stuck at 0,0" },
            ],
          },
          { viewport: "tablet", width: 768, height: 1024 },
          { viewport: "desktop", width: 1280, height: 800 },
        ],
      };

      const result = analyzeDualChannel({
        taskFiles: ["src/components/Badge.tsx"],
        domReport,
      });

      expect(result.passed).toBe(false);
      expect(
        result.findings.some((f) => f.category === "orphan" && f.message.includes("Malformed")),
      ).toBe(true);
      expect(
        result.findings.some((f) => f.category === "orphan" && f.affectedSelector === ".stuck"),
      ).toBe(true);
    });

    test("handles malformed dimensions in overflow, clipping, contrast, and stacking", () => {
      const domReport: VisualMetricsReport = {
        renderCacheReset: true,
        viewports: [
          {
            viewport: "mobile",
            width: 375,
            height: 667,
            overflowViolations: [
              {
                selector: "",
                viewport: "mobile",
                scrollWidth: NaN,
                clientWidth: 375,
                overflowX: NaN,
                message: "NaN overflow",
              },
            ],
            clippingViolations: [
              {
                selector: "",
                viewport: "mobile",
                scrollHeight: NaN,
                clientHeight: 20,
                message: "NaN clipping",
              },
            ],
          },
          {
            viewport: "tablet",
            width: 768,
            height: 1024,
            contrastViolations: [
              {
                selector: "",
                textColor: "",
                backgroundColor: "",
                contrastRatio: NaN,
                requiredRatio: 4.5,
                wcagLevel: "AA",
                message: "NaN contrast",
              },
            ],
            stackingViolations: [
              {
                topElementSelector: "",
                bottomElementSelector: "",
                viewport: "tablet",
                topZIndex: 1,
                bottomZIndex: 2,
                message: "Collision with blank selectors",
              },
            ],
          },
          { viewport: "desktop", width: 1280, height: 800 },
        ],
      };

      const result = analyzeDualChannel({
        taskFiles: ["src/components/Widget.tsx"],
        domReport,
      });

      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.category === "overflow")).toBe(true);
      expect(result.findings.some((f) => f.category === "clipping")).toBe(true);
      expect(result.findings.some((f) => f.category === "contrast")).toBe(true);
      expect(result.findings.some((f) => f.category === "stacking")).toBe(true);
    });

    test("rejects negative or NaN screenshot sizeBytes", () => {
      const result = analyzeDualChannel({
        taskFiles: ["src/components/Modal.tsx"],
        screenshots: [
          {
            name: "bad-mobile.png",
            path: "/screens/bad-mobile.png",
            sizeBytes: -100,
            viewport: "mobile",
          },
          {
            name: "nan-tablet.png",
            path: "/screens/nan-tablet.png",
            sizeBytes: NaN,
            viewport: "tablet",
          },
        ],
      });

      expect(result.passed).toBe(false);
      expect(
        result.findings.filter(
          (f) => f.category === "zero_byte_screenshot" || f.category === "invalid_screenshot_size",
        ),
      ).toHaveLength(2);
    });

    test("validateCrossChannelConsistency detects malformed / negative dimensions and mismatches", () => {
      const domReport: VisualMetricsReport = {
        renderCacheReset: true,
        viewports: [
          { viewport: "mobile", width: 375, height: 667 },
          { viewport: "tablet", width: -768, height: 1024 },
          { viewport: "desktop", width: 1280, height: 800 },
        ],
      };

      const screenshots: ScreenshotMetadata[] = [
        {
          name: "mobile.png",
          path: "/screens/mobile.png",
          viewport: "mobile",
          width: 375,
          height: 667,
          sizeBytes: 5000,
        },
        {
          name: "tablet.png",
          path: "/screens/tablet.png",
          viewport: "tablet",
          width: 768,
          height: 1024,
          sizeBytes: 12000,
        },
        {
          name: "desktop.png",
          path: "/screens/desktop.png",
          viewport: "desktop",
          width: 1920,
          height: 1080,
          sizeBytes: 25000,
        },
      ];

      const consistency = validateCrossChannelConsistency(domReport, screenshots);
      expect(consistency.consistent).toBe(false);
      expect(consistency.discrepancies.some((d) => d.includes("Malformed dimension"))).toBe(true);
      expect(consistency.discrepancies.some((d) => d.includes("Dimension mismatch"))).toBe(true);
    });
  });
});
