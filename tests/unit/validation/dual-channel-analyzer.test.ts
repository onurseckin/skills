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
      expect(
        result.findings.some(
          (f) => f.category === "zero_byte_screenshot" || f.category === "invalid_screenshot_size",
        ),
      ).toBe(true);
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

    test("rejects a DOM report entry that claims a standard band viewport by name alone with no measured width", () => {
      const domReport: VisualMetricsReport = {
        renderCacheReset: true,
        viewports: [
          { viewport: "mobile" },
          { viewport: "tablet", width: 768, height: 1024 },
          { viewport: "desktop", width: 1280, height: 800 },
        ],
      };

      const result = analyzeDualChannel({
        taskFiles: ["src/components/Modal.tsx"],
        domReport,
      });

      expect(result.passed).toBe(false);
      expect(
        result.findings.some((f) => f.category === "missing_viewport" && f.viewport === "mobile"),
      ).toBe(true);
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

describe("Companion Manifest 4-Pillar Criteria Enforcement", () => {
  const findingsCollector = () => {
    const findings: StructuredFinding[] = [];
    const addFinding = (
      category: StructuredFinding["category"],
      severity: StructuredFinding["severity"],
      message: string,
      remediation: string,
      affectedSelector?: string,
      viewport?: string,
    ) => {
      findings.push({
        id: `VF-${findings.length + 1}`,
        category,
        severity,
        message,
        remediation,
        ...(affectedSelector !== undefined ? { affectedSelector } : {}),
        ...(viewport !== undefined ? { viewport } : {}),
      });
    };
    return { findings, addFinding };
  };

  it("validates a compliant companion manifest covering all 4 mandatory pillars", () => {
    const manifest = {
      schema: "companion.manifest.v1",
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          name: "APCA Contrast",
          passed: true,
          details: "All text elements meet APCA Lc lightness contrast thresholds.",
          evidence: "Evaluated 25 text nodes with 0 violations.",
        },
        {
          id: "CRIT-COGN-FITTS",
          pillar: "cognitive",
          name: "Fitts's Law Target Acquisition",
          passed: true,
          details: "Primary call to action targets maintain ID <= 5.5.",
          evidence: "Average target acquisition ID = 3.2.",
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          name: "Geist Design System Tokens",
          passed: true,
          details: "Typography, spacing, and borders adhere to token scales.",
          evidence: "Validated 42 token usages.",
        },
        {
          id: "CRIT-UX-FOCUS-TRAP",
          pillar: "ux",
          name: "WAI-ARIA Focus Trap",
          passed: true,
          details: "Modal and dialog containers constrain tab cycle traversal.",
          evidence: "Verified keyboard navigation focus cycling.",
        },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding);

    expect(outcome.valid).toBe(true);
    expect(outcome.evaluatedCriteriaCount).toBe(4);
    expect(outcome.passedCriteriaCount).toBe(4);
    expect(findings.filter((f) => f.severity === "error")).toHaveLength(0);
  });

  it("rejects companion manifest if any of the 4 mandatory pillars is missing", () => {
    const manifestMissingUx = {
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          passed: true,
          details: "Pass",
          evidence: "Evidence",
        },
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Pass",
          evidence: "Evidence",
        },
        {
          id: "CRIT-PROD-GEIST",
          pillar: "product",
          passed: true,
          details: "Pass",
          evidence: "Evidence",
        },
        // UX Ergonomics pillar missing!
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifestMissingUx, addFinding);

    expect(outcome.valid).toBe(false);
    const pillarErrors = findings.filter((f) => f.category === "missing_pillar_criteria");
    expect(pillarErrors.length).toBeGreaterThanOrEqual(1);
    expect(pillarErrors.some((f) => f.message.includes("UX Ergonomics"))).toBe(true);
  });

  it("rejects criteria missing explicit boolean passed property", () => {
    const manifest = {
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          // missing passed!
          details: "Pass",
          evidence: "Evidence",
        },
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Pass",
          evidence: "Ev",
        },
        { id: "CRIT-PROD-GEIST", pillar: "product", passed: true, details: "Pass", evidence: "Ev" },
        { id: "CRIT-UX-FOCUS", pillar: "ux", passed: true, details: "Pass", evidence: "Ev" },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding);

    expect(outcome.valid).toBe(false);
    const critErrors = findings.filter((f) => f.category === "invalid_manifest_criterion");
    expect(critErrors.some((f) => f.message.includes("Missing explicit boolean 'passed'"))).toBe(
      true,
    );
  });

  it("rejects criteria with empty details and empty evidence", () => {
    const manifest = {
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        { id: "CRIT-MECH-APCA", pillar: "mechanical", passed: true, details: "", evidence: "   " },
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Pass",
          evidence: "Ev",
        },
        { id: "CRIT-PROD-GEIST", pillar: "product", passed: true, details: "Pass", evidence: "Ev" },
        { id: "CRIT-UX-FOCUS", pillar: "ux", passed: true, details: "Pass", evidence: "Ev" },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding);

    expect(outcome.valid).toBe(false);
    const critErrors = findings.filter((f) => f.category === "invalid_manifest_criterion");
    expect(critErrors.some((f) => f.message.includes("non-empty 'details' or 'evidence'"))).toBe(
      true,
    );
  });

  it("rejects manifest if any criterion failed (passed: false)", () => {
    const manifest = {
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          passed: false,
          details: "APCA contrast Lc=38.2 below required threshold 60.0",
          evidence: "Contrast failure on selector .btn-secondary",
        },
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Pass",
          evidence: "Ev",
        },
        { id: "CRIT-PROD-GEIST", pillar: "product", passed: true, details: "Pass", evidence: "Ev" },
        { id: "CRIT-UX-FOCUS", pillar: "ux", passed: true, details: "Pass", evidence: "Ev" },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding);

    expect(outcome.valid).toBe(false);
    const failedErrors = findings.filter((f) => f.category === "manifest_criterion_failed");
    expect(failedErrors).toHaveLength(1);
    expect(failedErrors[0]?.message).toContain("CRIT-MECH-APCA");
  });
});

