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


describe("ErgonomicWalkthroughAuditor", () => {
it("blocks sign-off if explicit BLOCKING deficits exist even if composite >= 85", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const explicitDeficits: DeficitInput[] = [
        {
          pillar: "LAYOUT_FLUIDITY",
          severity: "BLOCKING",
          stepId: "step-mobile-checkout",
          visualDefectDescription:
            "Checkout button is clipped off-screen on 375px mobile viewport.",
          remediationGuidance: "Fix bottom padding and overflow-y containment on checkout footer.",
        },
      ];

      const result = auditor.auditMilestoneErgonomics(
        "m5-checkout",
        {
          VISUAL_HIERARCHY: 90,
          LAYOUT_FLUIDITY: 85,
          TACTILE_MICRO_INTERACTIONS: 90,
          INTUITIVE_ONBOARDING: 90,
          EMOTIONAL_RESONANCE: 90,
        },
        explicitDeficits,
      );

      // Composite is 89, but explicit BLOCKING deficit is present
      expect(result.compositeScore).toBe(89);
      expect(result.passed).toBe(false);
      expect(result.blockingDeficitsCount).toBe(1);
      expect(result.isMilestoneSignOffBlocked).toBe(true);

      const signOff = auditor.canSignOffMilestone("m5-checkout");
      expect(signOff.canSignOff).toBe(false);
      expect(signOff.blockingReasons.some((r) => r.includes("BLOCKING"))).toBe(true);
    });
});

describe("ErgonomicWalkthroughAuditor", () => {
it("resolves deficit notices and unblocks milestone sign-off", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const explicitDeficits: DeficitInput[] = [
        {
          pillar: "VISUAL_HIERARCHY",
          severity: "MAJOR",
          stepId: "step-nav",
          visualDefectDescription: "Navigation header lacks active indicator.",
          remediationGuidance: "Add accent border and aria-current attribute.",
        },
      ];

      const result = auditor.auditMilestoneErgonomics(
        {
          milestoneId: "m6-nav",
          milestoneTitle: "Navigation Redesign",
          isUserFacing: true,
        },
        {
          VISUAL_HIERARCHY: {
            score: 88,
            observations: ["Header typography clean"],
            deficits: explicitDeficits,
          },
          LAYOUT_FLUIDITY: 90,
          TACTILE_MICRO_INTERACTIONS: 90,
          INTUITIVE_ONBOARDING: 90,
          EMOTIONAL_RESONANCE: 90,
        },
      );

      expect(result.activeDeficitNotices.length).toBe(1);
      const noticeId = result.activeDeficitNotices[0]?.id ?? "";
      expect(auditor.canSignOffMilestone("m6-nav").canSignOff).toBe(false);

      // Resolve the notice
      const resolved = auditor.resolveDeficitNotice(
        noticeId,
        "Added 2px brand accent underline and aria-current='page' to active links.",
      );

      expect(resolved.resolved).toBe(true);
      expect(resolved.resolutionSummary).toContain("Added 2px brand accent");
      expect(auditor.getUnresolvedDeficits("m6-nav").length).toBe(0);

      // Now sign-off should be permitted
      const signOffStatus = auditor.canSignOffMilestone("m6-nav");
      expect(signOffStatus.canSignOff).toBe(true);

      const finalSignOff = auditor.signOffMilestone("m6-nav", "QA-Lead");
      expect(finalSignOff.signedOff).toBe(true);
    });
});

describe("ErgonomicWalkthroughAuditor", () => {
it("handles full UserJourney audit walkthroughs", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const journey: UserJourney = {
        id: "uj-signup",
        title: "New User Registration & First Project Creation",
        milestoneId: "m7-signup-flow",
        steps: [
          {
            id: "step-1-email",
            title: "Enter email and password",
            targetPillars: ["VISUAL_HIERARCHY", "TACTILE_MICRO_INTERACTIONS"],
            interactiveElements: ["email-input", "password-input", "submit-btn"],
          },
          {
            id: "step-2-onboarding",
            title: "Welcome screen walkthrough",
            targetPillars: ["INTUITIVE_ONBOARDING", "EMOTIONAL_RESONANCE"],
          },
        ],
      };

      const result = auditor.auditMilestoneErgonomics(journey, {
        VISUAL_HIERARCHY: 92,
        LAYOUT_FLUIDITY: 90,
        TACTILE_MICRO_INTERACTIONS: 94,
        INTUITIVE_ONBOARDING: 95,
        EMOTIONAL_RESONANCE: 91,
      });

      expect(result.milestoneId).toBe("m7-signup-flow");
      expect(result.milestoneTitle).toBe("New User Registration & First Project Creation");
      expect(result.compositeScore).toBe(92.4);
      expect(result.passed).toBe(true);
    });
});

describe("ErgonomicWalkthroughAuditor", () => {
it("formats markdown reports and ascii tables cleanly", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const result = auditor.auditMilestoneErgonomics("m8-report", {
        VISUAL_HIERARCHY: 90,
        LAYOUT_FLUIDITY: 85,
        TACTILE_MICRO_INTERACTIONS: 88,
        INTUITIVE_ONBOARDING: 86,
        EMOTIONAL_RESONANCE: 90,
      });

      const md = formatProductCraftAuditMarkdown(result);
      expect(md).toContain("# Product Craft & Ergonomic Walkthrough Audit");
      expect(md).toContain("Five Pillars of Product Craft Evaluation");
      expect(md).toContain("Visual Hierarchy & Informational Clarity");
      expect(md).toContain("`87.8/100`");

      const ascii = renderProductCraftAsciiTable(result);
      expect(ascii).toContain(
        "+---------------------------------------+-------+--------+----------+---------+",
      );
      expect(ascii).toContain("COMPOSITE SCORE:");
    });
});

describe("ErgonomicWalkthroughAuditor", () => {
it("resets auditor state properly", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      auditor.auditMilestoneErgonomics("m9-reset", {
        VISUAL_HIERARCHY: 40,
        LAYOUT_FLUIDITY: 40,
        TACTILE_MICRO_INTERACTIONS: 40,
        INTUITIVE_ONBOARDING: 40,
        EMOTIONAL_RESONANCE: 40,
      });

      expect(auditor.getDeficitNotices().length).toBeGreaterThan(0);
      expect(auditor.getAuditHistory().length).toBe(1);

      auditor.reset();
      expect(auditor.getDeficitNotices().length).toBe(0);
      expect(auditor.getAuditHistory().length).toBe(0);
    });
});
});
