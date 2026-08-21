import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

const MEDIA_TAGS = new Set(["IMG", "VIDEO", "IFRAME", "CANVAS", "OBJECT", "EMBED"]);

export function validateClsReservation(
  element: ElementPhysicsSnapshot,
  index: number
): ValidationDefect | null {
  const isMedia = MEDIA_TAGS.has(element.tagName.toUpperCase()) || element.role === "img" || element.role === "video";
  if (!isMedia) return null;

  const hasAspect = Boolean(element.computedStyles?.aspectRatio && element.computedStyles.aspectRatio !== "auto");
  const hasMetaReserved = Boolean(element.imageVideoMeta?.hasDimensionsReserved);
  const hasHtmlDims = Boolean(
    element.attributes &&
    element.attributes["width"] &&
    element.attributes["height"] &&
    element.attributes["width"] !== "" &&
    element.attributes["height"] !== ""
  );

  if (!hasAspect && !hasMetaReserved && !hasHtmlDims) {
    return {
      id: `mech-cls-reservation-${index}`,
      pillar: "mechanical",
      category: "cls-reservation",
      elementSelector: element.selector,
      message: `Media element <${element.tagName.toLowerCase()}> lacks pre-hydration dimension reservation (missing width/height attributes or aspect-ratio CSS), risking Cumulative Layout Shift (CLS).`,
      severity: "serious",
      remediations: generateRemediations("cls-reservation"),
      metadata: {
        tagName: element.tagName,
        hasAspect,
        hasHtmlDims,
      },
    };
  }

  return null;
}
