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
  describe("4. Ergonomic Walkthrough Audit Execution & Sign-Off Gating", () => {
    it("passes a milestone meeting all pillar criteria with score >= 85 and zero blocking deficits", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const result: ErgonomicAuditResult = auditor.auditMilestoneErgonomics("m-dashboard-v2", {
        VISUAL_HIERARCHY: 92,
        LAYOUT_FLUIDITY: 88,
        TACTILE_MICRO_INTERACTIONS: 94,
        INTUITIVE_ONBOARDING: 86,
        EMOTIONAL_RESONANCE: 90,
      });

      expect(result.milestoneId).toBe("m-dashboard-v2");
      expect(result.compositeScore).toBe(90);
      expect(result.passed).toBe(true);
      expect(result.isMilestoneSignOffBlocked).toBe(false);
      expect(result.blockingDeficitsCount).toBe(0);
      expect(result.summary).toContain("PASSED");

      const signOffStatus: MilestoneSignOffStatus = auditor.canSignOffMilestone("m-dashboard-v2");
      expect(signOffStatus.canSignOff).toBe(true);
      expect(signOffStatus.blockingReasons).toHaveLength(0);

      const signOffResult = auditor.signOffMilestone("m-dashboard-v2", "LeadCraftAuditor");
      expect(signOffResult.signedOff).toBe(true);
      expect(signOffResult.signer).toBe("LeadCraftAuditor");
      expect(signOffResult.signedOffAt).toBeDefined();
    });

    it("blocks milestone sign-off when composite craft score is below 85", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const result = auditor.auditMilestoneErgonomics("m-analytics", {
        VISUAL_HIERARCHY: 72,
        LAYOUT_FLUIDITY: 70,
        TACTILE_MICRO_INTERACTIONS: 75,
        INTUITIVE_ONBOARDING: 70,
        EMOTIONAL_RESONANCE: 73,
      });

      expect(result.compositeScore).toBe(72);
      expect(result.passed).toBe(false);
      expect(result.isMilestoneSignOffBlocked).toBe(true);

      const signOff = auditor.canSignOffMilestone("m-analytics");
      expect(signOff.canSignOff).toBe(false);
      expect(
        signOff.blockingReasons.some((r) => r.includes("below the required pass threshold")),
      ).toBe(true);

      // Attempting to sign off fails
      const failedSignOff = auditor.signOffMilestone("m-analytics", "LeadCraftAuditor");
      expect(failedSignOff.signedOff).toBe(false);
    });

    it("blocks sign-off if explicit BLOCKING deficits exist even if composite score is >= 85", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const explicitDeficits: DeficitInput[] = [
        {
          pillar: "TACTILE_MICRO_INTERACTIONS",
          severity: "BLOCKING",
          stepId: "step-export-btn",
          visualDefectDescription: "Export button provides 0 visual progress feedback for 15s task",
          remediationGuidance: "Add determinate progress bar and optimistic state update",
        },
      ];

      const result = auditor.auditMilestoneErgonomics(
        "m-reports",
        {
          VISUAL_HIERARCHY: 90,
          LAYOUT_FLUIDITY: 90,
          TACTILE_MICRO_INTERACTIONS: 85,
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

      const signOff = auditor.canSignOffMilestone("m-reports");
      expect(signOff.canSignOff).toBe(false);
      expect(signOff.blockingReasons.some((r) => r.includes("BLOCKING"))).toBe(true);
    });

    it("resolves deficit notices and unblocks milestone sign-off", () => {
      const auditor = createErgonomicWalkthroughAuditor();

      const explicitDeficits: DeficitInput[] = [
        {
          pillar: "VISUAL_HIERARCHY",
          severity: "MAJOR",
          stepId: "step-header",
          visualDefectDescription: "Contrast ratio on primary badge is 3.1:1 (fails WCAG AA)",
          remediationGuidance: "Update background token to achieve >= 4.5:1 contrast",
        },
      ];

      const result = auditor.auditMilestoneErgonomics(
        {
          milestoneId: "m-navigation",
          milestoneTitle: "Main Navigation Header",
          isUserFacing: true,
        },
        {
          VISUAL_HIERARCHY: {
            score: 86,
            observations: ["Header typography verified"],
            deficits: explicitDeficits,
          },
          LAYOUT_FLUIDITY: 90,
          TACTILE_MICRO_INTERACTIONS: 90,
          INTUITIVE_ONBOARDING: 90,
          EMOTIONAL_RESONANCE: 90,
        },
      );

      expect(result.activeDeficitNotices).toHaveLength(1);
      const noticeId = result.activeDeficitNotices[0]?.id ?? "";
      expect(auditor.canSignOffMilestone("m-navigation").canSignOff).toBe(false);

      // Resolve the notice
      const resolved = auditor.resolveDeficitNotice(
        noticeId,
        "Applied new #1a1a2e token achieving 5.2:1 contrast ratio.",
      );

      expect(resolved.resolved).toBe(true);
      expect(resolved.resolutionSummary).toContain("5.2:1 contrast ratio");
      expect(auditor.getUnresolvedDeficits("m-navigation")).toHaveLength(0);

      // Now sign-off succeeds
      const signOffStatus = auditor.canSignOffMilestone("m-navigation");
      expect(signOffStatus.canSignOff).toBe(true);

      const signed = auditor.signOffMilestone("m-navigation", "ProductCraftSteward");
      expect(signed.signedOff).toBe(true);
    });
  });

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
