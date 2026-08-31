import type { SidebarLayoutConfig } from "../../config/types.ts";
import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

export function validateSidebarLayout(
  elements: readonly ElementPhysicsSnapshot[],
  sidebarConfig?: SidebarLayoutConfig,
  viewportBounds?: { readonly width: number; readonly height: number },
): readonly ValidationDefect[] {
  if (!sidebarConfig || !sidebarConfig.enabled) {
    return [];
  }

  const defects: ValidationDefect[] = [];
  const vpWidth = viewportBounds?.width ?? 1280;
  const vpHeight = viewportBounds?.height ?? 800;

  // 1. Check requireZeroNavbar
  if (sidebarConfig.requireZeroNavbar) {
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!el) continue;

      const tag = el.tagName.toUpperCase();
      const role = el.role?.toLowerCase();
      const isNavBanner =
        tag === "HEADER" || tag === "NAV" || role === "banner" || role === "navigation";

      if (
        isNavBanner &&
        el.bounds.y <= 10 &&
        el.bounds.width >= vpWidth * 0.7 &&
        el.bounds.height > 20
      ) {
        defects.push({
          id: `mech-sidebar-navbar-found-${i}`,
          pillar: "mechanical",
          category: "sidebar-layout",
          elementSelector: el.selector,
          message: `Sidebar-first layout violation: found horizontal top navbar (${el.selector}) when requireZeroNavbar=true is configured.`,
          severity: "serious",
          remediations: generateRemediations("sidebar-layout"),
          metadata: {
            boundsY: el.bounds.y,
            boundsWidth: el.bounds.width,
            vpWidth,
          },
        });
      }
    }
  }

  // 2. Check sidebar container width if specified
  const containerSelector = sidebarConfig.selectors?.container;
  const sidebarContainer = containerSelector
    ? elements.find(
        (e) => e && (e.selector === containerSelector || e.selector.includes(containerSelector)),
      )
    : elements.find((e) => e && (e.tagName.toUpperCase() === "ASIDE" || e.selector.includes("sidebar")));

  if (sidebarContainer) {
    const width = sidebarContainer.bounds.width;
    if (sidebarConfig.minWidth !== undefined && width < sidebarConfig.minWidth) {
      defects.push({
        id: "mech-sidebar-width-under",
        pillar: "mechanical",
        category: "sidebar-layout",
        elementSelector: sidebarContainer.selector,
        message: `Sidebar container width (${Math.round(width)}px) is below configured minWidth (${sidebarConfig.minWidth}px).`,
        severity: "moderate",
        remediations: generateRemediations("sidebar-layout"),
        metadata: { actualWidth: Math.round(width), minWidth: sidebarConfig.minWidth },
      });
    }
    if (sidebarConfig.maxWidth !== undefined && width > sidebarConfig.maxWidth) {
      defects.push({
        id: "mech-sidebar-width-over",
        pillar: "mechanical",
        category: "sidebar-layout",
        elementSelector: sidebarContainer.selector,
        message: `Sidebar container width (${Math.round(width)}px) exceeds configured maxWidth (${sidebarConfig.maxWidth}px).`,
        severity: "moderate",
        remediations: generateRemediations("sidebar-layout"),
        metadata: { actualWidth: Math.round(width), maxWidth: sidebarConfig.maxWidth },
      });
    }
  }

  // 3. Check Logo position if specified as top-left
  if (sidebarConfig.logoPosition === "top-left") {
    const logoSel = sidebarConfig.selectors?.logo;
    const logoEl = logoSel
      ? elements.find((e) => e && (e.selector === logoSel || e.selector.includes(logoSel)))
      : elements.find(
          (e) => e && (e.selector.includes("logo") || e.attributes?.["data-testid"] === "logo"),
        );

    if (logoEl && (logoEl.bounds.x > 80 || logoEl.bounds.y > 100)) {
      defects.push({
        id: "mech-sidebar-logo-pos",
        pillar: "mechanical",
        category: "sidebar-layout",
        elementSelector: logoEl.selector,
        message: `Logo position (x=${Math.round(logoEl.bounds.x)}, y=${Math.round(logoEl.bounds.y)}) deviates from expected top-left placement in sidebar.`,
        severity: "moderate",
        remediations: generateRemediations("sidebar-layout"),
        metadata: { x: Math.round(logoEl.bounds.x), y: Math.round(logoEl.bounds.y) },
      });
    }
  }

  // 4. Check User Profile position if bottom-left
  if (sidebarConfig.userProfilePosition === "bottom-left") {
    const profileSel = sidebarConfig.selectors?.userProfile;
    const profileEl = profileSel
      ? elements.find((e) => e && (e.selector === profileSel || e.selector.includes(profileSel)))
      : elements.find((e) => e && (e.selector.includes("profile") || e.selector.includes("user-avatar")));

    if (profileEl && (profileEl.bounds.x > 100 || profileEl.bounds.y < vpHeight - 250)) {
      defects.push({
        id: "mech-sidebar-profile-pos",
        pillar: "mechanical",
        category: "sidebar-layout",
        elementSelector: profileEl.selector,
        message: `User profile position (x=${Math.round(profileEl.bounds.x)}, y=${Math.round(profileEl.bounds.y)}) is not docked at bottom-left of sidebar.`,
        severity: "moderate",
        remediations: generateRemediations("sidebar-layout"),
        metadata: {
          x: Math.round(profileEl.bounds.x),
          y: Math.round(profileEl.bounds.y),
          vpHeight,
        },
      });
    }
  }

  return defects;
}
