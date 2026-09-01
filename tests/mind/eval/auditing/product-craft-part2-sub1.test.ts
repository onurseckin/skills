import { describe, expect, it } from "bun:test";
import {
  CRAFT_PASS_THRESHOLD,
  DEFAULT_PILLAR_WEIGHTS,
  DEFICIT_SEVERITIES,
  ErgonomicWalkthroughAuditor,
  PERCEPTUAL_LATENCY_TARGET_MS,
  PRODUCT_CRAFT_PILLAR_DEFINITIONS,
  PRODUCT_CRAFT_PILLAR_LIST,
  PRODUCT_CRAFT_PILLARS,
  calculateCompositeCraftScore,
  createErgonomicWalkthroughAuditor,
  formatProductCraftAuditMarkdown,
  generateAestheticDeficitNotice,
  renderProductCraftAsciiTable,
  type DeficitInput,
  type MilestoneAuditOptions,
  type UserJourney,
} from "../../../../olt/scripts/src/mind/auditing/product-craft.ts";

describe("Product Craft & Ergonomic Walkthrough Auditing", () => {
describe("The Five Pillars of Product Craft", () => {
    it("exports all 5 standard product craft pillars", () => {
      expect(PRODUCT_CRAFT_PILLAR_LIST.length).toBe(5);
      expect(PRODUCT_CRAFT_PILLAR_LIST).toContain("VISUAL_HIERARCHY");
      expect(PRODUCT_CRAFT_PILLAR_LIST).toContain("LAYOUT_FLUIDITY");
      expect(PRODUCT_CRAFT_PILLAR_LIST).toContain("TACTILE_MICRO_INTERACTIONS");
      expect(PRODUCT_CRAFT_PILLAR_LIST).toContain("INTUITIVE_ONBOARDING");
      expect(PRODUCT_CRAFT_PILLAR_LIST).toContain("EMOTIONAL_RESONANCE");
    });

    it("defines constant dictionary matching pillar IDs", () => {
      expect(PRODUCT_CRAFT_PILLARS.VISUAL_HIERARCHY).toBe("VISUAL_HIERARCHY");
      expect(PRODUCT_CRAFT_PILLARS.LAYOUT_FLUIDITY).toBe("LAYOUT_FLUIDITY");
      expect(PRODUCT_CRAFT_PILLARS.TACTILE_MICRO_INTERACTIONS).toBe("TACTILE_MICRO_INTERACTIONS");
      expect(PRODUCT_CRAFT_PILLARS.INTUITIVE_ONBOARDING).toBe("INTUITIVE_ONBOARDING");
      expect(PRODUCT_CRAFT_PILLARS.EMOTIONAL_RESONANCE).toBe("EMOTIONAL_RESONANCE");
    });

    it("has comprehensive definitions, evaluation criteria, and target metrics for each pillar", () => {
      for (const pillar of PRODUCT_CRAFT_PILLAR_LIST) {
        const def = PRODUCT_CRAFT_PILLAR_DEFINITIONS[pillar];
        expect(def).toBeDefined();
        expect(def.id).toBe(pillar);
        expect(def.title.length).toBeGreaterThan(0);
        expect(def.shortDescription.length).toBeGreaterThan(0);
        expect(def.evaluationCriteria.length).toBeGreaterThanOrEqual(3);
        expect(def.targetMetric.length).toBeGreaterThan(0);
        expect(def.defaultWeight).toBe(0.2);
      }
    });

    it("verifies default weights sum to 1.0 (100%)", () => {
      const sum = PRODUCT_CRAFT_PILLAR_LIST.reduce((acc, p) => acc + DEFAULT_PILLAR_WEIGHTS[p], 0);
      expect(Math.round(sum * 100) / 100).toBe(1.0);
    });

    it("exports standard constants", () => {
      expect(CRAFT_PASS_THRESHOLD).toBe(85);
      expect(PERCEPTUAL_LATENCY_TARGET_MS).toBe(16);
      expect(DEFICIT_SEVERITIES.BLOCKING).toBe("BLOCKING");
      expect(DEFICIT_SEVERITIES.MAJOR).toBe("MAJOR");
      expect(DEFICIT_SEVERITIES.MINOR).toBe("MINOR");
    });
  });

describe("calculateCompositeCraftScore", () => {
    it("computes equal-weighted average accurately", () => {
      const score = calculateCompositeCraftScore({
        VISUAL_HIERARCHY: 90,
        LAYOUT_FLUIDITY: 85,
        TACTILE_MICRO_INTERACTIONS: 95,
        INTUITIVE_ONBOARDING: 80,
        EMOTIONAL_RESONANCE: 90,
      });

      // (90 + 85 + 95 + 80 + 90) / 5 = 440 / 5 = 88
      expect(score).toBe(88);
    });

    it("clamps scores to 0-100 range", () => {
      const score = calculateCompositeCraftScore({
        VISUAL_HIERARCHY: 150,
        LAYOUT_FLUIDITY: -20,
        TACTILE_MICRO_INTERACTIONS: 100,
        INTUITIVE_ONBOARDING: 100,
        EMOTIONAL_RESONANCE: 100,
      });

      // (100 + 0 + 100 + 100 + 100) / 5 = 400 / 5 = 80
      expect(score).toBe(80);
    });

    it("respects custom normalized pillar weights", () => {
      const customWeights = {
        VISUAL_HIERARCHY: 0.4,
        LAYOUT_FLUIDITY: 0.1,
        TACTILE_MICRO_INTERACTIONS: 0.1,
        INTUITIVE_ONBOARDING: 0.2,
        EMOTIONAL_RESONANCE: 0.2,
      };

      const score = calculateCompositeCraftScore(
        {
          VISUAL_HIERARCHY: 100, // 40
          LAYOUT_FLUIDITY: 50, // 5
          TACTILE_MICRO_INTERACTIONS: 50, // 5
          INTUITIVE_ONBOARDING: 50, // 10
          EMOTIONAL_RESONANCE: 50, // 10
        },
        customWeights,
      );

      // 40 + 5 + 5 + 10 + 10 = 70
      expect(score).toBe(70);
    });
  });

describe("generateAestheticDeficitNotice", () => {
    it("creates a properly structured deficit notice", () => {
      const notice = generateAestheticDeficitNotice({
        milestoneId: "m1-onboarding",
        pillar: "VISUAL_HIERARCHY",
        severity: "MAJOR",
        stepId: "step-welcome-card",
        visualDefectDescription: "Contrast ratio on subtitle is 2.8:1, failing WCAG AA.",
        remediationGuidance: "Darken subtitle text color token to achieve >= 4.5:1 contrast.",
      });

      expect(notice.id).toBeDefined();
      expect(notice.milestoneId).toBe("m1-onboarding");
      expect(notice.pillar).toBe("VISUAL_HIERARCHY");
      expect(notice.severity).toBe("MAJOR");
      expect(notice.stepId).toBe("step-welcome-card");
      expect(notice.visualDefectDescription).toContain("Contrast ratio");
      expect(notice.remediationGuidance).toContain("Darken subtitle");
      expect(notice.resolved).toBe(false);
      expect(notice.createdAt).toBeDefined();
      expect(notice.updatedAt).toBeDefined();
    });
  });
});
