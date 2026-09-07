import { describe, expect, it, TokenComplianceImmunity } from "../fixtures.ts";

describe("Design System Tokens - Sovereign Constants & Raw Value Policy", () => {
  describe("3. Implementer Token-Compliance Immunity Engine", () => {
    it("should validate compliant style adjustment requests", () => {
      const immunity = new TokenComplianceImmunity();
      const check = immunity.validateRequestCompliance({
        reviewerName: "UI Visual Reviewer",
        componentTarget: "PrimaryButton",
        requestedProperty: "padding",
        requestedValue: "16px",
        reviewerCritique: "Button needs more padding",
      });

      expect(check.compliant).toBe(true);
    });

    it("should identify non-compliant style requests and generate structured immunity defense receipts", () => {
      const immunity = new TokenComplianceImmunity();
      const request = {
        reviewerName: "UI Visual Reviewer",
        componentTarget: "NavigationBar",
        requestedProperty: "margin-left",
        requestedValue: "13px",
        reviewerCritique: "Nudge left margin by exactly 13px for custom optical balance",
      };

      const check = immunity.validateRequestCompliance(request);
      expect(check.compliant).toBe(false);
      expect(check.suggestedTokens?.[0]).toContain("12px");

      const defense = immunity.generateImmunityDefense(request);
      expect(defense.defenseId).toContain("DEFENSE-TKN-");
      expect(defense.status).toBe("INVOKED");
      expect(defense.citedTokenStandard).toContain("SPACING_TOKENS");
      expect(defense.compliantAlternative.tokenName).toBe("sm");
      expect(defense.compliantAlternative.tokenValue).toBe(12);
      expect(defense.compliantAlternative.cssExpression).toContain("--spacing-sm");
      expect(defense.defenseReasoning).toContain("Token-Compliance Immunity");
      expect(defense.defenseReasoning).toContain("Master Strategic Blueprint Section 12.2");
      expect(defense.defenseReasoning).toContain("rejected");
    });
  });
});
