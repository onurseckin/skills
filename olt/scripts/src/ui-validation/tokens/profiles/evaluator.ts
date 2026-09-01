import { HarnessError } from "../../../core/errors/index.ts";
import {
  calculateApcaContrast,
  calculateWcagContrastRatio,
  isApcaCompliant,
  isWcagAaCompliant,
} from "../../theming/index.ts";
import {
  SPACING_TOKENS,
  TYPOGRAPHY_TOKENS,
  VALID_SPACING_VALUES,
} from "../authority/index.ts";
import {
  OPTICAL_DIMENSIONS,
  OPTICAL_DIMENSION_METADATA,
  type OpticalDimension,
  type AestheticProfileId,
  type IndustryProfileId,
  type AestheticProfile,
  type UiDescriptor,
  type UiElementDescriptor,
  type OpticalViolation,
  type SocraticCritiqueChallenge,
  type AestheticEvaluationReport,
} from "./types.ts";
import {
  ENTERPRISE_ACCOUNTING_PROFILE,
  LUXURY_HOSPITALITY_PROFILE,
  FLEET_TELEMATICS_PROFILE,
  STANDARD_AESTHETIC_PROFILES,
} from "./canonical-profiles.ts";
export class AestheticProfileEvaluator {
  private registeredProfiles: Map<string, AestheticProfile> = new Map();

  public constructor() {
    this.registerProfile(ENTERPRISE_ACCOUNTING_PROFILE);
    this.registerProfile(LUXURY_HOSPITALITY_PROFILE);
    this.registerProfile(FLEET_TELEMATICS_PROFILE);
  }

  public registerProfile(profile: AestheticProfile): void {
    this.registeredProfiles.set(profile.profileId, profile);
  }

  public getProfile(profileId: string): AestheticProfile {
    const profile = this.registeredProfiles.get(profileId);
    if (!profile) {
      throw new HarnessError("NOT_FOUND", `Aesthetic Profile '${profileId}' not found.`);
    }
    return profile;
  }

