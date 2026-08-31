import { describe, it, expect } from "bun:test";
import {
  SUPERFICIAL_PATTERNS,
  rejectSuperficialClaims,
  detectDomainBatching,
  validateReviewPushbackCriteria,
} from "../../../olt/scripts/src/authority/review/index.ts";

describe("Review Pushback - Superficiality & Batching Validation", () => {
  describe("SUPERFICIAL_PATTERNS and rejectSuperficialClaims", () => {
    it("identifies empty or whitespace claims as superficial with max confidence", () => {
      const emptyRes = rejectSuperficialClaims("");
      expect(emptyRes.isSuperficial).toBe(true);
      expect(emptyRes.matchedPatterns).toEqual(["empty_text"]);
      expect(emptyRes.reason).toContain("empty or whitespace");
      expect(emptyRes.confidenceScore).toBe(1.0);

      const whitespaceRes = rejectSuperficialClaims("   \t\n  ");
      expect(whitespaceRes.isSuperficial).toBe(true);
      expect(whitespaceRes.matchedPatterns).toEqual(["empty_text"]);
      expect(whitespaceRes.confidenceScore).toBe(1.0);
    });

    it("matches each regex pattern in SUPERFICIAL_PATTERNS for short vague phrases", () => {
      const testPhrases = [
        "lgtm",
        "looks good",
        "looks fine",
        "looks ok",
        "looks okay",
        "all tests pass",
        "tests pass",
        "all passing",
        "tests green",
        "done",
        "verified",
        "approved",
        "passed",
        "complete",
        "finished",
        "everything works",
        "works as expected",
        "no issues found",
        "no problems",
        "passed without issues",
        "all requirements met",
        "looks good to me",
        "checked and verified",
        "verified manually",
        "good to go",
      ];

      for (const phrase of testPhrases) {
        const res = rejectSuperficialClaims(phrase);
        expect(res.isSuperficial).toBe(true);
        expect(res.matchedPatterns.length).toBeGreaterThan(0);
        expect(res.confidenceScore).toBe(0.95);
        expect(res.reason).toContain(phrase);
      }
    });

    it("evaluates longer phrases matching superficial patterns without evidence", () => {
      const longSuperficial =
        "Looks good to me and everything works fine across all standard modules.";
      expect(longSuperficial.length).toBeGreaterThanOrEqual(25);

      const res = rejectSuperficialClaims(longSuperficial);
      expect(res.isSuperficial).toBe(true);
      expect(res.confidenceScore).toBe(0.75);
      expect(res.reason).toContain("matches superficial pattern");
    });

    it("passes substantive claims with concrete task details and evidence", () => {
      const substantiveClaim =
        "Validated state transition machine for task T-102 and confirmed lease heartbeats renew as expected.";
      const res = rejectSuperficialClaims(substantiveClaim, [{ kind: "test_run", output: "pass" }]);
      expect(res.isSuperficial).toBe(false);
      expect(res.matchedPatterns).toEqual([]);
      expect(res.reason).toBeNull();
      expect(res.confidenceScore).toBe(0.0);
    });

    it("passes long claims with matched patterns when substantive evidence is provided", () => {
      const longPhraseWithEvidence =
        "All requirements met with thorough automated test execution covering edge cases.";
      expect(longPhraseWithEvidence.length).toBeGreaterThanOrEqual(25);
      const res = rejectSuperficialClaims(longPhraseWithEvidence, [{ kind: "log", diff: "+line" }]);
      expect(res.isSuperficial).toBe(false);
      expect(res.confidenceScore).toBe(0.0);
      expect(res.reason).toBeNull();
    });
  });

  describe("detectDomainBatching", () => {
    it("returns not batched when 0 or 1 domain is provided", () => {
      const zeroRes = detectDomainBatching([]);
      expect(zeroRes.isBatched).toBe(false);
      expect(zeroRes.reasons).toEqual([]);
      expect(zeroRes.domainsEvaluated).toEqual([]);
      expect(zeroRes.violatingDomains).toEqual([]);

      const oneRes = detectDomainBatching(["code-quality"], { "code-quality": { passed: true } });
      expect(oneRes.isBatched).toBe(false);
      expect(oneRes.domainsEvaluated).toEqual(["code-quality"]);
      expect(oneRes.violatingDomains).toEqual([]);
    });

    it("detects missing or null domain evidence payloads in multi-domain evaluations", () => {
      const res = detectDomainBatching(["code-quality", "security"], {
        "code-quality": { pass: true },
        security: null,
      });

      expect(res.isBatched).toBe(true);
      expect(res.violatingDomains).toContain("security");
      expect(
        res.reasons.some((r) => r.includes("without dedicated domain-specific evidence")),
      ).toBe(true);
    });

    it("detects empty serialized evidence payloads ({}, [], empty string)", () => {
      const res1 = detectDomainBatching(["code-quality", "security"], {
        "code-quality": {},
        security: { audit: "ok" },
      });
      expect(res1.isBatched).toBe(true);
      expect(res1.violatingDomains).toContain("code-quality");
      expect(res1.reasons.some((r) => r.includes("has empty evidence payload"))).toBe(true);

      const res2 = detectDomainBatching(["system-design", "product"], {
        "system-design": [],
        product: "",
      });
      expect(res2.isBatched).toBe(true);
      expect(res2.violatingDomains).toEqual(["system-design", "product"]);
    });

    it("detects identical duplicate evidence payloads across different domains", () => {
      const sharedEvidence = { passed: true, score: 100 };
      const res = detectDomainBatching(["code-quality", "security", "system-design"], {
        "code-quality": sharedEvidence,
        security: sharedEvidence,
        "system-design": { distinct: "spec-checked" },
      });

      expect(res.isBatched).toBe(true);
      expect(res.violatingDomains).toContain("security");
      expect(
        res.reasons.some((r) => r.includes("shares identical duplicate evidence payload")),
      ).toBe(true);
    });

    it("passes when all domains have distinct, non-empty evidence payloads", () => {
      const res = detectDomainBatching(["code-quality", "security"], {
        "code-quality": { lint: "clean", format: "ok" },
        security: { vulnerability_scan: "0 findings" },
      });

      expect(res.isBatched).toBe(false);
      expect(res.violatingDomains).toEqual([]);
      expect(res.reasons).toEqual([]);
    });
  });

  describe("validateReviewPushbackCriteria", () => {
    it("validates review criteria and passes valid pushback input", () => {
      expect(() =>
        validateReviewPushbackCriteria("task-100", "coordinator-1", {
          validator_id: "validator-1",
          domain: "code-quality",
          cause: "substantive",
          observation: "Substantive verification proof failed.",
          remediation: "Fix unit test assertions.",
        }),
      ).not.toThrow();
    });
  });
});
