import { describe, expect, it } from "bun:test";
import {
  calculateCompositeCraftScore,
  CRAFT_PASS_THRESHOLD,
  createErgonomicWalkthroughAuditor,
  DEFAULT_PILLAR_WEIGHTS,
  DEFICIT_SEVERITIES,
  ErgonomicWalkthroughAuditor,
  formatProductCraftAuditMarkdown,
  generateAestheticDeficitNotice,
  PERCEPTUAL_LATENCY_TARGET_MS,
  PRODUCT_CRAFT_PILLAR_DEFINITIONS,
  PRODUCT_CRAFT_PILLAR_LIST,
  PRODUCT_CRAFT_PILLARS,
  renderProductCraftAsciiTable,
  type AestheticDeficitNotice,
  type CreateDeficitNoticeInput,
  type DeficitInput,
  type DeficitSeverity,
  type ErgonomicAuditResult,
  type MilestoneAuditOptions,
  type MilestoneSignOffStatus,
  type PillarEvaluation,
  type PillarScoreInput,
  type ProductCraftPillar,
  type ProductCraftPillarDefinition,
  type UserJourney,
  type UserJourneyStep,
} from "../../../olt/scripts/src/mind/auditing/product-craft.ts";

describe("Product Craft, Visual Aesthetics & Ergonomic Walkthrough Auditing Suite", () => {
  describe("1. The Five Pillars of Product Craft & Specifications", () => {
    it("exports all 5 standard product craft pillars", () => {
      expect(PRODUCT_CRAFT_PILLAR_LIST).toHaveLength(5);
      expect(PRODUCT_CRAFT_PILLAR_LIST).toContain("VISUAL_HIERARCHY");
      expect(PRODUCT_CRAFT_PILLAR_LIST).toContain("LAYOUT_FLUIDITY");
      expect(PRODUCT_CRAFT_PILLAR_LIST).toContain("TACTILE_MICRO_INTERACTIONS");
      expect(PRODUCT_CRAFT_PILLAR_LIST).toContain("INTUITIVE_ONBOARDING");
      expect(PRODUCT_CRAFT_PILLAR_LIST).toContain("EMOTIONAL_RESONANCE");
    });

    it("matches constant dictionary mappings", () => {
      expect(PRODUCT_CRAFT_PILLARS.VISUAL_HIERARCHY).toBe("VISUAL_HIERARCHY");
      expect(PRODUCT_CRAFT_PILLARS.LAYOUT_FLUIDITY).toBe("LAYOUT_FLUIDITY");
      expect(PRODUCT_CRAFT_PILLARS.TACTILE_MICRO_INTERACTIONS).toBe("TACTILE_MICRO_INTERACTIONS");
      expect(PRODUCT_CRAFT_PILLARS.INTUITIVE_ONBOARDING).toBe("INTUITIVE_ONBOARDING");
      expect(PRODUCT_CRAFT_PILLARS.EMOTIONAL_RESONANCE).toBe("EMOTIONAL_RESONANCE");
    });

    it("verifies comprehensive specifications, criteria, and target metrics for each pillar", () => {
      for (const pillar of PRODUCT_CRAFT_PILLAR_LIST) {
        const def: ProductCraftPillarDefinition = PRODUCT_CRAFT_PILLAR_DEFINITIONS[pillar];
        expect(def).toBeDefined();
        expect(def.id).toBe(pillar);
        expect(def.title.length).toBeGreaterThan(0);
        expect(def.shortDescription.length).toBeGreaterThan(0);
        expect(def.evaluationCriteria.length).toBeGreaterThanOrEqual(4);
        expect(def.targetMetric.length).toBeGreaterThan(0);
        expect(def.defaultWeight).toBe(0.2);
      }

      // Check specific pillar expectations
      expect(PRODUCT_CRAFT_PILLAR_DEFINITIONS.VISUAL_HIERARCHY.title).toContain(
        "Visual Hierarchy & Informational Clarity",
      );
      expect(PRODUCT_CRAFT_PILLAR_DEFINITIONS.LAYOUT_FLUIDITY.title).toContain(
        "Layout Fluidity & Responsive Grace",
      );
      expect(PRODUCT_CRAFT_PILLAR_DEFINITIONS.TACTILE_MICRO_INTERACTIONS.title).toContain(
        "Tactile Micro-Interactions",
      );
      expect(PRODUCT_CRAFT_PILLAR_DEFINITIONS.INTUITIVE_ONBOARDING.title).toContain(
        "Intuitive Onboarding & Zero-Doc Usability",
      );
      expect(PRODUCT_CRAFT_PILLAR_DEFINITIONS.EMOTIONAL_RESONANCE.title).toContain(
        "Emotional Resonance & Aesthetic Delight",
      );
    });

    it("validates equal default weights summing to 1.0 (100%)", () => {
      const sum = PRODUCT_CRAFT_PILLAR_LIST.reduce((acc, p) => acc + DEFAULT_PILLAR_WEIGHTS[p], 0);
      expect(Math.round(sum * 100) / 100).toBe(1.0);
    });

    it("exports standard craft threshold constants", () => {
      expect(CRAFT_PASS_THRESHOLD).toBe(85);
      expect(PERCEPTUAL_LATENCY_TARGET_MS).toBe(16); // 16ms = 60fps frame budget
      expect(DEFICIT_SEVERITIES.BLOCKING).toBe("BLOCKING");
      expect(DEFICIT_SEVERITIES.MAJOR).toBe("MAJOR");
      expect(DEFICIT_SEVERITIES.MINOR).toBe("MINOR");
    });
  });

  describe("2. Composite Craft Score Calculation", () => {
    it("computes equal-weighted average across 5 pillars", () => {
      const score = calculateCompositeCraftScore({
        VISUAL_HIERARCHY: 90,
        LAYOUT_FLUIDITY: 85,
        TACTILE_MICRO_INTERACTIONS: 95,
        INTUITIVE_ONBOARDING: 80,
        EMOTIONAL_RESONANCE: 90,
      });

      // (90 + 85 + 95 + 80 + 90) / 5 = 440 / 5 = 88.00
      expect(score).toBe(88);
    });

    it("clamps scores to 0-100 range strictly", () => {
      const score = calculateCompositeCraftScore({
        VISUAL_HIERARCHY: 150,
        LAYOUT_FLUIDITY: -30,
        TACTILE_MICRO_INTERACTIONS: 100,
        INTUITIVE_ONBOARDING: 100,
        EMOTIONAL_RESONANCE: 100,
      });

      // (100 + 0 + 100 + 100 + 100) / 5 = 400 / 5 = 80.00
      expect(score).toBe(80);
    });

    it("supports custom normalized pillar weights", () => {
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

      expect(score).toBe(70);
    });
  });

  describe("3. Aesthetic Deficit Notice Generation & Classification", () => {
    it("creates structured Aesthetic Deficit Notice with validated fields", () => {
      const notice: AestheticDeficitNotice = generateAestheticDeficitNotice({
        milestoneId: "m-checkout-flow",
        pillar: "LAYOUT_FLUIDITY",
        severity: "BLOCKING",
        stepId: "step-payment-modal",
        visualDefectDescription: "Payment submit button is obscured beneath keyboard on mobile",
        remediationGuidance: "Apply dynamic viewport-height padding and scroll-into-view behavior",
      });

      expect(notice.id).toBeDefined();
      expect(notice.milestoneId).toBe("m-checkout-flow");
      expect(notice.pillar).toBe("LAYOUT_FLUIDITY");
      expect(notice.severity).toBe("BLOCKING");
      expect(notice.stepId).toBe("step-payment-modal");
      expect(notice.visualDefectDescription).toContain("obscured beneath keyboard");
      expect(notice.remediationGuidance).toContain("scroll-into-view");
      expect(notice.resolved).toBe(false);
      expect(notice.createdAt).toBeDefined();
      expect(notice.updatedAt).toBeDefined();
    });

    it("auto-generates BLOCKING notice when a pillar score is < 50", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const result: ErgonomicAuditResult = auditor.auditMilestoneErgonomics("m-auth-screen", {
        VISUAL_HIERARCHY: 90,
        LAYOUT_FLUIDITY: 90,
        TACTILE_MICRO_INTERACTIONS: 35, // < 50 -> Auto BLOCKING
        INTUITIVE_ONBOARDING: 90,
        EMOTIONAL_RESONANCE: 90,
      });

      expect(result.passed).toBe(false);
      expect(result.blockingDeficitsCount).toBe(1);
      expect(result.isMilestoneSignOffBlocked).toBe(true);

      const blockingNotices = auditor.getBlockingDeficits("m-auth-screen");
      expect(blockingNotices).toHaveLength(1);
      expect(blockingNotices[0]?.pillar).toBe("TACTILE_MICRO_INTERACTIONS");
      expect(blockingNotices[0]?.severity).toBe("BLOCKING");
    });

    it("auto-generates MAJOR notice when a pillar score is between 50 and 69", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const result = auditor.auditMilestoneErgonomics("m-settings", {
        VISUAL_HIERARCHY: 90,
        LAYOUT_FLUIDITY: 65, // Major deficit
        TACTILE_MICRO_INTERACTIONS: 90,
        INTUITIVE_ONBOARDING: 90,
        EMOTIONAL_RESONANCE: 90,
      });

      expect(result.majorDeficitsCount).toBe(1);
      const majorNotices = auditor.getMajorDeficits("m-settings");
      expect(majorNotices).toHaveLength(1);
      expect(majorNotices[0]?.pillar).toBe("LAYOUT_FLUIDITY");
      expect(majorNotices[0]?.severity).toBe("MAJOR");
    });

    it("auto-generates MINOR notice when a pillar score is between 70 and 84", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const result = auditor.auditMilestoneErgonomics("m-profile", {
        VISUAL_HIERARCHY: 90,
        LAYOUT_FLUIDITY: 80, // Minor deficit (<85 threshold)
        TACTILE_MICRO_INTERACTIONS: 90,
        INTUITIVE_ONBOARDING: 90,
        EMOTIONAL_RESONANCE: 90,
      });

      expect(result.minorDeficitsCount).toBe(1);
      expect(result.compositeScore).toBe(88); // Composite passes (88 >= 85), but minor notice logged
    });
  });
});
