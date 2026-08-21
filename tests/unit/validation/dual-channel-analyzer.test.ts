import { describe, expect, test } from "bun:test";
import {
  analyzeDualChannel,
  isUiScope,
  validateCrossChannelConsistency,
  type ScreenshotMetadata,
  type VisualMetricsReport,
} from "../../../orchestrating-long-tasks/scripts/src/validation/dual-channel-analyzer.ts";

describe("Dual-Channel Visual Analyzer", () => {
  describe("UI Scope Detection (isUiScope)", () => {
    test("detects UI file extensions (.tsx, .jsx, .vue, .svelte, .html, .css, .scss, .svg)", () => {
      expect(isUiScope(["src/Button.tsx"])).toBe(true);
      expect(isUiScope(["components/Header.jsx"])).toBe(true);
      expect(isUiScope(["app/App.vue"])).toBe(true);
      expect(isUiScope(["app/Widget.svelte"])).toBe(true);
      expect(isUiScope(["public/index.html"])).toBe(true);
      expect(isUiScope(["styles/main.css"])).toBe(true);
      expect(isUiScope(["styles/theme.scss"])).toBe(true);
      expect(isUiScope(["assets/logo.svg"])).toBe(true);
    });

    test("detects UI path patterns (components, views, pages, styles, ui, frontend, client, renderer, canvas, layout)", () => {
      expect(isUiScope(["src/components/button.ts"])).toBe(true);
      expect(isUiScope(["src/views/dashboard.ts"])).toBe(true);
      expect(isUiScope(["src/pages/home.ts"])).toBe(true);
      expect(isUiScope(["src/styles/theme.ts"])).toBe(true);
      expect(isUiScope(["src/ui/table.ts"])).toBe(true);
      expect(isUiScope(["packages/frontend/utils.ts"])).toBe(true);
      expect(isUiScope(["src/client/socket.ts"])).toBe(true);
      expect(isUiScope(["src/renderer/gl.ts"])).toBe(true);
      expect(isUiScope(["src/canvas/viewport.ts"])).toBe(true);
      expect(isUiScope(["src/layout/grid.ts"])).toBe(true);
    });

    test("returns false for non-UI backend and data files", () => {
      expect(isUiScope(["src/backend/server.ts"])).toBe(false);
      expect(isUiScope(["src/db/migrations/001_init.sql"])).toBe(false);
      expect(isUiScope(["src/services/auth.ts", "src/utils/math.ts"])).toBe(false);
      expect(isUiScope([])).toBe(false);
    });

    test("bypasses non-UI tasks in analyzeDualChannel", () => {
      const result = analyzeDualChannel({
        taskFiles: ["src/backend/service.ts"],
        writeScope: ["src/backend/**"],
      });
      expect(result.isUiTask).toBe(false);
      expect(result.passed).toBe(true);
      expect(result.mode).toBe("non_ui_skipped");
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("Automated UI Task Mandate & Anti-Mocking", () => {
    test("rejects UI task when both DOM metrics and screenshots channels are missing", () => {
      const result = analyzeDualChannel({
        taskFiles: ["src/components/Modal.tsx"],
      });
      expect(result.isUiTask).toBe(true);
      expect(result.passed).toBe(false);
      expect(result.mode).toBe("rejected");
      expect(result.findings.some((f) => f.category === "missing_channel")).toBe(true);
    });

    test("rejects 0-byte or stubbed screenshot captures", () => {
      const result = analyzeDualChannel({
        taskFiles: ["src/components/Modal.tsx"],
        screenshots: [
          {
            name: "desktop.png",
            path: "/screens/desktop.png",
            sizeBytes: 0,
            viewport: "desktop",
          },
        ],
      });
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.category === "zero_byte_screenshot" || f.category === "invalid_screenshot_size")).toBe(true);
    });

    test("rejects when required multi-viewport matrix (mobile, tablet, desktop) is incomplete", () => {
      const result = analyzeDualChannel({
        taskFiles: ["src/components/Modal.tsx"],
        screenshots: [
          {
            name: "desktop.png",
            path: "/screens/desktop.png",
            sizeBytes: 1024,
            viewport: "desktop",
          },
        ],
      });
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.category === "missing_viewport")).toBe(true);
    });
  });

  describe("Subpixel Overflow Boundary Tolerances", () => {
    test("ignores subpixel overflow < tolerance (0.5px default) and flags >= tolerance", () => {
      const domReportSubpixel: VisualMetricsReport = {
        renderCacheReset: true,
        viewports: [
          {
            viewport: "mobile",
            width: 375,
            height: 667,
            overflowViolations: [
              {
                selector: ".subpixel-item",
                viewport: "mobile",
                scrollWidth: 375.3,
                clientWidth: 375,
                overflowX: 0.3,
                message: "Subpixel rounding 0.3px",
              },
            ],
          },
          {
            viewport: "tablet",
            width: 768,
            height: 1024,
            overflowViolations: [
              {
                selector: ".real-overflow-item",
                viewport: "tablet",
                scrollWidth: 770,
                clientWidth: 768,
                overflowX: 2.0,
                message: "Significant overflow 2px",
              },
            ],
          },
          { viewport: "desktop", width: 1280, height: 800 },
        ],
      };

      const result = analyzeDualChannel({
        taskFiles: ["src/components/List.tsx"],
        domReport: domReportSubpixel,
      });

      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.affectedSelector === ".subpixel-item")).toBe(false);
      expect(result.findings.some((f) => f.affectedSelector === ".real-overflow-item")).toBe(true);
    });

    test("respects custom subpixelTolerance configuration", () => {
      const domReport: VisualMetricsReport = {
        renderCacheReset: true,
        subpixelTolerance: 1.0,
        viewports: [
          {
            viewport: "mobile",
            width: 375,
            height: 667,
            overflowViolations: [
              {
                selector: ".item-08",
                viewport: "mobile",
                scrollWidth: 375.8,
                clientWidth: 375,
                overflowX: 0.8,
                message: "0.8px overflow",
              },
            ],
          },
          { viewport: "tablet", width: 768, height: 1024 },
          { viewport: "desktop", width: 1280, height: 800 },
        ],
      };

      const result = analyzeDualChannel({
        taskFiles: ["src/components/List.tsx"],
        domReport,
        subpixelTolerance: 1.0,
      });

      expect(result.passed).toBe(true);
      expect(result.findings.some((f) => f.affectedSelector === ".item-08")).toBe(false);
    });
  });

  describe("Dual-Channel Gap Filling & Cross-Corroboration", () => {
    const cleanDomReport: VisualMetricsReport = {
      renderCacheReset: true,
      viewports: [
        { viewport: "mobile", width: 375, height: 667 },
        { viewport: "tablet", width: 768, height: 1024 },
        { viewport: "desktop", width: 1280, height: 800 },
      ],
    };

    const validScreenshots: ScreenshotMetadata[] = [
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
        width: 1280,
        height: 800,
        sizeBytes: 25000,
      },
    ];

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
