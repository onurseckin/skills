import type { UiViewportSpec, UiViewportTier } from "./types.ts";

export const MIN_TOUCH_HITBOX_PT = 44;
export const MIN_SCREENSHOT_BYTES = 1024;
export const DESCENDER_CHARS: readonly string[] = ["g", "j", "p", "q", "y", "Q", "J"];

export const CANONICAL_4_VIEWPORTS: Readonly<Record<UiViewportTier, UiViewportSpec>> = {
  mobile: {
    name: "mobile",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    description: "Mobile viewport tier (390px width)",
  },
  tablet: {
    name: "tablet",
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    description: "Tablet viewport tier (768px width)",
  },
  desktop: {
    name: "desktop",
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    description: "Desktop viewport tier (1440px width)",
  },
  "desktop-wide": {
    name: "desktop-wide",
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    description: "Desktop-Wide viewport tier (1920px width)",
  },
};

export const ALL_4_VIEWPORT_TIERS: readonly UiViewportTier[] = [
  "mobile",
  "tablet",
  "desktop",
  "desktop-wide",
];

export const ROBOTIC_SUPERFICIAL_CRITIQUE_PATTERNS: readonly RegExp[] = [
  /^(lgtm|looks good|all tests pass|verified manually|done and verified)$/i,
  /^ui checklist (verified|passed|completed)$/i,
  /^everything looks fine and passes all checks$/i,
  /^rubber stamp approval$/i,
  /^automated tests pass so ui is good$/i,
];

export const SHELL_COMMAND_KEYWORDS: readonly string[] = [
  "exec",
  "shell",
  "bash",
  "sh",
  "zsh",
  "run:exec",
  "run_command",
  "bun test",
  "npm test",
  "pytest",
];