describe("Semantic Depth Quality Checks & requireSemanticDepth Enforcement", () => {
  const findingsCollector = () => {
    const findings: StructuredFinding[] = [];
    const addFinding = (
      category: StructuredFinding["category"],
      severity: StructuredFinding["severity"],
      message: string,
      remediation: string,
      affectedSelector?: string,
      viewport?: string,
    ) => {
      findings.push({
        id: `VF-${findings.length + 1}`,
        category,
        severity,
        message,
        remediation,
        ...(affectedSelector !== undefined ? { affectedSelector } : {}),
        ...(viewport !== undefined ? { viewport } : {}),
      });
    };
    return { findings, addFinding };
  };

  it("detects boilerplate details and superficial evidence under requireSemanticDepth", () => {
    const manifest = {
      screenId: "checkout",
      viewport: "mobile",
      criteria: [
        {
          id: "CRIT-MECH-OVERFLOW",
          pillar: "mechanical",
          passed: true,
          details: "ok", // boilerplate
          evidence: "375px width verified without horizontal scroll",
        },
        {
          id: "CRIT-COGN-THUMB",
          pillar: "cognitive",
          passed: true,
          details: "Thumb zone", // < 12 characters (superficial)
          evidence: "passed", // boilerplate
        },
        {
          id: "CRIT-PROD-BRAND",
          pillar: "product",
          passed: true,
          details: "Verified brand color palette tokens",
          evidence: "Looks good to reviewer", // missing quantitative metric numbers
        },
        {
          id: "CRIT-UX-CONTRAST",
          pillar: "ux",
          passed: true,
          details: "Evaluated interactive button states",
          evidence: "4.5:1 ratio", // valid with quantitative metric
        },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding, {
      requireSemanticDepth: true,
    });

    expect(outcome.valid).toBe(false);
    expect(
      findings.some(
        (f) => f.category === "boilerplate_evidence" && f.message.includes("CRIT-MECH-OVERFLOW"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "superficial_evidence" && f.message.includes("CRIT-COGN-THUMB"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "boilerplate_evidence" && f.message.includes("CRIT-COGN-THUMB"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "missing_evidence_metrics" && f.message.includes("CRIT-PROD-BRAND"),
      ),
    ).toBe(true);
  });

  it("validates cognitiveAnalysis.questions for superficial rationale and missing metrics", () => {
    const manifest = {
      screenId: "settings",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          passed: true,
          details: "APCA lightness contrast exceeds required Lc thresholds.",
          evidence: "Evaluated 12 text surfaces; min Lc = 78.4.",
        },
        {
          id: "CRIT-COGN-FITTS",
          pillar: "cognitive",
          passed: true,
          details: "Fitts Law index of difficulty complies with target bounds.",
          evidence: "Evaluated 8 buttons; min size = 48x48px.",
        },
        {
          id: "CRIT-PROD-DESIGN",
          pillar: "product",
          passed: true,
          details: "Design system spacing tokens conform to 8pt spatial grid.",
          evidence: "100% of padding uses 8px/16px/24px steps.",
        },
        {
          id: "CRIT-UX-KEYBOARD",
          pillar: "ux",
          passed: true,
          details: "Keyboard accessibility preserves visible focus rings.",
          evidence: "Tab index traversal verified across 15 interactive elements.",
        },
      ],
      cognitiveAnalysis: {
        questions: [
          {
            id: "Q-PERC-01-JTBD-ANCHOR",
            passed: true,
            observation: "Good anchor", // < 12 characters -> superficial_evidence
            evidence: "1 headline element detected with font-size 28px.",
          },
          {
            id: "Q-ERGO-02-FITTS",
            passed: true,
            observation: "Interactive targets maintain comfortable touch floor above 44px.",
            evidence: "checked", // boilerplate evidence
          },
          {
            id: "Q-TYPO-01-CONTRAST",
            passed: true,
            observation: "ok", // boilerplate observation
            evidence: "All text elements pass with 100% compliance.",
          },
          {
            id: "Q-RESI-01-STATES",
            passed: true,
            observation: "Interactive state transitions provide immediate tactile visual response.",
            evidence: "No issues with state transitions", // missing metrics
          },
        ],
      },
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding, {
      requireSemanticDepth: true,
    });

    expect(outcome.valid).toBe(false);
    expect(
      findings.some(
        (f) => f.category === "superficial_evidence" && f.message.includes("Q-PERC-01-JTBD-ANCHOR"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "boilerplate_evidence" && f.message.includes("Q-ERGO-02-FITTS"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "boilerplate_evidence" && f.message.includes("Q-TYPO-01-CONTRAST"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "missing_evidence_metrics" && f.message.includes("Q-RESI-01-STATES"),
      ),
    ).toBe(true);
  });

  it("passes analyzeDualChannel when requireSemanticDepth is active and manifests provide deep quantitative proof", () => {
    const semanticDepthDir = mkdtempSync(join(tmpdir(), "dual-channel-semantic-depth-"));
    const desktopPath = join(semanticDepthDir, "header-desktop.png");
    const tabletPath = join(semanticDepthDir, "header-tablet.png");
    const mobilePath = join(semanticDepthDir, "header-mobile.png");
    const desktopBuf = createSyntheticPngBuffer(1440, 900, 4096);
    const tabletBuf = createSyntheticPngBuffer(768, 1024, 3072);
    const mobileBuf = createSyntheticPngBuffer(390, 844, 2048);
    writeFileSync(desktopPath, desktopBuf);
    writeFileSync(tabletPath, tabletBuf);
    writeFileSync(mobilePath, mobileBuf);

    const input: DualChannelInput = {
      writeScope: ["src/components/Header.tsx"],
      requireSemanticDepth: true,
      screenshots: [
        {
          name: "header-desktop.png",
          path: desktopPath,
          viewport: "desktop",
          sizeBytes: desktopBuf.byteLength,
        },
        {
          name: "header-tablet.png",
          path: tabletPath,
          viewport: "tablet",
          sizeBytes: tabletBuf.byteLength,
        },
        {
          name: "header-mobile.png",
          path: mobilePath,
          viewport: "mobile",
          sizeBytes: mobileBuf.byteLength,
        },
      ],
      manifests: [
        {
          screenId: "header",
          viewport: "desktop",
          criteria: [
            {
              id: "CRIT-MECH-APCA",
              pillar: "mechanical",
              passed: true,
              details: "All navigation links exceed WCAG AAA and APCA lightness contrast criteria.",
              evidence: "Tested 6 text nodes; contrast ratio = 8.2:1 with lightness Lc = 85.3.",
            },
            {
              id: "CRIT-COGN-CHUNKS",
              pillar: "cognitive",
              passed: true,
              details:
                "Navigation menu groups links into 4 distinct semantic items under Cowan limit.",
              evidence: "Total of 4 primary navigation clusters counted across 1280px canvas.",
            },
            {
              id: "CRIT-PROD-TOKENS",
              pillar: "product",
              passed: true,
              details:
                "Header typography styles adhere strictly to Design System font-size tokens.",
              evidence: "Verified 16px body font and 24px title against token scales.",
            },
            {
              id: "CRIT-UX-FOCUS",
              pillar: "ux",
              passed: true,
              details: "Focus-visible ring outline renders with 2px blue offset on tab navigation.",
              evidence: "Keyboard focus traversal validated across 6 elements with 2px outlines.",
            },
          ],
          cognitiveAnalysis: {
            questions: [
              {
                id: "Q-PERC-01-JTBD-ANCHOR",
                passed: true,
                observation:
                  "Primary focal brand anchor is immediately recognizable within first 2.0s glance.",
                evidence: "Logo anchor bounds 180x48px at coordinate (24, 16) in 1280px viewport.",
              },
            ],
          },
        },
      ],
    };

    try {
      const result = analyzeDualChannel(input);
      expect(result.isUiTask).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.findings.filter((f) => f.severity === "error")).toHaveLength(0);
    } finally {
      rmSync(semanticDepthDir, { recursive: true, force: true });
    }
  });

  it("fails analyzeDualChannel when requireSemanticDepth is active and manifest has superficial details", () => {
    const input: DualChannelInput = {
      writeScope: ["src/components/Header.tsx"],
      requireSemanticDepth: true,
      screenshots: [
        {
          name: "header-desktop.png",
          path: "/tmp/header-desktop.png",
          viewport: "desktop",
          sizeBytes: 4096,
        },
        {
          name: "header-tablet.png",
          path: "/tmp/header-tablet.png",
          viewport: "tablet",
          sizeBytes: 3072,
        },
        {
          name: "header-mobile.png",
          path: "/tmp/header-mobile.png",
          viewport: "mobile",
          sizeBytes: 2048,
        },
      ],
      manifests: [
        {
          screenId: "header",
          viewport: "desktop",
          criteria: [
            {
              id: "CRIT-MECH-APCA",
              pillar: "mechanical",
              passed: true,
              details: "pass", // superficial boilerplate!
              evidence: "8.2:1 ratio",
            },
            {
              id: "CRIT-COGN-CHUNKS",
              pillar: "cognitive",
              passed: true,
              details: "ok", // superficial boilerplate!
              evidence: "4 items",
            },
            {
              id: "CRIT-PROD-TOKENS",
              pillar: "product",
              passed: true,
              details: "valid", // superficial boilerplate!
              evidence: "16px token",
            },
            {
              id: "CRIT-UX-FOCUS",
              pillar: "ux",
              passed: true,
              details: "done", // superficial boilerplate!
              evidence: "2px outline",
            },
          ],
        },
      ],
    };

    const result = analyzeDualChannel(input);
    expect(result.isUiTask).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.mode).toBe("rejected");
    const boilerplateFindings = result.findings.filter(
      (f) => f.category === "boilerplate_evidence",
    );
    expect(boilerplateFindings.length).toBeGreaterThanOrEqual(4);
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies dual-channel test and source files contain zero any and zero suppressions", () => {
    const filesToAudit = [
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/types.ts",
      ),
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/file-classifier.ts",
      ),
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/semantic-depth.ts",
      ),
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/manifest-auditor.ts",
      ),
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/cross-proof.ts",
      ),
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/analyzer.ts",
      ),
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/index.ts",
      ),
      resolve(import.meta.dir, "dual-channel-analyzer.test.ts"),
    ];

    const anyPattern = /:\s*any\b|as\s+any\b|<any>/;
    const suppressionPattern = new RegExp(
      "@ts-" +
        "ignore|@ts-" +
        "expect-error|@ts-" +
        "nocheck|eslint-" +
        "disable|oxlint-" +
        "disable",
    );

    for (const filePath of filesToAudit) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Skip comment lines in invariant check itself
        if (
          line.includes("anyPattern") ||
          line.includes("suppressionPattern") ||
          line.includes("new RegExp")
        )
          continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});

