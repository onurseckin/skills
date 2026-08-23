import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

const COWAN_CHUNK_LIMIT = 5;

export function validateCowanChunking(
  element: ElementPhysicsSnapshot,
  index: number,
): ValidationDefect | null {
  const children = element.children;
  if (!children || children.length === 0) {
    return null;
  }

  const tag = element.tagName.toUpperCase();
  const isContainer =
    tag === "NAV" ||
    tag === "SECTION" ||
    tag === "UL" ||
    tag === "OL" ||
    tag === "MENU" ||
    element.role === "navigation" ||
    element.role === "menu" ||
    element.role === "list";

  if (isContainer && children.length > COWAN_CHUNK_LIMIT) {
    return {
      id: `cog-cowan-${index}`,
      pillar: "cognitive",
      category: "cowan-chunking",
      elementSelector: element.selector,
      message: `Container has ${children.length} unpartitioned elements, violating Cowan's 4±1 working memory chunking limit (max ${COWAN_CHUNK_LIMIT}).`,
      severity: "moderate",
      remediations: generateRemediations("cowan-chunking"),
      metadata: {
        itemCount: children.length,
        maxRecommended: COWAN_CHUNK_LIMIT,
      },
    };
  }

  return null;
}
