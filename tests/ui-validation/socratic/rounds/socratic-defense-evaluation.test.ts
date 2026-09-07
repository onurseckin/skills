import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  type DefenseSubmission,
  evaluateSubstantiveDefense,
  resetDefaultSocraticDialecticEngine,
} from "../../fixtures.ts";

describe("Socratic Dialectic - Substantive Defense Evaluation", () => {
  beforeEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  describe("2. Substantive Defense Evaluation & Cognitive Challenge Quotas", () => {
    it("should reject defenses with trivial boilerplate phrases", () => {
      const trivialPhrases = [
        "lgtm",
        "looks good",
        "looks good to me",
        "fixed",
        "fixed it",
        "done",
        "ok",
        "fine",
        "resolved",
        "no issue",
        "no change needed",
        "as expected",
        "working fine",
        "it works",
      ];

      for (const phrase of trivialPhrases) {
        const submission: DefenseSubmission = {
          challengeId: "test-chall",
          rationale: phrase,
          evidenceReferences: ["token-123"],
        };
        const result = evaluateSubstantiveDefense(submission);
        expect(result.isAccepted).toBe(false);
        expect(result.score).toBeLessThan(70);
        expect(result.feedback).toContain("Defense rejected");
      }
    });

    it("should reject defenses that are too short (< MIN_SUBSTANTIVE_DEFENSE_LENGTH)", () => {
      const submission: DefenseSubmission = {
        challengeId: "test-chall",
        rationale: "Small fix applied",
        evidenceReferences: ["token-123"],
      };
      const result = evaluateSubstantiveDefense(submission);
      expect(result.isAccepted).toBe(false);
      expect(result.reasons.some((r) => r.includes("too brief"))).toBe(true);
    });

    it("should reject defenses without evidence references and without architectural tradeoffs", () => {
      const submission: DefenseSubmission = {
        challengeId: "test-chall",
        rationale:
          "The container width has been aligned to the golden ratio grid structure to ensure proper visual breathing room.",
      };
      const result = evaluateSubstantiveDefense(submission);
      expect(result.isAccepted).toBe(false);
      expect(result.reasons.some((r) => r.includes("evidence reference"))).toBe(true);
    });

    it("should accept substantive defenses with evidence references", () => {
      const submission: DefenseSubmission = {
        challengeId: "test-chall",
        rationale:
          "The container width adheres to the canonical 12-column responsive grid with 24px gutters at desktop breakpoints.",
        evidenceReferences: ["token:spacing.lg", "artifact:grid-measurement-diff-01"],
      };
      const result = evaluateSubstantiveDefense(submission);
      expect(result.isAccepted).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.reasons).toHaveLength(0);
    });

    it("should accept substantive defenses with architectural tradeoff justification", () => {
      const submission: DefenseSubmission = {
        challengeId: "test-chall",
        rationale:
          "The card elevation tier was adjusted from 2dp to 4dp to ensure clear separation from the background canvas.",
        architecturalTradeoff:
          "Accepted minor shadow spread increase in exchange for superior tactile hierarchy in low-contrast ambient environments.",
      };
      const result = evaluateSubstantiveDefense(submission);
      expect(result.isAccepted).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(85);
    });
  });
});
