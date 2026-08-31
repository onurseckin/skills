import { describe, expect, it } from "bun:test";
import * as Validator from "../../../olt/scripts/src/capture/validator/index.ts";

describe("Capture Validator Barrel Exports (index.ts)", () => {
  it("exports all mechanical validator functions and utilities", () => {
    expect(Validator.NAMED_COLORS).toBeDefined();
    expect(typeof Validator.auditFocusRingContrast).toBe("function");
    expect(typeof Validator.calculateApcaLightness).toBe("function");
    expect(typeof Validator.calculateConcentricRadius).toBe("function");
    expect(typeof Validator.calculateOpticalCurvatureMetrics).toBe("function");
    expect(typeof Validator.calculateWcagLuminance).toBe("function");
    expect(typeof Validator.compositeColorOver).toBe("function");
    expect(typeof Validator.getSubpixelFraction).toBe("function");
    expect(typeof Validator.hslToRgb).toBe("function");
    expect(typeof Validator.parseCssColor).toBe("function");
    expect(typeof Validator.snapToDevicePixelRatio).toBe("function");
    expect(typeof Validator.srgbChannelToLinear).toBe("function");
    expect(typeof Validator.validateApcaElement).toBe("function");
    expect(typeof Validator.validateClsReservation).toBe("function");
    expect(typeof Validator.validateConcentricRadius).toBe("function");
    expect(typeof Validator.validateFocusRingOpticalSnapping).toBe("function");
    expect(typeof Validator.validateMechanical).toBe("function");
    expect(typeof Validator.validateNestedConcentricCorners).toBe("function");
    expect(typeof Validator.validateSidebarLayout).toBe("function");
    expect(typeof Validator.validateSubpixelSnapping).toBe("function");
    expect(typeof Validator.validateTouchTargetClearance).toBe("function");
    expect(typeof Validator.validateTouchTargetDimensions).toBe("function");
  });

  it("exports all cognitive validator functions and questionnaire engines", () => {
    expect(Validator.COGNITIVE_BOILERPLATE).toBeDefined();
    expect(typeof Validator.calculateFittsId).toBe("function");
    expect(typeof Validator.calculateHickHymanEntropy).toBe("function");
    expect(typeof Validator.evaluateCognitiveQuestions).toBe("function");
    expect(typeof Validator.validateCognitive).toBe("function");
    expect(typeof Validator.validateCognitiveSemanticDepth).toBe("function");
    expect(typeof Validator.validateCowanChunking).toBe("function");
    expect(typeof Validator.validateFittsLaw).toBe("function");
    expect(typeof Validator.validateHickHyman).toBe("function");
    expect(typeof Validator.validateNormanRecovery).toBe("function");
    expect(typeof Validator.validateUiStatesFsm).toBe("function");
  });

  it("exports all custom validator functions", () => {
    expect(typeof Validator.getExpectedAppleTracking).toBe("function");
    expect(typeof Validator.validateAppleOpticalTracking).toBe("function");
    expect(typeof Validator.validateCustom).toBe("function");
    expect(typeof Validator.validateFloatingUiCollision).toBe("function");
    expect(typeof Validator.validateGeistTokens).toBe("function");
    expect(typeof Validator.validateMaterialStateLayers).toBe("function");
    expect(typeof Validator.validateWaiAriaFocusTrap).toBe("function");
  });

  it("exports all synthesis and manifest writer functions", () => {
    expect(typeof Validator.formatManifestFilename).toBe("function");
    expect(typeof Validator.generateRemediations).toBe("function");
    expect(typeof Validator.isCertifiedManifest).toBe("function");
    expect(typeof Validator.loadCompanionManifest).toBe("function");
    expect(typeof Validator.saveCompanionManifest).toBe("function");
    expect(typeof Validator.synthesizeCompanionManifest).toBe("function");
  });

  it("functions exported from barrel execute end-to-end identically", () => {
    const ctx: Validator.ValidationContext = {
      screenId: "barrel_screen",
      viewport: "desktop",
      elements: [],
    };
    const manifest = Validator.synthesizeCompanionManifest(ctx);
    expect(Validator.isCertifiedManifest(manifest)).toBe(true);
  });
});
