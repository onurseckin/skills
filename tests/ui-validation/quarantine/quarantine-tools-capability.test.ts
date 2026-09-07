import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  OPTICAL_QUARANTINE_INVARIANTS,
  isOpticalValidatorRole,
  resetDefaultQuarantineEngine,
} from "../fixtures.ts";

describe("Tool Quarantine Engine - Roles & Invariants", () => {
  beforeEach(() => {
    resetDefaultQuarantineEngine();
  });

  afterEach(() => {
    resetDefaultQuarantineEngine();
  });

  describe("Optical Validator Role Identification", () => {
    it("identifies optical validator roles correctly", () => {
      expect(isOpticalValidatorRole("ui-optical-validator")).toBe(true);
      expect(isOpticalValidatorRole("ui-cognitive-validator")).toBe(true);
      expect(isOpticalValidatorRole("optical-validator")).toBe(true);
      expect(isOpticalValidatorRole("UI_OPTICAL_VALIDATOR")).toBe(true);
      expect(isOpticalValidatorRole("cognitive-ui-validator")).toBe(true);

      expect(isOpticalValidatorRole("implementer")).toBe(false);
      expect(isOpticalValidatorRole("coordinator")).toBe(false);
      expect(isOpticalValidatorRole("ui-mechanic-validator")).toBe(false);
      expect(isOpticalValidatorRole("ui-headless-validator")).toBe(false);
    });

    it("verifies optical quarantine invariants are defined", () => {
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK");
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("HEADFUL_VISUAL_SCREENSHOT_REVIEW_MANDATE");
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("ZERO_SOURCE_EDITS");
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("ZERO_SOURCE_READS");
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("ZERO_DIRECTORY_LISTINGS");
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("SUPERFICIAL_UI_APPROVAL_BAN");
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("HUMAN_GRADE_COGNITIVE_CRITIQUE");
    });
  });
});
