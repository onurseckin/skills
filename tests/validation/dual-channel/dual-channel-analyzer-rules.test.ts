import { afterAll, beforeAll, describe, expect, test, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createSyntheticPngBuffer } from "../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import {
  analyzeDualChannel,
  isUiScope,
  validateCompanionManifestCriteria,
  type DualChannelInput,
  type ScreenshotMetadata,
  type StructuredFinding,
  type VisualMetricsReport,
} from "../../../olt/scripts/src/validation/dual-channel-analyzer/index.ts";


describe("Dual-Channel Visual Analyzer - Rules & IHDR", () => {
  describe("Dual-Channel Gap Filling & Cross-Corroboration", () => {
    const cleanDomReport: VisualMetricsReport = {
      renderCacheReset: true,
      viewports: [
        { viewport: "mobile", width: 390, height: 844 },
        { viewport: "tablet", width: 768, height: 1024 },
        { viewport: "desktop", width: 1440, height: 900 },
      ],
    };

    let gapFillDir: string;
    let validScreenshots: ScreenshotMetadata[];

    beforeAll(() => {
      gapFillDir = mkdtempSync(join(tmpdir(), "dual-channel-gap-fill-"));
      const mobilePath = join(gapFillDir, "mobile.png");
      const tabletPath = join(gapFillDir, "tablet.png");
      const desktopPath = join(gapFillDir, "desktop.png");
      const mobileBuf = createSyntheticPngBuffer(390, 844, 5000);
      const tabletBuf = createSyntheticPngBuffer(768, 1024, 12000);
      const desktopBuf = createSyntheticPngBuffer(1440, 900, 25000);
      writeFileSync(mobilePath, mobileBuf);
      writeFileSync(tabletPath, tabletBuf);
      writeFileSync(desktopPath, desktopBuf);

      validScreenshots = [
        {
          name: "mobile.png",
          path: mobilePath,
          viewport: "mobile",
          width: 390,
          height: 844,
          sizeBytes: mobileBuf.byteLength,
        },
        {
          name: "tablet.png",
          path: tabletPath,
          viewport: "tablet",
          width: 768,
          height: 1024,
          sizeBytes: tabletBuf.byteLength,
        },
        {
          name: "desktop.png",
          path: desktopPath,
          viewport: "desktop",
          width: 1440,
          height: 900,
          sizeBytes: desktopBuf.byteLength,
        },
      ];
    });

    afterAll(() => {
      rmSync(gapFillDir, { recursive: true, force: true });
    });

    test("when screenshots missing -> DOM metrics fill gap (dom_gap_filled)", () => {
      const result = analyzeDualChannel({
        taskFiles: ["src/components/Navbar.tsx"],
        domReport: cleanDomReport,
        screenshots: [],
      });
      expect(result.passed).toBe(true);
      expect(result.mode).toBe("dom_gap_filled");
      expect(result.proofs).toHaveLength(3);
      expect(result.proofs.every((p) => p.status === "dom_only_gap_filled")).toBe(true);
    });

    test("when DOM metrics missing -> screenshots fill gap (screenshot_gap_filled)", () => {
      const result = analyzeDualChannel({
        taskFiles: ["src/components/Navbar.tsx"],
        domReport: null,
        screenshots: validScreenshots,
      });
      expect(result.passed).toBe(true);
      expect(result.mode).toBe("screenshot_gap_filled");
      expect(result.proofs).toHaveLength(3);
      expect(result.proofs.every((p) => p.status === "screenshot_only_gap_filled")).toBe(true);
    });

    test("when both channels present -> dual_channel_corroborated with cross-channel proofs", () => {
      const result = analyzeDualChannel({
        taskFiles: ["src/components/Navbar.tsx"],
        domReport: cleanDomReport,
        screenshots: validScreenshots,
      });
      expect(result.passed).toBe(true);
      expect(result.mode).toBe("dual_channel_corroborated");
      expect(result.proofs).toHaveLength(3);
      expect(result.proofs.every((p) => p.status === "corroborated")).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    test("surfaces a cross_channel_mismatch finding for each DOM/screenshot dimension discrepancy", () => {
      const mismatchedScreenshots: typeof validScreenshots = [
        { ...validScreenshots[0]!, width: 400 },
        validScreenshots[1]!,
        validScreenshots[2]!,
      ];

      const result = analyzeDualChannel({
        taskFiles: ["src/components/Navbar.tsx"],
        domReport: cleanDomReport,
        screenshots: mismatchedScreenshots,
      });

      expect(result.mode).toBe("dual_channel_corroborated");
      const mismatchFindings = result.findings.filter(
        (f) => f.category === "cross_channel_mismatch",
      );
      expect(mismatchFindings).toHaveLength(1);
      expect(mismatchFindings[0]?.message).toContain("Cross-Channel Discrepancy");
      expect(mismatchFindings[0]?.message).toContain("Dimension mismatch for viewport 'mobile'");
    });
  });
});

describe("Real PNG IHDR Anti-Mocking Verification", () => {
  const withTempDir = (run: (dir: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), "dual-channel-ihdr-"));
    try {
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("rejects a fabricated placeholder PNG whose real dimensions contradict its claimed viewport", () => {
    withTempDir((dir) => {
      const path = join(dir, "something-mobile.png");
      writeFileSync(path, createSyntheticPngBuffer(128, 128, 1200));

      const result = analyzeDualChannel({
        taskFiles: ["src/components/Foo.tsx"],
        requiredViewports: ["mobile"],
        screenshots: [{ name: "something-mobile.png", path, sizeBytes: 1200, viewport: "mobile" }],
      });

      expect(result.passed).toBe(false);
      expect(result.mode).toBe("rejected");
      const mismatch = result.findings.filter((f) => f.category === "invalid_screenshot_size");
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]?.message).toContain("128x128");
      expect(mismatch[0]?.message).toContain("390x844");
    });
  });

  test("passes a genuine 390x844 mobile screenshot verified against real IHDR bytes", () => {
    withTempDir((dir) => {
      const path = join(dir, "genuine-mobile.png");
      writeFileSync(path, createSyntheticPngBuffer(390, 844, 2000));

      const result = analyzeDualChannel({
        taskFiles: ["src/components/Foo.tsx"],
        requiredViewports: ["mobile"],
        screenshots: [{ name: "genuine-mobile.png", path, sizeBytes: 2000, viewport: "mobile" }],
      });

      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });
  });

  test("does not let a genuine mobile screenshot satisfy desktop coverage via a fabricated width metadata field", () => {
    withTempDir((dir) => {
      const path = join(dir, "split-brain-mobile.png");
      writeFileSync(path, createSyntheticPngBuffer(390, 844, 2000));

      const result = analyzeDualChannel({
        taskFiles: ["src/components/Foo.tsx"],
        requiredViewports: ["desktop"],
        screenshots: [
          {
            name: "split-brain-mobile.png",
            path,
            sizeBytes: 2000,
            viewport: "mobile",
            width: 1280,
          },
        ],
      });

      expect(result.passed).toBe(false);
      expect(result.mode).toBe("rejected");
      expect(result.findings.some((f) => f.category === "missing_viewport")).toBe(true);
      expect(result.findings.some((f) => f.category === "invalid_screenshot_size")).toBe(false);
    });
  });

  test("rejects a file that reports PNG-sized bytes but is not really a PNG", () => {
    withTempDir((dir) => {
      const path = join(dir, "fake-desktop.png");
      writeFileSync(path, Buffer.alloc(1200, 0x41));

      const result = analyzeDualChannel({
        taskFiles: ["src/components/Foo.tsx"],
        requiredViewports: ["desktop"],
        screenshots: [{ name: "fake-desktop.png", path, sizeBytes: 1200, viewport: "desktop" }],
      });

      expect(result.passed).toBe(false);
      const invalid = result.findings.filter((f) => f.category === "invalid_screenshot_size");
      expect(invalid.some((f) => f.message.includes("not a valid PNG image"))).toBe(true);
    });
  });

  test("rejects a screenshot naming a nonexistent path with fabricated metadata (does not satisfy coverage)", () => {
    const result = analyzeDualChannel({
      taskFiles: ["src/components/Foo.tsx"],
      requiredViewports: ["mobile"],
      screenshots: [
        {
          name: "unreachable-mobile.png",
          path: "/unreachable/unreachable-mobile.png",
          sizeBytes: 5000,
          viewport: "mobile",
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.mode).toBe("rejected");
    const unreadableFindings = result.findings.filter(
      (f) => f.category === "invalid_screenshot_size",
    );
    expect(unreadableFindings.length).toBeGreaterThan(0);
    expect(unreadableFindings.some((f) => f.message.includes("could not be opened"))).toBe(true);
    expect(result.findings.some((f) => f.category === "missing_viewport")).toBe(true);
  });
});

