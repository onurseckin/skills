import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  resetDefaultMilestoneLockEngine,
  resetDefaultSocraticDialecticEngine,
  SocraticDialecticEngine,
} from "../../fixtures.ts";

describe("Socratic Dialectic - End-to-End Progressive Convergence", () => {
  beforeEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

  describe("11. End-to-End 5-Round Progressive Validation Convergence", () => {
    it("should execute a full 5-round dialectic cycle with adversarial challenges, arbitration, and lock integrity", () => {
      const engine = new SocraticDialecticEngine({ sessionId: "e2e-dialectics" });

      const r1c1 = engine.raiseChallenge({
        category: "grid-system",
        thesis: "Verify fluid grid column constraints at 375px mobile viewport.",
      });
      const r1c2 = engine.raiseChallenge({
        category: "landmarks",
        thesis: "Verify accessible ARIA landmark tags across core page templates.",
      });
      engine.submitDefense({
        challengeId: r1c1.challengeId,
        rationale: "Mobile viewport collapses grid to single column with 16px lateral padding.",
        evidenceReferences: ["token:spacing.md", "viewport:375px"],
      });
      engine.submitDefense({
        challengeId: r1c2.challengeId,
        rationale:
          "ARIA landmarks <header>, <main>, <footer> verified with zero duplicate banner roles.",
        evidenceReferences: ["dom:aria-snapshot"],
      });
      const r1Advance = engine.advanceRound({
        statePayload: {
          "layout.grid": "fluid-12",
          "layout.landmarks": ["header", "main", "footer"],
        },
      });
      expect(r1Advance.currentRound).toBe(2);

      const r2c1 = engine.raiseChallenge({
        category: "typographic-scale",
        thesis: "H1 font size causes title wrapping on narrow device viewports.",
      });
      const r2c2 = engine.raiseChallenge({
        category: "vertical-rhythm",
        thesis: "Paragraph line-height deviates from 8pt vertical baseline grid.",
      });

      for (let i = 0; i < 4; i++) {
        engine.submitDefense({ challengeId: r2c1.challengeId, rationale: "looks good" });
      }
      expect(r2c1.status).toBe("ESCALATED");

      engine.escalateToParetoArbitration({
        challengeId: r2c1.challengeId,
        competingForces: [
          { force: "Headline Impact", weight: 0.6 },
          { force: "Single-line Constraint", weight: 0.4 },
        ],
        candidateResolutions: [
          {
            id: "res-clamp",
            description: "Apply clamp(24px, 5vw, 36px) responsive font scaling.",
            score: 98,
            tradeoffs:
              "Optimal balance between headline prominence and viewport wrapping prevention.",
          },
        ],
      });

      engine.submitDefense({
        challengeId: r2c2.challengeId,
        rationale: "Baseline grid snapped to 24px line height (3x 8px baseline unit).",
        evidenceReferences: ["token:typography.line-height.base"],
      });

      const r2Advance = engine.advanceRound({
        statePayload: {
          "layout.grid": "fluid-12",
          "layout.landmarks": ["header", "main", "footer"],
          "typography.scale": "clamp-scale",
          "typography.rhythm": "8px-baseline",
        },
      });
      expect(r2Advance.currentRound).toBe(3);

      const r3c1 = engine.raiseChallenge({
        category: "dark-mode-contrast",
        thesis: "APCA contrast on primary CTA button falls below Lc 60 in dark theme.",
      });
      const r3c2 = engine.raiseChallenge({
        category: "surface-elevation",
        thesis:
          "Modal dialog surface elevation does not cast ambient occlusion shadow in dark mode.",
      });

      engine.submitDefense({
        challengeId: r3c1.challengeId,
        rationale:
          "Button text color shifted to token neutral-50 achieving APCA Lc 78.4 contrast against dark surface.",
        evidenceReferences: ["token:color.neutral-50", "audit:apca-contrast"],
      });
      engine.submitDefense({
        challengeId: r3c2.challengeId,
        rationale:
          "Dark mode elevation tier 3 applies 1px border highlight (rgba(255,255,255,0.12)) plus 16px soft shadow.",
        evidenceReferences: ["token:shadow.elevation-3", "theme:dark-elevation"],
      });

      const r3Advance = engine.advanceRound({
        statePayload: {
          "layout.grid": "fluid-12",
          "layout.landmarks": ["header", "main", "footer"],
          "typography.scale": "clamp-scale",
          "typography.rhythm": "8px-baseline",
          "color.contrast": "apca-lc-78",
          "color.elevation": "tier-3",
        },
      });
      expect(r3Advance.currentRound).toBe(4);

      const r4c1 = engine.raiseChallenge({
        category: "focus-rings",
        thesis: "Keyboard focus ring clipped by parent overflow: hidden container.",
      });
      const r4c2 = engine.raiseChallenge({
        category: "transition-budget",
        thesis: "Card hover lift animation drops frames on 60Hz display.",
      });
      engine.submitDefense({
        challengeId: r4c1.challengeId,
        rationale:
          "Focus indicator converted to focus-visible outline-offset: 2px within parent boundary.",
        evidenceReferences: ["a11y:focus-ring-metrics"],
      });
      engine.submitDefense({
        challengeId: r4c2.challengeId,
        rationale: "Hover lift utilizes GPU transform: translateY(-2px) ensuring 60fps budget.",
        evidenceReferences: ["perf:frame-budget-metrics"],
      });
      const r4Advance = engine.advanceRound({
        statePayload: {
          "layout.grid": "fluid-12",
          "layout.landmarks": ["header", "main", "footer"],
          "typography.scale": "clamp-scale",
          "typography.rhythm": "8px-baseline",
          "color.contrast": "apca-lc-78",
          "color.elevation": "tier-3",
          "motion.focus": "outline-offset-2px",
          "motion.hover": "gpu-transform",
        },
      });
      expect(r4Advance.currentRound).toBe(5);

      const r5Advance = engine.advanceRound({
        statePayload: {
          "layout.grid": "fluid-12",
          "layout.landmarks": ["header", "main", "footer"],
          "typography.scale": "clamp-scale",
          "typography.rhythm": "8px-baseline",
          "color.contrast": "apca-lc-78",
          "color.elevation": "tier-3",
          "motion.focus": "outline-offset-2px",
          "motion.hover": "gpu-transform",
          "optical.synthesis": "zero-defect-converged",
        },
      });

      expect(r5Advance.isFinalRoundCompleted).toBe(true);
      expect(r5Advance.sessionCompleted).toBe(true);
      expect(engine.isComplete()).toBe(true);

      const summary = engine.getSessionSummary();
      expect(summary.isComplete).toBe(true);
      expect(summary.sealedMilestonesCount).toBe(5);
      expect(summary.arbitratedDecisionsCount).toBe(1);
      expect(summary.totalChallenges).toBe(8);
      expect(summary.defendedChallenges).toBe(8);

      expect(() => engine.getMilestoneEngine().assertIntegrity()).not.toThrow();
      const allManifests = engine.getMilestoneEngine().listManifests();
      expect(allManifests).toHaveLength(5);
    });
  });
});
