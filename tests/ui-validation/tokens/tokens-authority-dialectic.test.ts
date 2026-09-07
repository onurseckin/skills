import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  CompositionalDialecticEngine,
  getDefaultTokenAuthorityEngine,
  RawValuePolicyValidator,
  resetDefaultTokenAuthorityEngine,
  setDefaultTokenAuthorityEngine,
  TokenAuthorityEngine,
  TokenComplianceImmunity,
} from "../fixtures.ts";

describe("Design System Tokens - Dialectic & Evolution Protocol", () => {
  beforeEach(() => {
    resetDefaultTokenAuthorityEngine();
  });

  afterEach(() => {
    resetDefaultTokenAuthorityEngine();
  });

  describe("4. Constructive Compositional Dialectic Engine", () => {
    it("should approve harmonized token compositions", () => {
      const dialectic = new CompositionalDialecticEngine();
      const result = dialectic.evaluateComposition({
        componentName: "HeroHeading",
        hierarchyLevel: "h1",
        fontSize: "4xl",
        lineHeight: "tight",
        fontWeight: "bold",
      });

      expect(result.harmonized).toBe(true);
      expect(result.elevationScore).toBe(100);
      expect(result.recommendations.length).toBe(0);
    });

    it("should recommend elevations for fragmented heading line-height and undersized H1 font", () => {
      const dialectic = new CompositionalDialecticEngine();
      const result = dialectic.evaluateComposition({
        componentName: "MainTitle",
        hierarchyLevel: "h1",
        fontSize: "base",
        lineHeight: "loose",
      });

      expect(result.harmonized).toBe(false);
      expect(result.elevationScore).toBeLessThan(80);
      expect(result.recommendations.length).toBe(2);

      const fontRec = result.recommendations.find((r) => r.category === "typographic_contrast");
      expect(fontRec).toBeDefined();
    });

    it("should recommend breathing room for crowded card containers", () => {
      const dialectic = new CompositionalDialecticEngine();
      const result = dialectic.evaluateComposition({
        componentName: "DashboardCard",
        hierarchyLevel: "card",
        spacingInner: "none",
        shadowElevation: "none",
        borderRadius: "none",
      });

      expect(result.harmonized).toBe(false);
      const spatialRec = result.recommendations.find((r) => r.category === "spatial_rhythm");
      expect(spatialRec?.suggestedComposition).toContain("md (16px) or lg (24px)");
    });
  });

  describe("6. Token Authority Engine & Singletons", () => {
    it("should manage default singleton instance", () => {
      const defaultEngine = getDefaultTokenAuthorityEngine();
      expect(defaultEngine).toBeInstanceOf(TokenAuthorityEngine);
      expect(defaultEngine.immunity).toBeInstanceOf(TokenComplianceImmunity);
      expect(defaultEngine.policyValidator).toBeInstanceOf(RawValuePolicyValidator);

      const customEngine = new TokenAuthorityEngine();
      setDefaultTokenAuthorityEngine(customEngine);
      expect(getDefaultTokenAuthorityEngine()).toBe(customEngine);

      resetDefaultTokenAuthorityEngine();
      expect(getDefaultTokenAuthorityEngine()).not.toBe(customEngine);
    });
  });
});
