import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  getDefaultBrowserChoreographyEngine,
  getDefaultEvidenceLifecycleEngine,
  getDefaultMotionVerificationEngine,
  resetDefaultBrowserChoreographyEngine,
  resetDefaultEvidenceLifecycleEngine,
  resetDefaultMotionVerificationEngine,
  type CompositeArtifactKey,
} from "../fixtures.ts";

describe("Wave 2 Cross-Module Integration", () => {
  beforeEach(() => {
    resetDefaultBrowserChoreographyEngine();
    resetDefaultMotionVerificationEngine();
    resetDefaultEvidenceLifecycleEngine();
  });

  afterEach(() => {
    resetDefaultBrowserChoreographyEngine();
    resetDefaultMotionVerificationEngine();
    resetDefaultEvidenceLifecycleEngine();
  });

  it("coordinates journey flow, motion pre-flight verification, and evidence artifact lifecycle", async () => {
    const browserEngine = getDefaultBrowserChoreographyEngine();
    const motionEngine = getDefaultMotionVerificationEngine();
    const evidenceEngine = getDefaultEvidenceLifecycleEngine();

    const journeyResult = await browserEngine.journeys.executeJourney({
      id: "e2e-nav-motion-flow",
      name: "E2E Navigation & Motion Flow",
      initialRoute: "/dashboard",
      steps: [
        {
          id: "step-1",
          name: "Open Modal",
          route: "/dashboard",
          action: "click",
          targetSelector: "#btn-open-settings",
          expectedBreadcrumbs: ["App", "Dashboard"],
        },
      ],
    });
    expect(journeyResult.success).toBe(true);

    const motionResult = motionEngine.preFlight.auditAnimation({
      animationName: "modal-fade-in",
      targetSelector: ".modal-backdrop",
      animatedProperties: ["opacity", "transform"],
      frameSamples: Array.from({ length: 60 }, (_, i) => ({
        timestampMs: i * 16.6,
        durationMs: 16.6,
      })),
      layoutShifts: [{ shiftScore: 0.0001 }],
    });
    expect(motionResult.passed).toBe(true);

    const artifactKey: CompositeArtifactKey = {
      epic: "settings",
      round: 1,
      route: "dashboard-modal",
      state: "open",
      viewport: "1440x900",
    };
    const keyString = evidenceEngine.parser.serialize(artifactKey, "");

    const stability = evidenceEngine.stabilityBarrier.evaluateStability(keyString, {
      inFlightRequests: 0,
      networkQuiescenceDurationMs: 600,
      fontsReady: true,
      unrenderedAssetCount: 0,
      activeAnimationsCount: 0,
      layoutShiftDelta: 0,
    });
    expect(stability.stable).toBe(true);

    const artifact = evidenceEngine.parser.extractMetadata(artifactKey, {
      sizeBytes: 450000,
      readinessToken: stability.readinessToken,
    });
    evidenceEngine.manager.registerArtifact(artifact);

    expect(evidenceEngine.manager.getArtifact(keyString)).toBeDefined();
  });
});