describe("Ultra-Lean Packet Invariants & Fake Completion Purging Verification", () => {
  it("verifies sanitizeLeanContext purges fake completion assumptions and heavy metadata blobs", async () => {
    const { sanitizeLeanContext } =
      await import("../../../olt/scripts/src/packets/validator-context.ts");
    expect(typeof sanitizeLeanContext).toBe("function");

    const payload = {
      clean_field: "valid_value",
      assumed_complete: true,
      assumed_completion: "fake_success",
      fake_completion: "done_without_proof",
      historical_completion: "past_success",
      prior_completion_claim: "i_already_finished",
      stale_pass: true,
      unverified_success: "unverified",
      raw_events: [{ event: "big" }],
      raw_metadata: { heavy: true },
      giant_logs: "100MB_log_data",
      dependency_graph_dump: { nodes: [1, 2, 3] },
      nested: {
        safe: "ok",
        fake_completion: "nested_leak",
        stale_evidence: "old",
      },
    };

    const sanitized = sanitizeLeanContext(payload) as Record<string, unknown>;
    expect(sanitized["clean_field"]).toBe("valid_value");
    expect("assumed_complete" in sanitized).toBe(false);
    expect("assumed_completion" in sanitized).toBe(false);
    expect("fake_completion" in sanitized).toBe(false);
    expect("historical_completion" in sanitized).toBe(false);
    expect("prior_completion_claim" in sanitized).toBe(false);
    expect("stale_pass" in sanitized).toBe(false);
    expect("unverified_success" in sanitized).toBe(false);
    expect("raw_events" in sanitized).toBe(false);
    expect("raw_metadata" in sanitized).toBe(false);
    expect("giant_logs" in sanitized).toBe(false);
    expect("dependency_graph_dump" in sanitized).toBe(false);
    const nested = sanitized["nested"] as Record<string, unknown>;
    expect(nested["safe"]).toBe("ok");
    expect("fake_completion" in nested).toBe(false);
    expect("stale_evidence" in nested).toBe(false);
  });
});
