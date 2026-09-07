import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  CompositeKeyParser,
  EvidenceLifecycleEngine,
  HarnessError,
  LifecycleManager,
  VisualDeltaComparator,
  getDefaultEvidenceLifecycleEngine,
  resetDefaultEvidenceLifecycleEngine,
  setDefaultEvidenceLifecycleEngine,
} from "../fixtures.ts";

describe("Evidence Lifecycle - Deltas & Cross-Module Integration", () => {
  beforeEach(() => {
    resetDefaultEvidenceLifecycleEngine();
  });

  afterEach(() => {
    resetDefaultEvidenceLifecycleEngine();
  });

  describe("Three-Tier Evidence Lifecycle Architecture", () => {
    it("registers artifacts, promotes to milestone anchors, and prunes superseded intermediates (Tier 3)", () => {
      const manager = new LifecycleManager(1);

      const artR1_1 = CompositeKeyParser.extractMetadata("auth_r1_login_default_1440x900", {
        sizeBytes: 1000,
      });
      const artR1_2 = CompositeKeyParser.extractMetadata("auth_r1_login_error_1440x900", {
        sizeBytes: 2000,
      });
      const artR2_1 = CompositeKeyParser.extractMetadata("auth_r2_login_default_1440x900", {
        sizeBytes: 1100,
      });

      manager.registerArtifact(artR1_1);
      manager.registerArtifact(artR1_2);
      manager.registerArtifact(artR2_1);

      const promoted = manager.promoteToMilestoneAnchor(artR1_1.keyString);
      expect(promoted.tier).toBe(2);
      expect(promoted.isMilestoneAnchor).toBe(true);

      const initialStats = manager.getStorageStats();
      expect(initialStats.tier1Count).toBe(2);
      expect(initialStats.tier2Count).toBe(1);
      expect(initialStats.totalActiveCount).toBe(3);

      const advanceRes = manager.advanceRound(3);
      expect(advanceRes.prunedKeys).toContain(artR1_2.keyString);
      expect(advanceRes.retainedKeys).toContain(artR1_1.keyString);
      expect(advanceRes.retainedKeys).toContain(artR2_1.keyString);

      expect(manager.getArtifact(artR1_2.keyString)).toBeUndefined();
      expect(manager.getArtifact(artR1_1.keyString)).toBeDefined();

      const finalStats = manager.getStorageStats();
      expect(finalStats.tier3PrunedCount).toBe(1);
      expect(finalStats.tier3PrunedSizeBytes).toBe(2000);
      expect(finalStats.tier2Count).toBe(1);
      expect(finalStats.tier1Count).toBe(1);
      expect(finalStats.totalActiveCount).toBe(2);
    });

    it("throws HarnessError on invalid round advancement or missing artifact promotion", () => {
      const manager = new LifecycleManager(2);
      expect(() => manager.advanceRound(1)).toThrow(HarnessError);
      expect(() => manager.promoteToMilestoneAnchor("non-existent-artifact")).toThrow(HarnessError);
      expect(() =>
        manager.registerArtifact(null as unknown as Parameters<typeof manager.registerArtifact>[0]),
      ).toThrow(HarnessError);
    });
  });

  describe("Perceptual Difference Heatmaps & Lightweight Visual Delta Reporting", () => {
    it("computes visual delta and classifies severity correctly", () => {
      const comparator = new VisualDeltaComparator();

      expect(comparator.classifySeverity(0.0)).toBe("NONE");
      expect(comparator.classifySeverity(0.002)).toBe("MINOR");
      expect(comparator.classifySeverity(0.03)).toBe("SIGNIFICANT");
      expect(comparator.classifySeverity(0.1)).toBe("CRITICAL");

      const identical = comparator.computeDelta({
        baselineWidth: 1000,
        baselineHeight: 1000,
        candidateWidth: 1000,
        candidateHeight: 1000,
        totalPixels: 1000000,
        differingPixels: 0,
      });
      expect(identical.passed).toBe(true);
      expect(identical.severity).toBe("NONE");
      expect(identical.shiftDetected).toBe(false);

      const minorDiff = comparator.computeDelta({
        baselineWidth: 1000,
        baselineHeight: 1000,
        candidateWidth: 1000,
        candidateHeight: 1000,
        totalPixels: 1000000,
        differingPixels: 1000,
      });
      expect(minorDiff.passed).toBe(true);
      expect(minorDiff.severity).toBe("MINOR");

      const criticalDiff = comparator.computeDelta({
        baselineWidth: 1000,
        baselineHeight: 1000,
        candidateWidth: 1200,
        candidateHeight: 1000,
        totalPixels: 1000000,
        differingPixels: 80000,
      });
      expect(criticalDiff.passed).toBe(false);
      expect(criticalDiff.severity).toBe("CRITICAL");
      expect(criticalDiff.shiftDetected).toBe(true);
    });

    it("clusters spatially adjacent differing pixels into bounding boxes", () => {
      const comparator = new VisualDeltaComparator();
      const coords = [
        { x: 10, y: 10 },
        { x: 12, y: 11 },
        { x: 15, y: 14 },
        { x: 200, y: 200 },
        { x: 205, y: 202 },
      ];

      const clusters = comparator.clusterDifferingPixels(coords, 20);
      expect(clusters.length).toBe(2);
      expect(clusters[0].pixelCount).toBe(3);
      expect(clusters[1].pixelCount).toBe(2);
    });

    it("throws HarnessError on invalid delta comparator inputs", () => {
      const comparator = new VisualDeltaComparator();
      expect(() =>
        comparator.computeDelta(null as unknown as Parameters<typeof comparator.computeDelta>[0]),
      ).toThrow(HarnessError);
    });
  });

  describe("EvidenceLifecycleEngine Singleton", () => {
    it("manages singleton instance getters, setters, and resetters", () => {
      const engine1 = getDefaultEvidenceLifecycleEngine();
      const engine2 = getDefaultEvidenceLifecycleEngine();
      expect(engine1).toBe(engine2);

      const custom = new EvidenceLifecycleEngine();
      setDefaultEvidenceLifecycleEngine(custom);
      expect(getDefaultEvidenceLifecycleEngine()).toBe(custom);

      resetDefaultEvidenceLifecycleEngine();
      const fresh = getDefaultEvidenceLifecycleEngine();
      expect(fresh).not.toBe(custom);
    });
  });
});
