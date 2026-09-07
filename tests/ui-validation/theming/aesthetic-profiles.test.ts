import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  AestheticProfileEvaluator,
  ENTERPRISE_ACCOUNTING_PROFILE,
  FLEET_TELEMATICS_PROFILE,
  getDefaultAestheticProfileEvaluator,
  LUXURY_HOSPITALITY_PROFILE,
  OPTICAL_DIMENSION_METADATA,
  OPTICAL_DIMENSIONS,
  resetDefaultAestheticProfileEvaluator,
  setDefaultAestheticProfileEvaluator,
  STANDARD_AESTHETIC_PROFILES,
} from "../fixtures.ts";

describe("Aesthetic Profiles & Optical Dimensions", () => {
  beforeEach(() => {
    resetDefaultAestheticProfileEvaluator();
  });

  afterEach(() => {
    resetDefaultAestheticProfileEvaluator();
  });

  describe("12. Eight Optical Dimensions & Industry Aesthetic Profiles", () => {
    it("should define all eight optical dimensions with metadata", () => {
      expect(OPTICAL_DIMENSIONS.length).toBe(8);
      for (const dim of OPTICAL_DIMENSIONS) {
        expect(OPTICAL_DIMENSION_METADATA[dim]).toBeDefined();
        expect(OPTICAL_DIMENSION_METADATA[dim].name).toBeDefined();
        expect(OPTICAL_DIMENSION_METADATA[dim].description).toBeDefined();
      }
    });

    it("should provide calibrated standard profiles for Enterprise, Luxury, and Telematics", () => {
      expect(ENTERPRISE_ACCOUNTING_PROFILE.profileId).toBe("enterprise_accounting");
      expect(ENTERPRISE_ACCOUNTING_PROFILE.enforceMonospaceForNumbers).toBe(true);

      expect(LUXURY_HOSPITALITY_PROFILE.profileId).toBe("luxury_hospitality");
      expect(LUXURY_HOSPITALITY_PROFILE.requireGenerousWhitespace).toBe(true);

      expect(FLEET_TELEMATICS_PROFILE.profileId).toBe("fleet_telematics");
      expect(FLEET_TELEMATICS_PROFILE.minTouchTargetPx).toBe(48);
      expect(FLEET_TELEMATICS_PROFILE.requireStatusColorEncoding).toBe(true);

      expect(STANDARD_AESTHETIC_PROFILES.enterprise_accounting).toBe(ENTERPRISE_ACCOUNTING_PROFILE);
    });

    it("should manage default singleton instance for AestheticProfileEvaluator", () => {
      const defaultEval = getDefaultAestheticProfileEvaluator();
      expect(defaultEval).toBeInstanceOf(AestheticProfileEvaluator);

      const customEval = new AestheticProfileEvaluator();
      setDefaultAestheticProfileEvaluator(customEval);
      expect(getDefaultAestheticProfileEvaluator()).toBe(customEval);

      resetDefaultAestheticProfileEvaluator();
      expect(getDefaultAestheticProfileEvaluator()).not.toBe(customEval);
    });
  });
});
