import { HarnessError } from "../../../core/errors/index.ts";
import {
  STANDARD_VIEWPORTS,
  TOUCH_HITBOX_MINIMUMS,
  type ViewportSpecification,
  type ViewportPresetName,
} from "./types.ts";
import type {
  TouchHitbox,
  TouchHitboxResult,
  MobileMenuTransitionMetrics,
  MobileMenuTransitionResult,
  BreakpointLayoutMetrics,
  BreakpointReflowResult,
} from "./overlay-types.ts";
export class ResponsiveReflowProber {
  /**
   * Validates touch hitbox dimensions against accessibility minimums
   */
  public validateTouchHitboxes(
    hitboxes: readonly TouchHitbox[],
  ): readonly TouchHitboxResult[] {
    if (!hitboxes) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Hitboxes array must not be undefined or null",
      );
    }

    return hitboxes.map((box) => {
      const minDims = box.isCockpitControl
        ? TOUCH_HITBOX_MINIMUMS.COCKPIT
        : TOUCH_HITBOX_MINIMUMS.STANDARD;

      const compliant = box.width >= minDims.width && box.height >= minDims.height;
      const violationMessage = compliant
        ? undefined
        : `Hitbox '${box.elementId}' (${box.width}x${box.height}pt) is below required minimum (${minDims.width}x${minDims.height}pt${box.isCockpitControl ? " for cockpit controls" : ""})`;

      return {
        elementId: box.elementId,
        width: box.width,
        height: box.height,
        requiredWidth: minDims.width,
        requiredHeight: minDims.height,
        compliant,
        ...(violationMessage !== undefined ? { violationMessage } : {}),
      };
    });
  }

  /**
   * Probes a single viewport breakpoint for horizontal scroll, clipped elements, and hitboxes
   */
  public probeBreakpoint(
    viewport: ViewportSpecification,
    metrics: BreakpointLayoutMetrics,
  ): BreakpointReflowResult {
    if (!viewport || !metrics) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Viewport specification and metrics must be provided",
      );
    }

    const violations: string[] = [];
    const horizontalScrollDetected = metrics.scrollWidth > metrics.clientWidth;

    if (horizontalScrollDetected) {
      violations.push(
        `Breakpoint '${viewport.name}' (${viewport.width}px) has horizontal scroll overflow: scrollWidth=${metrics.scrollWidth} > clientWidth=${metrics.clientWidth}`,
      );
    }

    const clippedElements = metrics.clippedElements ?? [];
    if (clippedElements.length > 0) {
      violations.push(
        `Breakpoint '${viewport.name}' has clipped/truncated elements: ${clippedElements.join(", ")}`,
      );
    }

    let touchHitboxResults: TouchHitboxResult[] = [];
    if (metrics.hitboxes && metrics.hitboxes.length > 0) {
      touchHitboxResults = [...this.validateTouchHitboxes(metrics.hitboxes)];
      for (const res of touchHitboxResults) {
        if (!res.compliant && res.violationMessage) {
          violations.push(`Breakpoint '${viewport.name}': ${res.violationMessage}`);
        }
      }
    }

    let mobileMenuResult: MobileMenuTransitionResult | undefined;
    if (viewport.isMobile && metrics.mobileMenu) {
      const menuV: string[] = [];
      if (!metrics.mobileMenu.opensOnTap) {
        menuV.push("Mobile menu trigger failed to open menu on tap");
      }
      if (!metrics.mobileMenu.animatesSmoothly) {
        menuV.push("Mobile menu animation transition is missing or janky");
      }
      if (!metrics.mobileMenu.closesOnSelectionOrBackdrop) {
        menuV.push("Mobile menu failed to close on item selection or backdrop tap");
      }

      mobileMenuResult = {
        triggerSelector: metrics.mobileMenu.triggerSelector,
        menuSelector: metrics.mobileMenu.menuSelector,
        passed: menuV.length === 0,
        violations: menuV,
      };

      for (const v of menuV) {
        violations.push(`Breakpoint '${viewport.name}': ${v}`);
      }
    }

    return {
      viewport,
      horizontalScrollDetected,
      scrollWidth: metrics.scrollWidth,
      clientWidth: metrics.clientWidth,
      clippedElements,
      touchHitboxResults,
      ...(mobileMenuResult !== undefined ? { mobileMenuResult } : {}),
      reflowPassed: violations.length === 0,
      violations,
    };
  }

  /**
   * Probes all standard viewports across layout metrics
   */
  public probeAllStandardBreakpoints(
    metricsByPreset: Record<ViewportPresetName, BreakpointLayoutMetrics>,
  ): Record<ViewportPresetName, BreakpointReflowResult> {
    if (!metricsByPreset) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "metricsByPreset must not be undefined or null",
      );
    }

    return {
      "ultra-wide-desktop": this.probeBreakpoint(
        STANDARD_VIEWPORTS.ULTRA_WIDE_DESKTOP,
        metricsByPreset["ultra-wide-desktop"] ?? {
          scrollWidth: 1920,
          clientWidth: 1920,
        },
      ),
      "standard-desktop": this.probeBreakpoint(
        STANDARD_VIEWPORTS.STANDARD_DESKTOP,
        metricsByPreset["standard-desktop"] ?? {
          scrollWidth: 1440,
          clientWidth: 1440,
        },
      ),
      "tablet-portrait": this.probeBreakpoint(
        STANDARD_VIEWPORTS.TABLET_PORTRAIT,
        metricsByPreset["tablet-portrait"] ?? {
          scrollWidth: 768,
          clientWidth: 768,
        },
      ),
      "mobile-portrait": this.probeBreakpoint(
        STANDARD_VIEWPORTS.MOBILE_PORTRAIT,
        metricsByPreset["mobile-portrait"] ?? {
          scrollWidth: 390,
          clientWidth: 390,
        },
      ),
    };
  }
}

// ============================================================================
// 5. Browser Choreography Unified Engine & Singletons
// ============================================================================