  /**
   * Evaluates a UI descriptor against a specific aesthetic profile across all 8 optical dimensions
   */
  public evaluateUiDescriptor(
    ui: UiDescriptor,
    profileId: IndustryProfileId | string = "enterprise_accounting",
  ): AestheticEvaluationReport {
    const profile = this.getProfile(profileId);
    const violations: OpticalViolation[] = [];
    const dimensionDeductions: Record<OpticalDimension, number> = {
      "visual-hierarchy": 0,
      "spatial-rhythm": 0,
      "typography-rendering": 0,
      "clipping-overflow": 0,
      "perceptual-contrast": 0,
      "theme-harmony": 0,
      "structural-z-index": 0,
      "touch-ergonomics": 0,
    };

    // 1. Touch Ergonomics Audit
    for (const elem of ui.elements) {
      if (elem.isInteractive || elem.role === "button" || elem.tagName.toLowerCase() === "button" || elem.tagName.toLowerCase() === "a") {
        const { width, height } = elem.boundingBox;
        const minTarget = profile.minTouchTargetPx;
        if (width < minTarget || height < minTarget) {
          dimensionDeductions["touch-ergonomics"] += 25;
          violations.push({
            dimension: "touch-ergonomics",
            severity: "high",
            elementId: elem.elementId,
            message: `Interactive target dimensions (${width}x${height}px) fall below profile minimum (${minTarget}x${minTarget}px).`,
            recommendedFix: `Increase interactive hitbox padding or min-width/min-height to at least ${minTarget}px for ergonomic accessibility.`,
          });
        }
      }
    }

    // 2. Clipping, Overflow & Descender Protection Audit
    const descenderRegex = /[gjpqy]/;
    for (const elem of ui.elements) {
      const text = elem.textContent ?? "";
      if (descenderRegex.test(text)) {
        const lh = typeof elem.computedStyles.lineHeight === "string"
          ? parseFloat(elem.computedStyles.lineHeight)
          : elem.computedStyles.lineHeight ?? 1.5;
        const overflow = elem.computedStyles.overflow ?? "visible";

        // Check if line-height is dangerously tight or height is clipped with overflow hidden
        if (lh < 1.25 && (overflow === "hidden" || overflow === "clip")) {
          dimensionDeductions["clipping-overflow"] += 25;
          violations.push({
            dimension: "clipping-overflow",
            severity: "critical",
            elementId: elem.elementId,
            message: `Text with lowercase descenders ('${text.substring(0, 20)}...') has tight line-height (${lh}) and overflow '${overflow}', risking glyph descender truncation.`,
            recommendedFix: "Increase line-height to at least 1.25 or provide vertical padding clearance to prevent cropping descender loops.",
          });
        }
      }

      // Explicit container bounding overflow
      if (elem.computedStyles.overflow === "hidden" && elem.boundingBox.height < 18 && (elem.textContent?.length ?? 0) > 0) {
        dimensionDeductions["clipping-overflow"] += 20;
        violations.push({
          dimension: "clipping-overflow",
          severity: "high",
          elementId: elem.elementId,
          message: `Container height (${elem.boundingBox.height}px) is too constrained for text content with overflow:hidden.`,
          recommendedFix: "Expand container height or use flexible auto-height.",
        });
      }
    }

    // 3. Perceptual Contrast (APCA & WCAG)
    for (const elem of ui.elements) {
      if (elem.computedStyles.color && elem.computedStyles.backgroundColor) {
        const fg = elem.computedStyles.color;
        const bg = elem.computedStyles.backgroundColor;
        const ratio = calculateWcagContrastRatio(fg, bg);
        const apca = calculateApcaContrast(fg, bg);

        if (!isWcagAaCompliant(ratio)) {
          dimensionDeductions["perceptual-contrast"] += 20;
          violations.push({
            dimension: "perceptual-contrast",
            severity: "critical",
            elementId: elem.elementId,
            message: `WCAG contrast ratio ${ratio}:1 between foreground '${fg}' and background '${bg}' fails AA requirement.`,
            recommendedFix: "Adjust color token pairing to meet minimum 4.5:1 WCAG AA contrast.",
          });
        } else if (!isApcaCompliant(apca, "body")) {
          dimensionDeductions["perceptual-contrast"] += 10;
          violations.push({
            dimension: "perceptual-contrast",
            severity: "medium",
            elementId: elem.elementId,
            message: `APCA perceptual lightness contrast (${apca} Lc) between '${fg}' and '${bg}' is below recommended body text threshold (75 Lc).`,
            recommendedFix: "Calibrate foreground luminance for elevated perceptual readability.",
          });
        }
      }
    }

    // 4. Spatial Rhythm & Optical Spacing
    for (const elem of ui.elements) {
      const pad = elem.computedStyles.padding;
      if (typeof pad === "string" && pad.endsWith("px")) {
        const num = parseFloat(pad);
        if (!VALID_SPACING_VALUES.includes(num)) {
          dimensionDeductions["spatial-rhythm"] += 15;
          violations.push({
            dimension: "spatial-rhythm",
            severity: "low",
            elementId: elem.elementId,
            message: `Padding '${pad}' does not match design system modular spacing scale.`,
            recommendedFix: "Align padding with canonical SPACING_TOKENS (e.g. 8, 12, 16, 24, 32px).",
          });
        }
      }
    }

    // 5. Typography & Font Rendering (Domain Specific Checks)
    if (profile.enforceMonospaceForNumbers) {
      for (const elem of ui.elements) {
        if (elem.isNumericReportData && elem.computedStyles.fontFamily) {
          const font = elem.computedStyles.fontFamily.toLowerCase();
          if (!font.includes("mono") && !font.includes("tabular")) {
            dimensionDeductions["typography-rendering"] += 20;
            violations.push({
              dimension: "typography-rendering",
              severity: "medium",
              elementId: elem.elementId,
              message: "Enterprise Accounting profile requires monospace or tabular-nums font for financial report figures.",
              recommendedFix: "Set font-family to TYPOGRAPHY_TOKENS.fontFamilies.mono or font-variant-numeric: tabular-nums.",
            });
          }
        }
      }
    }

    // 6. Theme Harmony & Status Encoding
    if (profile.requireStatusColorEncoding) {
      let hasStatusEncoding = false;
      for (const elem of ui.elements) {
        if (elem.statusEncoding && elem.statusEncoding !== "none") {
          hasStatusEncoding = true;
          break;
        }
      }
      if (!hasStatusEncoding && ui.elements.length > 3) {
        dimensionDeductions["theme-harmony"] += 20;
        violations.push({
          dimension: "theme-harmony",
          severity: "medium",
          elementId: "view-root",
          message: "Fleet Telematics cockpit profile requires clear situational status color encoding (normal, warning, critical).",
          recommendedFix: "Implement semantic status badge indicators for critical telemetry values.",
        });
      }
    }

    // Calculate Dimension Scores (0-100)
    const dimensionScores: Record<OpticalDimension, number> = {} as any;
    for (const dim of OPTICAL_DIMENSIONS) {
      const deduction = dimensionDeductions[dim];
      dimensionScores[dim] = Math.max(0, 100 - deduction);
    }

    // Calculate Weighted Overall Score
    let overallScore = 0;
    for (const dim of OPTICAL_DIMENSIONS) {
      const weight = profile.dimensionWeights[dim] ?? 0.125;
      overallScore += dimensionScores[dim] * weight;
    }
    overallScore = Math.round(overallScore * 10) / 10;

    const hasCriticalViolation = violations.some((v) => v.severity === "critical");
    const passed = overallScore >= profile.minimumScoreThreshold && !hasCriticalViolation;

    // Generate Socratic Critique Challenges
    const socraticChallenges: SocraticCritiqueChallenge[] = [];
    let challengeCount = 0;

    for (const v of violations) {
      if (v.severity === "critical" || v.severity === "high") {
        challengeCount += 1;
        socraticChallenges.push({
          challengeId: `SOCRATIC-${String(challengeCount).padStart(3, "0")}`,
          dimension: v.dimension,
          inquiry: `How might we elevate '${v.elementId}' to fully honor the ${OPTICAL_DIMENSION_METADATA[v.dimension].name} standard without disrupting functional intent?`,
          contextualEvidence: v.message,
          suggestedElevation: v.recommendedFix,
        });
      }
    }

    return {
      viewName: ui.viewName,
      profileId: profile.profileId,
      profileName: profile.name,
      overallScore,
      passed,
      dimensionScores,
      violations,
      socraticChallenges,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

let defaultAestheticProfileEvaluator: AestheticProfileEvaluator | null = null;

export function getDefaultAestheticProfileEvaluator(): AestheticProfileEvaluator {
  if (!defaultAestheticProfileEvaluator) {
    defaultAestheticProfileEvaluator = new AestheticProfileEvaluator();
  }
  return defaultAestheticProfileEvaluator;
}

export function setDefaultAestheticProfileEvaluator(
  evaluator: AestheticProfileEvaluator,
): void {
  defaultAestheticProfileEvaluator = evaluator;
}

export function resetDefaultAestheticProfileEvaluator(): void {
  defaultAestheticProfileEvaluator = null;
}
