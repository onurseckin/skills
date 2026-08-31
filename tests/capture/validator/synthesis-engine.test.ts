import { describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatManifestFilename,
  generateRemediations,
  isCertifiedManifest,
  loadCompanionManifest,
  saveCompanionManifest,
  synthesizeCompanionManifest,
} from "../../../olt/scripts/src/capture/validator/synthesis/index.ts";
import type {
  CompanionManifestV2,
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../olt/scripts/src/capture/validator/types.ts";
import { scratchRoot } from "../../shared/scratch-root.ts";

describe("Synthesis Engine & Manifest Certification", () => {
  describe("Remediation Generator", () => {
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

    it("generates 5-framework code remediations for all known categories", () => {
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
    });
  });

  describe("Manifest Synthesis & Certification", () => {
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
      expect(manifest.pillars.mechanical.passed).toBe(true);
      expect(manifest.pillars.cognitive.passed).toBe(true);
      expect(manifest.pillars.custom.passed).toBe(true);
      expect(manifest.pillars.product.passed).toBe(true);
      expect(manifest.pillars.ux.passed).toBe(true);
      expect(isCertifiedManifest(manifest)).toBe(true);
    });

    it("synthesizes defects, categorizes severities, splits product/ux pillars, and deduplicates remediations", () => {
      const flawedElements: ElementPhysicsSnapshot[] = [
        {
          selector: "p.low-apca",
          tagName: "P",
          text: "Unreadable",
          bounds: { x: 0, y: 0, width: 100, height: 20 },
          computedStyles: { color: "#888888", backgroundColor: "#999999", fontSize: 16 },
        },
        {
          selector: "img.unreserved",
          tagName: "IMG",
          bounds: { x: 0, y: 0, width: 400, height: 300 },
        },
        {
          selector: "div.geist-box",
          tagName: "DIV",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          computedStyles: { fontFamily: "Geist Sans", borderRadius: 10 },
        },
        {
          selector: "dialog.modal-trap",
          tagName: "DIALOG",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
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
      expect(isCertifiedManifest(manifest)).toBe(false);
    });
  });

  describe("Companion Manifest Writer & Loader", () => {
    it("formatManifestFilename sanitizes special characters cleanly", () => {
      expect(formatManifestFilename("checkout", "desktop")).toBe("checkout-desktop.manifest.json");
      expect(formatManifestFilename("screen/path:test", "mobile@390")).toBe(
        "screen_path_test-mobile_390.manifest.json",
      );
    });

    it("saves and loads companion manifest v2.0 cleanly", async () => {
      const root = scratchRoot(import.meta.path, "manifest-save-load");
      const tempDir = join(root, "manifest-test");
      await mkdir(tempDir, { recursive: true });

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
    });

    it("loadCompanionManifest rejects invalid manifests or non-v2.0 versions", async () => {
      const root = scratchRoot(import.meta.path, "manifest-invalid");
      const tempDir = join(root, "manifest-invalid");
      await mkdir(tempDir, { recursive: true });

      const invalidFilePath = join(tempDir, "invalid.json");
      await writeFile(
        invalidFilePath,
        JSON.stringify({ version: "1.0", screenId: "test" }),
        "utf8",
      );

      expect(loadCompanionManifest(invalidFilePath)).rejects.toThrow(
        "Invalid Companion Manifest v2.0",
      );

      const nonObjectPath = join(tempDir, "non-obj.json");
      await writeFile(nonObjectPath, JSON.stringify("not-an-object"), "utf8");
      expect(loadCompanionManifest(nonObjectPath)).rejects.toThrow(
        "Invalid Companion Manifest v2.0",
      );
    });
  });
});
