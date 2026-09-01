import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSyntheticPngBuffer } from "../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import {
  analyzeDualChannel,
  type ScreenshotMetadata,
  type VisualMetricsReport,
} from "../../../olt/scripts/src/validation/dual-channel-analyzer/index.ts";
import {
  cleanupVirtualValidationFS,
  scratchRoot,
  setupVirtualValidationFS,
} from "../validation-fixture.ts";

describe("Dual-Channel Visual Analyzer - Viewport Normalization", () => {
  beforeEach(() => {
    setupVirtualValidationFS();
  });

  afterEach(() => {
    cleanupVirtualValidationFS();
  });

  describe("Viewport Normalization & Custom Viewports", () => {
    test("covers custom, non-canonical required viewports (4k, iphone15) only when real measured PNG bytes corroborate the self-reported dimensions", () => {
      const dir = scratchRoot("dual-channel-custom-viewport", "custom");
      const fourKPath = join(dir, "4k.png");
      const iphonePath = join(dir, "iphone15.png");
      writeFileSync(fourKPath, createSyntheticPngBuffer(3840, 2160, 2000));
      writeFileSync(iphonePath, createSyntheticPngBuffer(393, 852, 2000));

      const screenshots: ScreenshotMetadata[] = [
        {
          name: "4k.png",
          path: fourKPath,
          viewport: "4k",
          width: 3840,
          height: 2160,
          sizeBytes: 2000,
        },
        {
          name: "iphone15.png",
          path: iphonePath,
          viewport: "iphone15",
          width: 393,
          height: 852,
          sizeBytes: 2000,
        },
      ];

      const result = analyzeDualChannel({
        taskFiles: ["src/components/Header.tsx"],
        screenshots,
        requiredViewports: ["4k", "iphone15"],
      });

      expect(result.passed).toBe(true);
      expect(result.mode).toBe("screenshot_gap_filled");
      expect(result.findings).toHaveLength(0);
    });

    test("rejects a custom-viewport screenshot whose self-reported dimensions contradict its real measured PNG bytes (4k label on a 50x50 image)", () => {
      const dir = scratchRoot("dual-channel-custom-viewport-bypass", "bypass");
      const path = join(dir, "fake-4k.png");
      writeFileSync(path, createSyntheticPngBuffer(50, 50, 2000));

      const result = analyzeDualChannel({
        taskFiles: ["src/components/Header.tsx"],
        requiredViewports: ["4k"],
        screenshots: [
          {
            name: "fake-4k.png",
            path,
            viewport: "4k",
            width: 3840,
            height: 2160,
            sizeBytes: 2000,
          },
        ],
      });

      expect(result.passed).toBe(false);
      expect(result.mode).toBe("rejected");
      expect(result.proofs.some((p) => p.status === "screenshot_only_gap_filled")).toBe(false);
      const mismatch = result.findings.filter((f) => f.category === "invalid_screenshot_size");
      expect(mismatch.length).toBeGreaterThan(0);
      expect(mismatch.some((f) => f.message.includes("50x50"))).toBe(true);
      expect(mismatch.some((f) => f.message.includes("3840x2160"))).toBe(true);
    });

    test("rejects a custom-viewport screenshot claim with no self-reported dimensions to cross-check against real measured bytes", () => {
      const dir = scratchRoot("dual-channel-custom-viewport-unverifiable", "unverifiable");
      const path = join(dir, "unlabeled-4k.png");
      writeFileSync(path, createSyntheticPngBuffer(3840, 2160, 2000));

      const result = analyzeDualChannel({
        taskFiles: ["src/components/Header.tsx"],
        requiredViewports: ["4k"],
        screenshots: [
          {
            name: "unlabeled-4k.png",
            path,
            viewport: "4k",
            sizeBytes: 2000,
          },
        ],
      });

      expect(result.passed).toBe(false);
      expect(result.mode).toBe("rejected");
      const mismatch = result.findings.filter((f) => f.category === "invalid_screenshot_size");
      expect(mismatch.some((f) => f.message.includes("no self-reported width/height"))).toBe(true);
    });

    test("detects missing custom required viewport", () => {
      const domReport: VisualMetricsReport = {
        renderCacheReset: true,
        viewports: [{ viewport: "desktop", width: 1280, height: 800 }],
      };

      const result = analyzeDualChannel({
        taskFiles: ["src/components/Header.tsx"],
        domReport,
        requiredViewports: ["desktop", "ultrawide"],
      });

      expect(result.passed).toBe(false);
      expect(
        result.findings.some(
          (f) => f.category === "missing_viewport" && f.viewport === "ultrawide",
        ),
      ).toBe(true);
    });
  });
});
