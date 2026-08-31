import { describe, expect, it } from "bun:test";
import { rm, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatManifestFilename,
  generateRemediations,
  isCertifiedManifest,
  loadCompanionManifest,
  saveCompanionManifest,
  synthesizeCompanionManifest,
} from "../../../../olt/scripts/src/capture/validator/synthesis/index.ts";
import type {
  CompanionManifestV2,
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../../olt/scripts/src/capture/validator/types.ts";

describe("Synthesis Engine", () => {
  describe("Remediation Generator (remediation-generator.ts)", () => {
    const knownCategories = [
      "apca-contrast",
      "touch-target",
      "concentric-radius",
      "subpixel-snapping",
      "cls-reservation",
      "cowan-chunking",
      "fitts-law",
      "hick-hyman",
      "norman-grace",
      "ui-states-fsm",
      "aria-focus-trap",
      "floating-ui-collision",
      "md3-state-layers",
      "apple-hig-tracking",
      "geist-tokens",
      "sidebar-layout",
    ];

    it("generates 5-framework code remediations (react, react-native, vue, svelte, css) for all known categories", () => {
      const frameworks = ["react", "react-native", "vue", "svelte", "css"];

      for (const cat of knownCategories) {
        const remediations = generateRemediations(cat);
        expect(remediations.length).toBe(5);

        const remFrameworks = remediations.map((r) => r.framework);
        for (const fw of frameworks) {
          expect(remFrameworks).toContain(fw as (typeof frameworks)[number]);
        }

        for (const rem of remediations) {
          expect(rem.description.length).toBeGreaterThan(10);
          expect(rem.snippet.length).toBeGreaterThan(5);
        }
      }
    });

    it("generates fallback template for unknown defect category", () => {
      const remediations = generateRemediations("custom-future-defect");
      expect(remediations.length).toBe(5);
      expect(remediations[0]?.description).toContain("custom-future-defect");
      expect(remediations[0]?.snippet).toContain("Fix for custom-future-defect in react");
    });
  });

  describe("Manifest Synthesis & Certification (manifest-synthesizer.ts)", () => {
    it("synthesizes certified manifest when zero defects are detected", () => {
      const cleanElements: ElementPhysicsSnapshot[] = [
        {
          selector: "h1.clean-heading",
          tagName: "H1",
          text: "Executive Dashboard",
          bounds: { x: 40, y: 40, width: 400, height: 48 },
          computedStyles: {
            fontSize: 24,
            fontWeight: 700,
            color: "#000000",
            backgroundColor: "#ffffff",
            padding: 16,
          },
        },
        {
          selector: "button.clean-btn",
          tagName: "BUTTON",
          text: "Analyze Metrics",
          interactive: true,
          isTouchTarget: true,
          bounds: { x: 40, y: 120, width: 160, height: 48 },
          computedStyles: {
            fontSize: 16,
            fontWeight: 600,
            color: "#ffffff",
            backgroundColor: "#09090b",
            borderRadius: 8,
            padding: 12,
          },
          implementedStates: ["default", "hover", "active", "focus", "disabled"],
        },
      ];

      const ctx: ValidationContext = {
        screenId: "dashboard",
        viewport: "desktop",
        elements: cleanElements,
        viewportBounds: { width: 1440, height: 900 },
      };

      const manifest = synthesizeCompanionManifest(ctx);
      expect(manifest.version).toBe("2.0");
      expect(manifest.screenId).toBe("dashboard");
      expect(manifest.viewport).toBe("desktop");
      expect(manifest.verdict).toBe("CERTIFIED");
      expect(manifest.totalDefects).toBe(0);
      expect(manifest.criticalCount).toBe(0);
      expect(manifest.seriousCount).toBe(0);
      expect(manifest.moderateCount).toBe(0);
      expect(manifest.minorCount).toBe(0);
      expect(manifest.allDefects.length).toBe(0);
      expect(manifest.remediationSummary.length).toBe(0);
      expect(manifest.pillars.mechanical.passed).toBe(true);
      expect(manifest.pillars.cognitive.passed).toBe(true);
      expect(manifest.pillars.custom.passed).toBe(true);
      expect(manifest.pillars.product.passed).toBe(true);
      expect(manifest.pillars.ux.passed).toBe(true);
      expect(manifest.cognitiveAnalysis).toBeDefined();
      expect(manifest.criteria.length).toBeGreaterThan(0);

      // Verify isCertifiedManifest
      expect(isCertifiedManifest(manifest)).toBe(true);
    });

    it("synthesizes defects, categorizes severities, splits product/ux pillars, and deduplicates remediations", () => {
      const flawedElements: ElementPhysicsSnapshot[] = [
        // APCA low contrast (critical)
        {
          selector: "p.low-apca",
          tagName: "P",
          text: "Unreadable",
          bounds: { x: 0, y: 0, width: 100, height: 20 },
          computedStyles: { color: "#888888", backgroundColor: "#999999", fontSize: 16 },
        },
        // CLS reservation missing (serious)
        {
          selector: "img.unreserved",
          tagName: "IMG",
          bounds: { x: 0, y: 0, width: 400, height: 300 },
        },
        // Concentric mismatch (moderate)
        {
          selector: "div.mismatch-radius",
          tagName: "DIV",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          computedStyles: { borderRadius: 8 },
          parentBorderRadius: 8,
          parentPadding: 8,
        },
        // Subpixel fractional bound (minor)
        {
          selector: "div.subpixel",
          tagName: "DIV",
          bounds: { x: 10.33, y: 20, width: 100, height: 100 },
        },
        // Product pillar defects: Geist token mismatch & Apple tracking mismatch
        {
          selector: "div.geist-box",
          tagName: "DIV",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          computedStyles: { fontFamily: "Geist Sans", borderRadius: 10 },
        },
        {
          selector: "h1.apple-header",
          tagName: "H1",
          bounds: { x: 0, y: 0, width: 200, height: 40 },
          computedStyles: { fontFamily: "SF Pro Text", fontSize: 12, letterSpacing: 2.0 },
        },
        // UX pillar defects: WAI-ARIA focus trap & Floating collision & MD3 state layer
        {
          selector: "dialog.modal-trap",
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
      ];

      const ctx: ValidationContext = {
        screenId: "flawed_screen",
        viewport: "desktop",
        elements: flawedElements,
      };

      const manifest = synthesizeCompanionManifest(ctx);
      expect(manifest.verdict).toBe("DEFECTS_FOUND");
      expect(manifest.totalDefects).toBeGreaterThan(0);
      expect(manifest.criticalCount).toBeGreaterThan(0);
      expect(manifest.seriousCount).toBeGreaterThan(0);
      expect(manifest.moderateCount).toBeGreaterThan(0);
      expect(manifest.minorCount).toBeGreaterThan(0);

      // Product and UX pillars
      expect(manifest.pillars.product.passed).toBe(false);
      expect(manifest.pillars.product.defects.length).toBe(2);
      expect(manifest.pillars.ux.passed).toBe(false);
      expect(manifest.pillars.ux.defects.length).toBe(3);

      // Remediation deduplication (multiple defects of same category don't duplicate framework remediations)
      const remediationKeys = manifest.remediationSummary.map(
        (r) => `${r.framework}-${r.description}`,
      );
      const uniqueKeys = new Set(remediationKeys);
      expect(remediationKeys.length).toBe(uniqueKeys.size);

      // isCertifiedManifest should be false
      expect(isCertifiedManifest(manifest)).toBe(false);
    });
  });

  describe("Companion Manifest Writer & Loader (manifest-writer.ts)", () => {
    it("formatManifestFilename sanitizes special characters cleanly", () => {
      expect(formatManifestFilename("checkout", "desktop")).toBe(
        "checkout-desktop.manifest.json",
      );
      expect(formatManifestFilename("screen/path:test", "mobile@390")).toBe(
        "screen_path_test-mobile_390.manifest.json",
      );
    });

    it("saves and loads companion manifest v2.0 cleanly", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "manifest-test-"));
      try {
        const manifest: CompanionManifestV2 = {
          version: "2.0",
          screenId: "settings",
          viewport: "tablet",
          timestamp: new Date().toISOString(),
          verdict: "CERTIFIED",
          totalDefects: 0,
          criticalCount: 0,
          seriousCount: 0,
          moderateCount: 0,
          minorCount: 0,
          criteria: [],
          cognitiveAnalysis: {
            summary: "Optimal",
            questionsEvaluated: 12,
            questionsPassed: 12,
            questions: [],
          },
          pillars: {
            mechanical: { pillar: "mechanical", passed: true, defects: [], evaluatedCount: 0 },
            cognitive: { pillar: "cognitive", passed: true, defects: [], evaluatedCount: 0 },
            custom: { pillar: "custom", passed: true, defects: [], evaluatedCount: 0 },
            product: { pillar: "product", passed: true, defects: [], evaluatedCount: 0 },
            ux: { pillar: "ux", passed: true, defects: [], evaluatedCount: 0 },
          },
          allDefects: [],
          remediationSummary: [],
        };

        const savedPath = await saveCompanionManifest(manifest, tempDir);
        expect(savedPath).toContain("settings-tablet.manifest.json");

        const loaded = await loadCompanionManifest(savedPath);
        expect(loaded.version).toBe("2.0");
        expect(loaded.screenId).toBe("settings");
        expect(loaded.viewport).toBe("tablet");
        expect(loaded.verdict).toBe("CERTIFIED");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("loadCompanionManifest rejects invalid manifests or non-v2.0 versions", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "manifest-invalid-"));
      try {
        const invalidFilePath = join(tempDir, "invalid.json");
        await writeFile(invalidFilePath, JSON.stringify({ version: "1.0", screenId: "test" }), "utf8");

        expect(loadCompanionManifest(invalidFilePath)).rejects.toThrow("Invalid Companion Manifest v2.0");

        const nonObjectPath = join(tempDir, "non-obj.json");
        await writeFile(nonObjectPath, JSON.stringify("not-an-object"), "utf8");
        expect(loadCompanionManifest(nonObjectPath)).rejects.toThrow("Invalid Companion Manifest v2.0");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
