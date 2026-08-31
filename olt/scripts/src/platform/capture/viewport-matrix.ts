import { HarnessError } from "../../core/errors/index.ts";
import type {
  CaptureViewport,
  ResponsiveViewportSpec,
  ResponsiveViewportTier,
  ViewportGovernanceSyncResult,
} from "./types.ts";

export const MANDATORY_VIEWPORT_TIERS: readonly ResponsiveViewportTier[] = [
  "desktop-wide",
  "desktop",
  "tablet",
  "mobile",
] as const;

export const RESPONSIVE_4TIER_SPECS: Readonly<Record<ResponsiveViewportTier, ResponsiveViewportSpec>> = {
  "desktop-wide": {
    name: "desktop-wide",
    tier: "desktop-wide",
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    aspectRatio: "16:9",
    description: "16:9 widescreen layout, large data tables, multi-column navigation",
    minTouchTargetPx: 24,
    minApcaContrast: 60,
  },
  desktop: {
    name: "desktop",
    tier: "desktop",
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    aspectRatio: "16:10",
    description: "Standard desktop viewport with full desktop navigation and sidebar",
    minTouchTargetPx: 24,
    minApcaContrast: 60,
  },
  tablet: {
    name: "tablet",
    tier: "tablet",
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    aspectRatio: "3:4",
    description: "Tablet portrait viewport with adaptive columns and touch targets",
    minTouchTargetPx: 44,
    minApcaContrast: 60,
  },
  mobile: {
    name: "mobile",
    tier: "mobile",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    aspectRatio: "9:19.5",
    description: "Modern mobile viewport with single-column layout and primary touch ergonomics",
    minTouchTargetPx: 44,
    minApcaContrast: 60,
  },
};

export function getResponsiveViewportMatrix(): readonly ResponsiveViewportSpec[] {
  return MANDATORY_VIEWPORT_TIERS.map((tier) => RESPONSIVE_4TIER_SPECS[tier]);
}

export function getViewportSpecByTier(tier: ResponsiveViewportTier): ResponsiveViewportSpec {
  const spec = RESPONSIVE_4TIER_SPECS[tier];
  if (spec === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", `Unknown viewport tier: ${String(tier)}`);
  }
  return spec;
}

export function matchViewportTier(width: number, height: number): ResponsiveViewportTier | null {
  for (const tier of MANDATORY_VIEWPORT_TIERS) {
    const spec = RESPONSIVE_4TIER_SPECS[tier];
    if (spec.width === width && spec.height === height) {
      return tier;
    }
  }
  return null;
}

export function evaluateViewportCoverage(
  viewports: readonly { width: number; height: number; name?: string }[],
): ViewportGovernanceSyncResult {
  const coveredSet = new Set<ResponsiveViewportTier>();
  const activeSpecs: ResponsiveViewportSpec[] = [];

  for (const vp of viewports) {
    const matchedTier = matchViewportTier(vp.width, vp.height);
    if (matchedTier !== null) {
      coveredSet.add(matchedTier);
      activeSpecs.push(RESPONSIVE_4TIER_SPECS[matchedTier]);
    }
  }

  const coveredTiers = MANDATORY_VIEWPORT_TIERS.filter((tier) => coveredSet.has(tier));
  const missingTiers = MANDATORY_VIEWPORT_TIERS.filter((tier) => !coveredSet.has(tier));

  return {
    valid: missingTiers.length === 0,
    viewports: activeSpecs,
    coveredTiers,
    missingTiers,
  };
}

export function assert4TierViewportCoverage(
  viewports: readonly { width: number; height: number }[],
): void {
  const result = evaluateViewportCoverage(viewports);
  if (!result.valid) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Capture configuration violates 4-tier responsive viewport mandate. Missing tiers: ${result.missingTiers.join(", ")}. Required: 1920x1080 (Desktop-Wide), 1440x900 (Desktop), 768x1024 (Tablet), 390x844 (Mobile).`,
    );
  }
}

export function toCanonicalCaptureViewport(spec: ResponsiveViewportSpec): CaptureViewport {
  return {
    name: spec.name,
    width: spec.width,
    height: spec.height,
    deviceScaleFactor: spec.deviceScaleFactor,
  };
}

export function getCanonical4TierCaptureViewports(): Record<ResponsiveViewportTier, CaptureViewport> {
  return {
    "desktop-wide": toCanonicalCaptureViewport(RESPONSIVE_4TIER_SPECS["desktop-wide"]),
    desktop: toCanonicalCaptureViewport(RESPONSIVE_4TIER_SPECS.desktop),
    tablet: toCanonicalCaptureViewport(RESPONSIVE_4TIER_SPECS.tablet),
    mobile: toCanonicalCaptureViewport(RESPONSIVE_4TIER_SPECS.mobile),
  };
}
