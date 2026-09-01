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
} from "../../../../../olt/scripts/src/mind/auditing/product-craft.ts";

describe("Product Craft & Ergonomic Walkthrough Auditing", () => {
  describe("ErgonomicWalkthroughAuditor", () => {
    it("passes a milestone meeting all pillar criteria with score >= 85", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const result = auditor.auditMilestoneErgonomics("m2-dashboard", {
        VISUAL_HIERARCHY: 90,
        LAYOUT_FLUIDITY: 88,
        TACTILE_MICRO_INTERACTIONS: 92,
        INTUITIVE_ONBOARDING: 86,
        EMOTIONAL_RESONANCE: 89,
      });

      expect(result.milestoneId).toBe("m2-dashboard");
      expect(result.compositeScore).toBe(89);
      expect(result.passed).toBe(true);
      expect(result.isMilestoneSignOffBlocked).toBe(false);
      expect(result.blockingDeficitsCount).toBe(0);
      expect(result.summary).toContain("PASSED");

      const signOffStatus = auditor.canSignOffMilestone("m2-dashboard");
      expect(signOffStatus.canSignOff).toBe(true);
      expect(signOffStatus.blockingReasons.length).toBe(0);

      const signed = auditor.signOffMilestone("m2-dashboard", "Auditor-Tier3");
      expect(signed.signedOff).toBe(true);
      expect(signed.signer).toBe("Auditor-Tier3");
    });

    it("blocks milestone sign-off when composite score is below 85", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const result = auditor.auditMilestoneErgonomics("m3-settings", {
        VISUAL_HIERARCHY: 75,
        LAYOUT_FLUIDITY: 70,
        TACTILE_MICRO_INTERACTIONS: 80,
        INTUITIVE_ONBOARDING: 72,
        EMOTIONAL_RESONANCE: 78,
      });

      expect(result.compositeScore).toBe(75);
      expect(result.passed).toBe(false);
      expect(result.isMilestoneSignOffBlocked).toBe(true);
      expect(result.summary).toContain("FAILED");

      const signOffStatus = auditor.canSignOffMilestone("m3-settings");
      expect(signOffStatus.canSignOff).toBe(false);
      expect(signOffStatus.blockingReasons.length).toBeGreaterThan(0);
      expect(signOffStatus.blockingReasons[0]).toContain("below the required pass threshold");
    });

    it("auto-generates BLOCKING notice when a pillar score is critically low (<50)", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const result = auditor.auditMilestoneErgonomics("m4-editor", {
        VISUAL_HIERARCHY: 95,
        LAYOUT_FLUIDITY: 95,
        TACTILE_MICRO_INTERACTIONS: 40, // critically low latency/responsiveness
        INTUITIVE_ONBOARDING: 95,
        EMOTIONAL_RESONANCE: 95,
      });

      // Composite = (95*4 + 40) / 5 = 420 / 5 = 84
      expect(result.passed).toBe(false);
      expect(result.blockingDeficitsCount).toBe(1);
      expect(result.isMilestoneSignOffBlocked).toBe(true);

      const blocking = auditor.getBlockingDeficits("m4-editor");
      expect(blocking.length).toBe(1);
      expect(blocking[0]?.pillar).toBe("TACTILE_MICRO_INTERACTIONS");
      expect(blocking[0]?.severity).toBe("BLOCKING");
    });

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
