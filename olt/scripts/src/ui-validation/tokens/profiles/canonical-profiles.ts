import type { IndustryProfileId, AestheticProfile } from "./types.ts";
export const ENTERPRISE_ACCOUNTING_PROFILE: AestheticProfile = {
  profileId: "enterprise_accounting",
  name: "Enterprise Tax & Accounting",
  description:
    "Prioritizes high information density, strict tabular alignment, decimal alignment, positive/negative balance indicators, crisp borders, and zero ambiguity in numerical reports.",
  dimensionWeights: {
    "visual-hierarchy": 0.15,
    "spatial-rhythm": 0.15,
    "typography-rendering": 0.15,
    "clipping-overflow": 0.15,
    "perceptual-contrast": 0.15,
    "theme-harmony": 0.1,
    "structural-z-index": 0.05,
    "touch-ergonomics": 0.1,
  },
  minimumScoreThreshold: 85,
  minTouchTargetPx: 44,
  preferredThemes: ["light", "dark", "high-contrast"],
  enforceMonospaceForNumbers: true,
};

export const LUXURY_HOSPITALITY_PROFILE: AestheticProfile = {
  profileId: "luxury_hospitality",
  name: "Luxury Travel & Hospitality",
  description:
    "Emphasizes expansive imagery, elegant typography, generous whitespace, subtle parallax transitions, soft shadow elevations, and emotionally inviting empty states.",
  dimensionWeights: {
    "visual-hierarchy": 0.2,
    "spatial-rhythm": 0.2,
    "typography-rendering": 0.15,
    "clipping-overflow": 0.1,
    "perceptual-contrast": 0.1,
    "theme-harmony": 0.15,
    "structural-z-index": 0.05,
    "touch-ergonomics": 0.05,
  },
  minimumScoreThreshold: 85,
  minTouchTargetPx: 44,
  preferredThemes: ["light", "dark"],
  requireGenerousWhitespace: true,
};

export const FLEET_TELEMATICS_PROFILE: AestheticProfile = {
  profileId: "fleet_telematics",
  name: "Fleet Telematics & Operations Cockpits",
  description:
    "Prioritizes instant situational awareness, dark-mode primary themes, status-color encoding (normal, warning, critical), high-contrast readouts, and 48px+ touch targets for high-vibration environments.",
  dimensionWeights: {
    "visual-hierarchy": 0.15,
    "spatial-rhythm": 0.1,
    "typography-rendering": 0.1,
    "clipping-overflow": 0.1,
    "perceptual-contrast": 0.2,
    "theme-harmony": 0.1,
    "structural-z-index": 0.05,
    "touch-ergonomics": 0.2,
  },
  minimumScoreThreshold: 85,
  minTouchTargetPx: 48,
  preferredThemes: ["dark", "high-contrast"],
  requireStatusColorEncoding: true,
};

export const STANDARD_AESTHETIC_PROFILES: Record<IndustryProfileId, AestheticProfile> = {
  enterprise_accounting: ENTERPRISE_ACCOUNTING_PROFILE,
  luxury_hospitality: LUXURY_HOSPITALITY_PROFILE,
  fleet_telematics: FLEET_TELEMATICS_PROFILE,
};

/**
 * ============================================================================
 * 3. UI Descriptors for Evaluation
 * ============================================================================
 */
