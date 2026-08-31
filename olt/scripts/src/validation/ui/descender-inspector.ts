import { DESCENDER_CHARS } from "./constants.ts";
import type { DescenderInspection } from "./types.ts";

export function inspectDescenderIntegrity(
  textElements: readonly {
    selector: string;
    text: string;
    fontSize: number;
    lineHeight: number;
    paddingBottom: number;
    overflowClipped?: boolean | undefined;
  }[],
): DescenderInspection {
  const issues: string[] = [];
  const clippedElements: string[] = [];
  let inspectedCount = 0;

  for (const el of textElements) {
    const hasDescender = DESCENDER_CHARS.some((ch) => el.text.includes(ch));
    if (!hasDescender) continue;
    inspectedCount++;

    // Normalize line-height: unitless multiplier (<= 3.0) vs absolute pixel dimension (> 3.0)
    const isUnitless = el.lineHeight <= 3.0;
    const computedLineHeight = isUnitless ? el.lineHeight * el.fontSize : el.lineHeight;
    const lineHeightRatio = isUnitless
      ? el.lineHeight
      : el.fontSize > 0
        ? el.lineHeight / el.fontSize
        : 1.2;

    const isTightLineHeight = lineHeightRatio < 1.15;
    const isZeroPaddingClipped = el.paddingBottom < 2 && el.overflowClipped === true;

    if (isTightLineHeight && isZeroPaddingClipped) {
      clippedElements.push(el.selector);
      issues.push(
        `Descender clipping risk on ${el.selector} (line-height ratio ${lineHeightRatio.toFixed(2)} with overflow clip and paddingBottom ${el.paddingBottom}px truncating letters '${DESCENDER_CHARS.filter((c) => el.text.includes(c)).join(", ")}')`,
      );
    } else if (el.overflowClipped === true && computedLineHeight < el.fontSize) {
      clippedElements.push(el.selector);
      issues.push(
        `Descender truncated on ${el.selector}: lineHeight (${computedLineHeight}px) < fontSize (${el.fontSize}px) with hidden overflow`,
      );
    }
  }

  const passed = clippedElements.length === 0;
  return {
    passed,
    clippedElements,
    elementsInspected: inspectedCount,
    descenderCharactersChecked: DESCENDER_CHARS,
    notes: passed
      ? `Descender integrity verified across ${inspectedCount} text element(s) carrying descenders.`
      : `Descender clipping violations detected on ${clippedElements.length} element(s).`,
    issues,
  };
}
