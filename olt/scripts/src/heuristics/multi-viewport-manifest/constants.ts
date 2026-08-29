/**
 * @file constants.ts
 * Canonical viewports, specifications, mandatory pillars, and boilerplate patterns
 */

import type {
  CanonicalViewport,
  CanonicalViewportSpec,
  MandatoryPillar,
} from "./types.ts";

export const CANONICAL_VIEWPORTS: readonly CanonicalViewport[] = [
  "mobile",
  "tablet",
  "desktop",
  "desktop-wide",
];

export const CANONICAL_VIEWPORT_SPECS: Readonly<Record<CanonicalViewport, CanonicalViewportSpec>> =
  {
    "desktop-wide": {
      name: "desktop-wide",
      width: 1920,
      height: 1080,
      defaultDpr: 1,
      supportedDprs: [1, 2],
      physicalWidth: 1920,
      physicalHeight: 1080,
    },
    desktop: {
      name: "desktop",
      width: 1440,
      height: 900,
      defaultDpr: 1,
      supportedDprs: [1, 2],
      physicalWidth: 1440,
      physicalHeight: 900,
    },
    tablet: {
      name: "tablet",
      width: 768,
      height: 1024,
      defaultDpr: 2,
      supportedDprs: [2],
      physicalWidth: 1536,
      physicalHeight: 2048,
    },
    mobile: {
      name: "mobile",
      width: 390,
      height: 844,
      defaultDpr: 3,
      supportedDprs: [3],
      physicalWidth: 1170,
      physicalHeight: 2532,
    },
  };

export const MANDATORY_PILLARS: readonly MandatoryPillar[] = [
  "mechanical",
  "cognitive",
  "product",
  "ux",
];

export const MINIMUM_SCREENSHOT_BYTES = 1024;

export const SUPERFICIAL_BOILERPLATE_PATTERNS: ReadonlySet<string> = new Set([
  "ok",
  "pass",
  "passed",
  "true",
  "yes",
  "n/a",
  "na",
  "none",
  "looks good",
  "test passed",
  "checked",
  "valid",
  "verified",
  "all good",
  "placeholder",
  "tbd",
  "as expected",
  "no issues",
  "done",
  "fine",
  "null",
  "undefined",
]);
