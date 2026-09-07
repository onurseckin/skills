import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  HarnessError,
  JourneyFlowEngine,
  resetDefaultBrowserChoreographyEngine,
  type JourneyFlow,
} from "../fixtures.ts";

describe("Browser Choreography - Journey Flows & Breadcrumbs", () => {
  beforeEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  afterEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  describe("Active Journey Flows & Breadcrumb Continuity", () => {
    it("verifies breadcrumb continuity matching and mismatch detection", () => {
      const engine = new JourneyFlowEngine();
      const expected = ["Home", "Settings", "Security", "2FA"];
      const exactMatch = ["Home", "Settings", "Security", "2FA"];
      const missing = ["Home", "Settings"];
      const extra = ["Home", "Settings", "Security", "2FA", "Logs"];
      const outOfOrder = ["Home", "Security", "Settings", "2FA"];

      const matchRes = engine.verifyBreadcrumbContinuity(expected, exactMatch);
      expect(matchRes.match).toBe(true);
      expect(matchRes.missingBreadcrumbs.length).toBe(0);

      const missingRes = engine.verifyBreadcrumbContinuity(expected, missing);
      expect(missingRes.match).toBe(false);
      expect(missingRes.missingBreadcrumbs).toEqual(["Security", "2FA"]);

      const extraRes = engine.verifyBreadcrumbContinuity(expected, extra);
      expect(extraRes.match).toBe(false);
      expect(extraRes.unexpectedBreadcrumbs).toEqual(["Logs"]);

      const orderRes = engine.verifyBreadcrumbContinuity(expected, outOfOrder);
      expect(orderRes.match).toBe(false);
    });

    it("executes a complete multi-step journey flow successfully", async () => {
      const engine = new JourneyFlowEngine();
      const flow: JourneyFlow = {
        id: "checkout-journey",
        name: "Checkout Purchase Flow",
        initialRoute: "/cart",
        steps: [
          {
            id: "s1",
            name: "Review Cart",
            route: "/cart",
            action: "navigate",
            expectedBreadcrumbs: ["Shop", "Cart"],
          },
          {
            id: "s2",
            name: "Enter Shipping",
            route: "/checkout/shipping",
            action: "input",
            expectedBreadcrumbs: ["Shop", "Cart", "Shipping"],
          },
          {
            id: "s3",
            name: "Confirm Order",
            route: "/checkout/confirmation",
            action: "click",
            expectedBreadcrumbs: ["Shop", "Cart", "Confirmation"],
          },
        ],
      };

      const result = await engine.executeJourney(flow, async (ctx) => {
        return {
          breadcrumbsObserved: ctx.step.expectedBreadcrumbs,
          actualRoute: ctx.step.route,
        };
      });

      expect(result.success).toBe(true);
      expect(result.executedSteps.length).toBe(3);
      expect(result.executedSteps.every((s) => s.status === "PASSED")).toBe(true);
      expect(result.breadcrumbContinuityPassed).toBe(true);
      expect(result.violations.length).toBe(0);
    });

    it("throws HarnessError on invalid breadcrumb inputs", () => {
      const engine = new JourneyFlowEngine();
      expect(() => engine.verifyBreadcrumbContinuity(null as unknown as never, [])).toThrow(
        HarnessError,
      );
    });
  });
});
