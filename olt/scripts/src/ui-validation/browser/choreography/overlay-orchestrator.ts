import { HarnessError } from "../../../core/errors/index.ts";
import {
  Z_INDEX_HIERARCHY,
  Z_INDEX_LAYER_RANGES,
  type ZIndexLayer,
  type ZIndexRange,
  type OverlayType,
  type OverlayDescriptor,
  type ZIndexHierarchyViolation,
  type ElementBounds,
  type ElementLayoutNode,
  type BackdropOcclusionResult,
  type OverlayDismissalErgonomicsResult,
} from "./overlay-types.ts";
export class OverlayOrchestrator {
  /**
   * Validates z-index values against the canonical z-index elevation hierarchy
   */
  public validateZIndexHierarchy(
    overlays: readonly OverlayDescriptor[],
  ): readonly ZIndexHierarchyViolation[] {
    if (!overlays) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Overlays list must not be undefined or null",
      );
    }

    const violations: ZIndexHierarchyViolation[] = [];

    const overlayLayerMap: Record<OverlayType, ZIndexLayer> = {
      menu: "DROPDOWN",
      popover: "DROPDOWN",
      drawer: "DRAWER",
      modal: "MODAL",
      tooltip: "TOOLTIP",
      toast: "TOAST",
    };

    for (const overlay of overlays) {
      const expectedLayer = overlayLayerMap[overlay.type ?? "modal"] ?? "MODAL";
      const range = Z_INDEX_LAYER_RANGES[expectedLayer];

      if (overlay.zIndex < range.min || overlay.zIndex > range.max) {
        violations.push({
          elementId: overlay.id,
          overlayType: overlay.type,
          actualZIndex: overlay.zIndex,
          expectedLayer,
          expectedRange: range,
          message: `Overlay '${overlay.id}' of type '${overlay.type}' has z-index ${overlay.zIndex}, which is outside expected range [${range.min}, ${range.max}] for layer ${expectedLayer}`,
        });
      }

      // Check backdrop z-index if present
      if (overlay.hasBackdrop && overlay.backdropZIndex !== undefined) {
        const backdropRange = Z_INDEX_LAYER_RANGES.BACKDROP;
        if (
          overlay.backdropZIndex < backdropRange.min ||
          overlay.backdropZIndex > backdropRange.max
        ) {
          violations.push({
            elementId: `${overlay.id}-backdrop`,
            overlayType: overlay.type,
            actualZIndex: overlay.backdropZIndex,
            expectedLayer: "BACKDROP",
            expectedRange: backdropRange,
            message: `Backdrop for overlay '${overlay.id}' has z-index ${overlay.backdropZIndex}, outside range [${backdropRange.min}, ${backdropRange.max}]`,
          });
        }
        if (overlay.backdropZIndex >= overlay.zIndex) {
          violations.push({
            elementId: `${overlay.id}-backdrop`,
            overlayType: overlay.type,
            actualZIndex: overlay.backdropZIndex,
            expectedLayer: "BACKDROP",
            expectedRange: backdropRange,
            message: `Backdrop z-index (${overlay.backdropZIndex}) must be strictly less than overlay z-index (${overlay.zIndex})`,
          });
        }
      }
    }

    return violations;
  }

  /**
   * Checks whether the backdrop occludes background content properly
   */
  public checkBackdropOcclusion(
    overlay: OverlayDescriptor,
    backgroundElements: readonly ElementLayoutNode[],
  ): BackdropOcclusionResult {
    if (!overlay) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Overlay must not be undefined or null",
      );
    }

    if (!overlay.hasBackdrop) {
      return {
        occludedCorrectly: true,
        occludingElements: [],
        violations: [],
      };
    }

    const backdropZ = overlay.backdropZIndex ?? (overlay.zIndex - 1);
    const violations: string[] = [];
    const occludingElements: string[] = [];

    for (const bg of backgroundElements) {
      if (bg.id === overlay.id) continue;

      // Background elements that should be behind backdrop but have zIndex >= backdropZ
      if (bg.zIndex >= backdropZ) {
        occludingElements.push(bg.id);
        violations.push(
          `Background element '${bg.id}' with z-index ${bg.zIndex} penetrates or sits above backdrop (z-index ${backdropZ})`,
        );
      }
    }

    return {
      occludedCorrectly: violations.length === 0,
      occludingElements,
      violations,
    };
  }

  /**
   * Verifies dismissal ergonomics: escape key, backdrop click, and focus trap
   */
  public verifyOverlayErgonomics(
    overlay: OverlayDescriptor,
    mockInteraction?: {
      escapeDismisses?: boolean;
      backdropClickDismisses?: boolean;
      focusTrapped?: boolean;
    },
  ): OverlayDismissalErgonomicsResult {
    if (!overlay) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Overlay must not be undefined or null",
      );
    }

    const violations: string[] = [];
    const escapeDismissalValid = mockInteraction?.escapeDismisses ?? overlay.dismissOnEscape;
    const backdropDismissalValid =
      !overlay.hasBackdrop || (mockInteraction?.backdropClickDismisses ?? overlay.dismissOnBackdropClick);
    const focusTrapValid =
      overlay.type === "tooltip" || overlay.type === "toast" || (mockInteraction?.focusTrapped ?? overlay.focusTrapActive ?? true);

    if (overlay.dismissOnEscape && !escapeDismissalValid) {
      violations.push(`Overlay '${overlay.id}' failed to dismiss on Escape key press`);
    }

    if (overlay.hasBackdrop && overlay.dismissOnBackdropClick && !backdropDismissalValid) {
      violations.push(`Overlay '${overlay.id}' failed to dismiss on backdrop click`);
    }

    if ((overlay.type === "modal" || overlay.type === "drawer") && !focusTrapValid) {
      violations.push(`Overlay '${overlay.id}' does not have an active focus trap`);
    }

    return {
      overlayId: overlay.id,
      escapeDismissalValid,
      backdropDismissalValid,
      focusTrapValid,
      passed: violations.length === 0,
      violations,
    };
  }
}

// ============================================================================
// 4. Responsive Reflow & Breakpoint Probing
// ============================================================================
