import type { CapturePreset, CaptureViewport, SidebarLayoutConfig } from "./types.ts";

export const CANONICAL_VIEWPORTS: Readonly<Record<string, CaptureViewport>> = {
  desktop: {
    name: "desktop",
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
  },
  "desktop-wide": {
    name: "desktop-wide",
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
  },
  tablet: {
    name: "tablet",
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
  },
  mobile: {
    name: "mobile",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
};

export const DEFAULT_SIDEBAR_LAYOUT: SidebarLayoutConfig = {
  enabled: true,
  logoPosition: "top-left",
  userProfilePosition: "bottom-left",
  requireZeroNavbar: true,
  minWidth: 200,
  maxWidth: 320,
  collapsible: true,
  selectors: {
    container: "aside, [data-testid='sidebar'], [role='navigation']",
    logo: "[data-testid='sidebar-logo'], header img, .sidebar-logo",
    userProfile: "[data-testid='user-profile'], [data-testid='user-avatar'], .user-profile",
    navLinks: "nav a, [role='menuitem']",
  },
};

export const DEFAULT_PRESETS: Readonly<Record<string, CapturePreset>> = {
  "standard-dashboard": {
    name: "standard-dashboard",
    description:
      "Standard dashboard preset with desktop and tablet viewports and sidebar layout validation",
    viewports: [CANONICAL_VIEWPORTS.desktop!, CANONICAL_VIEWPORTS.tablet!],
    sidebar: DEFAULT_SIDEBAR_LAYOUT,
    authRequired: true,
  },
  "marketing-site": {
    name: "marketing-site",
    description:
      "Public marketing site with desktop and mobile viewports and standard navbar layout",
    viewports: [CANONICAL_VIEWPORTS.desktop!, CANONICAL_VIEWPORTS.mobile!],
    sidebar: {
      enabled: false,
      logoPosition: "none",
      userProfilePosition: "none",
      requireZeroNavbar: false,
    },
    authRequired: false,
  },
  "mobile-app": {
    name: "mobile-app",
    description: "Mobile web application preset with touch and responsive viewport settings",
    viewports: [CANONICAL_VIEWPORTS.mobile!],
    sidebar: {
      enabled: false,
      logoPosition: "none",
      userProfilePosition: "none",
      requireZeroNavbar: false,
    },
    authRequired: false,
  },
  "full-matrix": {
    name: "full-matrix",
    description: "Complete testing matrix across desktop, wide screen, tablet, and mobile devices",
    viewports: [
      CANONICAL_VIEWPORTS.desktop!,
      CANONICAL_VIEWPORTS["desktop-wide"]!,
      CANONICAL_VIEWPORTS.tablet!,
      CANONICAL_VIEWPORTS.mobile!,
    ],
    sidebar: DEFAULT_SIDEBAR_LAYOUT,
    authRequired: true,
  },
};
