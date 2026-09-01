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


describe("5. UserJourney Audits, Markdown & ASCII Reports", () => {
    it("conducts multi-step UserJourney ergonomic walkthrough audit", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const journey: UserJourney = {
        id: "uj-onboarding",
        title: "New Developer First-Run Journey",
        milestoneId: "m-dev-onboarding",
        steps: [
          {
            id: "step-1-init",
            title: "Initialize workspace",
            targetPillars: ["VISUAL_HIERARCHY", "TACTILE_MICRO_INTERACTIONS"],
            interactiveElements: ["init-button", "template-dropdown"],
          },
          {
            id: "step-2-verify",
            title: "Run first build",
            targetPillars: ["INTUITIVE_ONBOARDING", "EMOTIONAL_RESONANCE"],
          },
        ],
      };

      const result = auditor.auditMilestoneErgonomics(journey, {
        VISUAL_HIERARCHY: 92,
        LAYOUT_FLUIDITY: 90,
        TACTILE_MICRO_INTERACTIONS: 95,
        INTUITIVE_ONBOARDING: 94,
        EMOTIONAL_RESONANCE: 92,
      });

      expect(result.milestoneId).toBe("m-dev-onboarding");
      expect(result.milestoneTitle).toBe("New Developer First-Run Journey");
      expect(result.compositeScore).toBe(92.6);
      expect(result.passed).toBe(true);
      expect(result.isMilestoneSignOffBlocked).toBe(false);
    });

    it("renders Markdown reports and ASCII tables accurately", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const result = auditor.auditMilestoneErgonomics("m-report-test", {
        VISUAL_HIERARCHY: 90,
        LAYOUT_FLUIDITY: 85,
        TACTILE_MICRO_INTERACTIONS: 88,
        INTUITIVE_ONBOARDING: 86,
        EMOTIONAL_RESONANCE: 90,
      });

      const md = formatProductCraftAuditMarkdown(result);
      expect(md).toContain("# Product Craft & Ergonomic Walkthrough Audit");
      expect(md).toContain("Five Pillars of Product Craft Evaluation");
      expect(md).toContain("`87.8/100`");

      const ascii = renderProductCraftAsciiTable(result);
      expect(ascii).toContain("+---------------------------------------+");
      expect(ascii).toContain("COMPOSITE SCORE:");
      expect(ascii).toContain("PASS");
    });

    it("tracks audit history and resets auditor state cleanly", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      auditor.auditMilestoneErgonomics("m-hist-1", {
        VISUAL_HIERARCHY: 90,
        LAYOUT_FLUIDITY: 90,
        TACTILE_MICRO_INTERACTIONS: 90,
        INTUITIVE_ONBOARDING: 90,
        EMOTIONAL_RESONANCE: 90,
      });

      expect(auditor.getAuditHistory("m-hist-1")).toHaveLength(1);
      expect(auditor.getAuditHistory()).toHaveLength(1);

      auditor.reset();
      expect(auditor.getAuditHistory()).toHaveLength(0);
      expect(auditor.getDeficitNotices()).toHaveLength(0);
    });
  });
});
