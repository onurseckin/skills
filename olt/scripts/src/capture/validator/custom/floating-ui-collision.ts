import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

const FLOATING_BOUNDARY_PADDING = 8;

export function validateFloatingUiCollision(
  element: ElementPhysicsSnapshot,
  index: number,
  viewportBounds?: { readonly width: number; readonly height: number },
): ValidationDefect | null {
  const isFloating =
    element.isFloating ||
    element.role === "tooltip" ||
    element.selector.includes("popover") ||
    element.selector.includes("tooltip") ||
    element.selector.includes("dropdown-menu");

  if (!isFloating) return null;

  const vpW = viewportBounds?.width ?? 1280;
  const vpH = viewportBounds?.height ?? 800;

  const bounds = element.bounds;
  const overflows: string[] = [];

  if (bounds.x < FLOATING_BOUNDARY_PADDING) {
    overflows.push(`left edge (${Math.round(bounds.x)}px < ${FLOATING_BOUNDARY_PADDING}px)`);
  }
  if (bounds.y < FLOATING_BOUNDARY_PADDING) {
    overflows.push(`top edge (${Math.round(bounds.y)}px < ${FLOATING_BOUNDARY_PADDING}px)`);
  }
  if (bounds.x + bounds.width > vpW - FLOATING_BOUNDARY_PADDING) {
    overflows.push(
      `right edge (${Math.round(bounds.x + bounds.width)}px > ${vpW - FLOATING_BOUNDARY_PADDING}px)`,
    );
  }
  if (bounds.y + bounds.height > vpH - FLOATING_BOUNDARY_PADDING) {
    overflows.push(
      `bottom edge (${Math.round(bounds.y + bounds.height)}px > ${vpH - FLOATING_BOUNDARY_PADDING}px)`,
    );
  }

  // Also check clipping container bounds if defined
  if (element.clippingBounds) {
    const clip = element.clippingBounds;
    if (
      bounds.x < clip.x ||
      bounds.y < clip.y ||
      bounds.x + bounds.width > clip.x + clip.width ||
      bounds.y + bounds.height > clip.y + clip.height
    ) {
      overflows.push("clipping boundary overflow");
    }
  }

  if (overflows.length > 0) {
    return {
      id: `cust-floating-collision-${index}`,
      pillar: "custom",
      category: "floating-ui-collision",
      elementSelector: element.selector,
      message: `Floating element overflows viewport boundary (${overflows.join(", ")}). Missing Floating UI flip/shift middleware with boundaryPadding >= ${FLOATING_BOUNDARY_PADDING}px.`,
      severity: "serious",
      remediations: generateRemediations("floating-ui-collision"),
      metadata: {
        overflows: overflows.join(", "),
        minBoundaryPadding: FLOATING_BOUNDARY_PADDING,
      },
    };
  }

  return null;
}
