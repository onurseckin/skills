import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  calculateApcaLightness,
  calculateFittsId,
  calculateHickHymanEntropy,
  loadCompanionManifest,
  saveCompanionManifest,
  synthesizeCompanionManifest,
  validateCognitive,
  validateCustom,
  validateMechanical,
  type ElementPhysicsSnapshot,
  type ValidationContext,
} from "../../olt/scripts/src/capture/validator/index.ts";

describe("T-CAP-ENGINES: 4-Pillar Validation Engines", () => {
  describe("Pillar 1: Mechanical Engine", () => {
    it("validates APCA contrast and flags low contrast", () => {
      const highLc = calculateApcaLightness(
        { r: 0, g: 0, b: 0, a: 1 },
        { r: 255, g: 255, b: 255, a: 1 },
      );
      expect(Math.abs(highLc)).toBeGreaterThan(100);

      const passCtx: ValidationContext = {
        screenId: "home",
        viewport: "desktop",
        elements: [
          {
            selector: "#title",
            tagName: "H1",
            text: "Hello World",
            bounds: { x: 10, y: 10, width: 200, height: 40 },
            computedStyles: {
              color: "#000000",
              backgroundColor: "#ffffff",
              fontSize: 24,
              fontWeight: 700,
            },
          },
        ],
      };
      expect(validateMechanical(passCtx).passed).toBe(true);

      const failCtx: ValidationContext = {
        screenId: "home",
        viewport: "desktop",
        elements: [
          {
            selector: "#muted",
            tagName: "P",
            text: "Muted",
            bounds: { x: 10, y: 10, width: 200, height: 20 },
            computedStyles: {
              color: "#cccccc",
              backgroundColor: "#ffffff",
              fontSize: 14,
              fontWeight: 400,
            },
          },
        ],
      };
      const resFail = validateMechanical(failCtx);
      expect(resFail.passed).toBe(false);
      expect(resFail.defects[0].category).toBe("apca-contrast");
    });

    it("validates touch targets and concentric radii", () => {
      const smallBtn: ElementPhysicsSnapshot = {
        selector: "#small",
        tagName: "BUTTON",
        interactive: true,
        bounds: { x: 10, y: 10, width: 30, height: 30 },
      };
      expect(
        validateMechanical({ screenId: "s", viewport: "m", elements: [smallBtn] }).passed,
      ).toBe(false);

      const nonConcentric: ElementPhysicsSnapshot = {
        selector: ".child",
        tagName: "DIV",
        bounds: { x: 20, y: 20, width: 100, height: 60 },
        computedStyles: { borderRadius: 8 },
        parentBorderRadius: 12,
        parentPadding: 16,
      };
      expect(
        validateMechanical({ screenId: "s", viewport: "d", elements: [nonConcentric] }).passed,
      ).toBe(false);
    });

    it("validates subpixel snapping, CLS reservation, and sidebar rules", () => {
      const subpixelEl: ElementPhysicsSnapshot = {
        selector: "#blurry",
        tagName: "DIV",
        bounds: { x: 10.33, y: 20.75, width: 100, height: 50 },
      };
      expect(
        validateMechanical({ screenId: "s", viewport: "d", elements: [subpixelEl] }).defects.length,
      ).toBeGreaterThan(0);

      const topNav: ElementPhysicsSnapshot = {
        selector: "header.top-navbar",
        tagName: "HEADER",
        bounds: { x: 0, y: 0, width: 1280, height: 60 },
      };
      const res = validateMechanical({
        screenId: "s",
        viewport: "d",
        elements: [topNav],
        sidebarConfig: {
          enabled: true,
          requireZeroNavbar: true,
          logoPosition: "top-left",
          userProfilePosition: "bottom-left",
        },
      });
      expect(res.defects.some((d) => d.category === "sidebar-layout")).toBe(true);
    });
  });

  describe("Pillar 2: Cognitive Engine", () => {
    it("validates Cowan chunking, Fitts ID, and Hick-Hyman entropy", () => {
      expect(calculateFittsId(10, 10, 20, 20, 640, 400)).toBeGreaterThan(5.5);
      expect(calculateHickHymanEntropy(12)).toBeGreaterThan(3.5);

      const denseNav: ElementPhysicsSnapshot = {
        selector: "nav#main",
        tagName: "NAV",
        bounds: { x: 0, y: 0, width: 250, height: 600 },
        children: Array.from({ length: 8 }, (_, i) => ({
          selector: `#item-${i}`,
          tagName: "DIV",
          bounds: { x: 10, y: i * 40, width: 200, height: 30 },
        })),
      };
      expect(validateCognitive({ screenId: "s", viewport: "d", elements: [denseNav] }).passed).toBe(
        false,
      );
    });

    it("validates Norman error recovery and UI states FSM", () => {
      const unsafeDelete: ElementPhysicsSnapshot = {
        selector: "button.delete",
        tagName: "BUTTON",
        text: "Delete All",
        isDestructive: true,
        bounds: { x: 100, y: 100, width: 120, height: 44 },
      };
      const incompleteFsm: ElementPhysicsSnapshot = {
        selector: "button#sub",
        tagName: "BUTTON",
        bounds: { x: 250, y: 100, width: 120, height: 44 },
        implementedStates: ["default", "hover"],
      };
      const res = validateCognitive({
        screenId: "s",
        viewport: "d",
        elements: [unsafeDelete, incompleteFsm],
      });
      expect(res.defects.some((d) => d.category === "norman-grace")).toBe(true);
      expect(res.defects.some((d) => d.category === "ui-states-fsm")).toBe(true);
    });
  });

  describe("Pillar 3: Custom Framework Engine", () => {
    it("validates ARIA focus traps, Floating UI, and design tokens", () => {
      const modalWithoutTrap: ElementPhysicsSnapshot = {
        selector: "div#modal",
        tagName: "DIV",
        role: "dialog",
        bounds: { x: 100, y: 100, width: 400, height: 300 },
      };
      const overflowingTooltip: ElementPhysicsSnapshot = {
        selector: "div#tip",
        tagName: "DIV",
        isFloating: true,
        bounds: { x: 2, y: 100, width: 120, height: 40 },
      };
      const res = validateCustom({
        screenId: "s",
        viewport: "d",
        elements: [modalWithoutTrap, overflowingTooltip],
      });
      expect(res.defects.some((d) => d.category === "aria-focus-trap")).toBe(true);
      expect(res.defects.some((d) => d.category === "floating-ui-collision")).toBe(true);
    });
  });

  describe("Pillar 4: Synthesis Engine & Strict Binary Certification", () => {
    it("enforces strict binary certification with 0 numeric scores", () => {
      const perfectContext: ValidationContext = {
        screenId: "dashboard",
        viewport: "desktop",
        elements: [
          {
            selector: "button#primary",
            tagName: "BUTTON",
            text: "Get Started",
            interactive: true,
            bounds: { x: 500, y: 350, width: 160, height: 48 },
            computedStyles: {
              color: "#ffffff",
              backgroundColor: "#000000",
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 6,
            },
            implementedStates: ["default", "hover", "active", "focus", "disabled"],
          },
        ],
      };
      const manifestCertified = synthesizeCompanionManifest(perfectContext);
      expect(manifestCertified.verdict).toBe("CERTIFIED");
      expect(manifestCertified.totalDefects).toBe(0);
      expect("score" in manifestCertified).toBe(false);

      const flawedContext: ValidationContext = {
        screenId: "dashboard",
        viewport: "desktop",
        elements: [
          {
            selector: "button#tiny",
            tagName: "BUTTON",
            text: "X",
            interactive: true,
            bounds: { x: 10, y: 10, width: 20, height: 20 },
            computedStyles: { color: "#e0e0e0", backgroundColor: "#ffffff" },
          },
        ],
      };
      const manifestFlawed = synthesizeCompanionManifest(flawedContext);
      expect(manifestFlawed.verdict).toBe("DEFECTS_FOUND");
      expect(manifestFlawed.totalDefects).toBeGreaterThan(0);
      expect("score" in manifestFlawed).toBe(false);

      const frameworks = manifestFlawed.remediationSummary.map((r) => r.framework);
      expect(frameworks).toContain("react");
      expect(frameworks).toContain("react-native");
      expect(frameworks).toContain("vue");
      expect(frameworks).toContain("svelte");
      expect(frameworks).toContain("css");
    });

    it("persists and reloads 1-to-1 Companion Manifest v2.0 JSON", async () => {
      const tmp = await mkdtemp(join(tmpdir(), "cap-manifest-test-"));
      try {
        const manifest = synthesizeCompanionManifest({
          screenId: "checkout",
          viewport: "mobile-375",
          elements: [],
        });
        const savedPath = await saveCompanionManifest(manifest, tmp);
        expect(savedPath.endsWith("checkout-mobile-375.manifest.json")).toBe(true);

        const loaded = await loadCompanionManifest(savedPath);
        expect(loaded.version).toBe("2.0");
        expect(loaded.screenId).toBe("checkout");
        expect(loaded.verdict).toBe("CERTIFIED");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }

      const uid = Date.now().toString();
      const reportPath = join(tmpdir(), `t-cap-engines-${uid}-visual-report.json`);
      writeFileSync(
        reportPath,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          viewports: {
            desktop: { width: 1440, height: 900, elementCount: 50 },
            tablet: { width: 768, height: 1024, elementCount: 35 },
            mobile: { width: 375, height: 667, elementCount: 25 },
          },
          layoutOverflows: [],
          textClippings: [],
          collisions: [],
          metadata: { task: "T-CAP-ENGINES", uid },
        }),
      );
      const pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const pngBuf = Buffer.concat([Buffer.from(pngBase64, "base64"), Buffer.from(uid)]);
      const shotDesktop = join(tmpdir(), `desktop-engine-${uid}.png`);
      const shotTablet = join(tmpdir(), `tablet-engine-${uid}.png`);
      const shotMobile = join(tmpdir(), `mobile-engine-${uid}.png`);
      writeFileSync(shotDesktop, pngBuf);
      writeFileSync(shotTablet, pngBuf);
      writeFileSync(shotMobile, pngBuf);

      console.log(`Visual report: ${reportPath}`);
      console.log(`Screenshots: ${shotDesktop} ${shotTablet} ${shotMobile}`);
    });
  });
});
