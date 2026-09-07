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

describe("Browser Choreography - Journey Failures & Error Handling", () => {
  beforeEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  afterEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  describe("Journey Flow Failures & Exception Handling", () => {
    it("handles step failure in journey flow and skips subsequent steps", async () => {
      const engine = new JourneyFlowEngine();
      const flow: JourneyFlow = {
        id: "auth-journey",
        name: "Authentication Journey",
        initialRoute: "/login",
        steps: [
          { id: "s1", name: "Visit Login", route: "/login", action: "navigate" },
          { id: "s2", name: "Submit Form", route: "/login", action: "click" },
          { id: "s3", name: "Dashboard", route: "/dashboard", action: "navigate" },
        ],
      };

      const result = await engine.executeJourney(flow, async (ctx) => {
        if (ctx.step.id === "s2") {
          return { error: "Form submission timed out" };
        }
        return {};
      });

      expect(result.success).toBe(false);
      expect(result.failedStep?.stepId).toBe("s2");
      expect(result.executedSteps[0].status).toBe("PASSED");
      expect(result.executedSteps[1].status).toBe("FAILED");
      expect(result.executedSteps[2].status).toBe("SKIPPED");
      expect(result.violations.length).toBe(1);
    });

    it("handles step handler thrown exceptions gracefully", async () => {
      const engine = new JourneyFlowEngine();
      const flow: JourneyFlow = {
        id: "error-journey",
        name: "Error Journey",
        initialRoute: "/start",
        steps: [{ id: "step-err", name: "Crash Step", route: "/crash", action: "custom" }],
      };

      const result = await engine.executeJourney(flow, async () => {
        throw new Error("Simulated browser session crash");
      });

      expect(result.success).toBe(false);
      expect(result.executedSteps[0].status).toBe("FAILED");
      expect(result.executedSteps[0].error).toContain("Simulated browser session crash");
    });

    it("throws HarnessError on invalid journey flow definitions", async () => {
      const engine = new JourneyFlowEngine();
      await expect(engine.executeJourney(null as unknown as never)).rejects.toThrow(HarnessError);
      await expect(
        engine.executeJourney({ id: "empty", name: "Empty", initialRoute: "/", steps: [] }),
      ).rejects.toThrow(HarnessError);
      expect(() => engine.verifyBreadcrumbContinuity(null as unknown as never, [])).toThrow(
        HarnessError,
      );
    });
  });
});
