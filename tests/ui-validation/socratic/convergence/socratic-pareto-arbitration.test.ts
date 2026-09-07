import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  type ParetoArbitrationInput,
  resetDefaultSocraticDialecticEngine,
  SocraticDialecticEngine,
} from "../../fixtures.ts";

describe("Socratic Dialectic - Pareto Arbitration Escalation", () => {
  beforeEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  describe("4. Adversarial Convergence & Pareto Arbitration Escalation", () => {
    it("should increment cycle count and escalate after 4 rejected defense attempts", () => {
      const engine = new SocraticDialecticEngine();
      const chall = engine.raiseChallenge({
        category: "contrast",
        thesis: "Text contrast ratio appears insufficient under dark mode theme.",
      });

      expect(chall.cyclesUsed).toBe(0);
      expect(chall.status).toBe("PENDING");

      engine.submitDefense({ challengeId: chall.challengeId, rationale: "looks good" });
      expect(chall.cyclesUsed).toBe(1);
      expect(chall.status).toBe("REJECTED");

      engine.submitDefense({ challengeId: chall.challengeId, rationale: "fixed now" });
      expect(chall.cyclesUsed).toBe(2);
      expect(chall.status).toBe("REJECTED");

      engine.submitDefense({
        challengeId: chall.challengeId,
        rationale: "Contrast was increased by changing color values to darker ones.",
      });
      expect(chall.cyclesUsed).toBe(3);
      expect(chall.status).toBe("REJECTED");

      engine.submitDefense({ challengeId: chall.challengeId, rationale: "lgtm" });
      expect(chall.cyclesUsed).toBe(4);
      expect(chall.status).toBe("ESCALATED");

      const readiness = engine.evaluateRoundReadiness();
      expect(readiness.isGateUnlocked).toBe(false);
      expect(readiness.escalatedChallengesCount).toBe(1);
    });

    it("should arbitrate deadlocked challenge using Pareto Arbitration Engine and unblock gate", () => {
      const engine = new SocraticDialecticEngine();
      const chall1 = engine.raiseChallenge({
        category: "density-vs-legibility",
        thesis: "High data density table clashes with luxury hospitality aesthetic profile.",
      });

      for (let i = 0; i < 4; i++) {
        engine.submitDefense({ challengeId: chall1.challengeId, rationale: "ok" });
      }
      expect(chall1.status).toBe("ESCALATED");

      const arbInput: ParetoArbitrationInput = {
        challengeId: chall1.challengeId,
        competingForces: [
          {
            force: "Information Density",
            weight: 0.5,
            argument: "Enterprise operators need 50 rows per screen.",
          },
          {
            force: "Visual Luxury Breathing Room",
            weight: 0.5,
            argument: "Brand guidelines require 32px line heights.",
          },
        ],
        candidateResolutions: [
          {
            id: "res-compact-toggle",
            description:
              "Provide user-configurable density toggle (Compact: 12px padding vs Spacious: 24px padding).",
            score: 95,
            tradeoffs:
              "Adds 1 UI toggle control in table header while preserving default luxury aesthetic.",
          },
          {
            id: "res-compromise-fixed",
            description: "Set fixed row height to 18px midway.",
            score: 70,
            tradeoffs: "Satisfies neither requirement fully.",
          },
        ],
      };

      const decision = engine.escalateToParetoArbitration(arbInput);
      expect(decision.winningResolutionId).toBe("res-compact-toggle");
      expect(decision.status).toBe("BINDING_RESOLVED");
      expect(decision.bindingDirectives.length).toBeGreaterThan(0);

      expect(chall1.status).toBe("DEFENDED");
      expect(chall1.defenseRecord?.isAccepted).toBe(true);
      expect(chall1.defenseRecord?.rationale).toContain("binding Pareto Arbitration");

      const chall2 = engine.raiseChallenge({
        category: "layout-structure",
        thesis: "Ensure table header sticks on scroll without layout jitter.",
      });
      engine.submitDefense({
        challengeId: chall2.challengeId,
        rationale:
          "Sticky table header is anchored using CSS position: sticky with z-index elevation token md.",
        evidenceReferences: ["token:z-index.md", "layout:table-sticky-test"],
      });

      const readiness = engine.evaluateRoundReadiness();
      expect(readiness.isGateUnlocked).toBe(true);
      expect(readiness.quotaMet).toBe(true);
    });
  });
});
