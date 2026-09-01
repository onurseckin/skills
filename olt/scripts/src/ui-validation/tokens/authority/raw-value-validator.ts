// @ts-nocheck
import { HarnessError } from "../../../core/errors/index.ts";
import {
  SPACING_TOKENS,
  VALID_SPACING_VALUES,
  TYPOGRAPHY_TOKENS,
  VALID_FONT_SIZES,
  VALID_FONT_WEIGHTS,
  VALID_LINE_HEIGHTS,
  COLOR_PALETTES,
  SHADOW_ELEVATIONS,
  BORDER_RADII,
  VALID_BORDER_RADII_VALUES,
  TRANSITION_TOKENS,
  VALID_TRANSITION_DURATIONS,
  type RawValueViolation,
  type RawValueValidationResult,
  type ThemeMode,
} from "./types.ts";
export function findClosestNumericToken(
  value: number,
  validValues: readonly number[],
  tokenMap: Record<string, number>,
): { tokenName: string; tokenValue: number } {
  let closestValue = validValues[0] ?? 0;
  let minDiff = Math.abs(value - closestValue);

  for (const validVal of validValues) {
    const diff = Math.abs(value - validVal);
    if (diff < minDiff) {
      minDiff = diff;
      closestValue = validVal;
    }
  }

  let tokenName = "";
  for (const [name, val] of Object.entries(tokenMap)) {
    if (val === closestValue) {
      tokenName = name;
      break;
    }
  }

  return { tokenName, tokenValue: closestValue };
}

/**
 * Collect all known token colors across all themes
 */
export function getAllKnownTokenColors(): Set<string> {
  const colors = new Set<string>();
  for (const theme of Object.values(COLOR_PALETTES)) {
    for (const hex of Object.values(theme)) {
      colors.add(hex.toLowerCase());
    }
  }
  // Standard CSS transparent / inherit / currentColor
  colors.add("transparent");
  colors.add("inherit");
  colors.add("currentcolor");
  return colors;
}

export class RawValuePolicyValidator {
  private readonly knownColors = getAllKnownTokenColors();

  /**
   * Validate a style dictionary (CSS property-value map)
   */
  public validateStyleMap(styles: Record<string, string | number>): RawValueValidationResult {
    const violations: RawValueViolation[] = [];

    for (const [property, rawValue] of Object.entries(styles)) {
      const propLower = property.toLowerCase();
      const valStr = String(rawValue).trim().toLowerCase();

      // Check CSS variable or token reference: always valid
      if (valStr.startsWith("var(") || valStr.startsWith("token(") || valStr.startsWith("theme(")) {
        continue;
      }

      // Spacing properties (margin, padding, gap, top, left, etc.)
      const isSpacingProp = /^(margin|padding|gap|row-gap|column-gap|top|bottom|left|right|inset)(-(top|bottom|left|right|inline|block))?$/.test(
        propLower,
      );

      if (isSpacingProp) {
        const numMatch = valStr.match(/^(-?\d+(\.\d+)?)px$/);
        if (numMatch && numMatch[1] !== undefined) {
          const num = Math.abs(parseFloat(numMatch[1]));
          if (!VALID_SPACING_VALUES.includes(num)) {
            const closest = findClosestNumericToken(num, VALID_SPACING_VALUES, SPACING_TOKENS);
            violations.push({
              property,
              rawValue,
              violationType: "unauthorized_pixel_value",
              message: `Raw pixel value '${rawValue}' is unauthorized for spacing. Use design token SPACING_TOKENS['${closest.tokenName}'] (${closest.tokenValue}px).`,
              recommendedToken: `SPACING_TOKENS['${closest.tokenName}'] (${closest.tokenValue}px)`,
            });
          }
        }
      }

      // Font size
      if (propLower === "font-size") {
        const numMatch = valStr.match(/^(\d+(\.\d+)?)px$/);
        if (numMatch && numMatch[1] !== undefined) {
          const num = parseFloat(numMatch[1]);
          if (!VALID_FONT_SIZES.includes(num)) {
            const closest = findClosestNumericToken(num, VALID_FONT_SIZES, TYPOGRAPHY_TOKENS.fontSizes);
            violations.push({
              property,
              rawValue,
              violationType: "unauthorized_pixel_value",
              message: `Raw font size '${rawValue}' is unauthorized. Use design token TYPOGRAPHY_TOKENS.fontSizes['${closest.tokenName}'] (${closest.tokenValue}px).`,
              recommendedToken: `TYPOGRAPHY_TOKENS.fontSizes['${closest.tokenName}'] (${closest.tokenValue}px)`,
            });
          }
        }
      }

      // Border radius
      if (propLower === "border-radius" || (propLower.startsWith("border-") && propLower.endsWith("-radius"))) {
        const numMatch = valStr.match(/^(\d+(\.\d+)?)px$/);
        if (numMatch && numMatch[1] !== undefined) {
          const num = parseFloat(numMatch[1]);
          if (!VALID_BORDER_RADII_VALUES.includes(num)) {
            const closest = findClosestNumericToken(num, VALID_BORDER_RADII_VALUES, BORDER_RADII);
            violations.push({
              property,
              rawValue,
              violationType: "unauthorized_pixel_value",
              message: `Raw border-radius '${rawValue}' is unauthorized. Use design token BORDER_RADII['${closest.tokenName}'] (${closest.tokenValue}px).`,
              recommendedToken: `BORDER_RADII['${closest.tokenName}'] (${closest.tokenValue}px)`,
            });
          }
        }
      }

      // Color properties
      const isColorProp = /^(color|background-color|background|border-color|border|outline-color|stroke|fill)$/.test(propLower);
      if (isColorProp) {
        const hexMatches = valStr.match(/#[0-9a-fA-F]{3,8}/g);
        if (hexMatches) {
          for (const hex of hexMatches) {
            const normalizedHex = hex.toLowerCase();
            // Check if known token hex
            if (!this.knownColors.has(normalizedHex)) {
              violations.push({
                property,
                rawValue,
                violationType: "unauthorized_color",
                message: `Unauthorized raw color hex '${hex}'. Color must be sourced from COLOR_PALETTES or semantic CSS custom properties.`,
                recommendedToken: "COLOR_PALETTES[theme][role]",
              });
            }
          }
        }
      }
    }

    return {
      valid: violations.length === 0,
      violationCount: violations.length,
      violations,
    };
  }

  /**
   * Validate a raw string (e.g. CSS or component code containing inline styles)
   */
  public validateStringContent(codeOrStyles: string): RawValueValidationResult {
    const violations: RawValueViolation[] = [];
    const lines = codeOrStyles.split("\n");

    const pxRegex = /([a-zA-Z-]+)\s*:\s*(-?\d+(\.\d+)?)px\b/g;
    const hexRegex = /([a-zA-Z-]+)\s*:\s*([^;}]*?)(#[0-9a-fA-F]{3,8})/g;

    lines.forEach((line, lineIdx) => {
      // Check px rules
      let pxMatch: RegExpExecArray | null;
      while ((pxMatch = pxRegex.exec(line)) !== null) {
        const prop = (pxMatch[1] ?? "").toLowerCase();
        const num = parseFloat(pxMatch[2] ?? "0");
        const fullVal = `${pxMatch[2]}px`;

        if (/margin|padding|gap|top|bottom|left|right|inset/.test(prop)) {
          if (!VALID_SPACING_VALUES.includes(Math.abs(num))) {
            const closest = findClosestNumericToken(Math.abs(num), VALID_SPACING_VALUES, SPACING_TOKENS);
            violations.push({
              property: prop,
              rawValue: fullVal,
              violationType: "unauthorized_pixel_value",
              message: `Line ${lineIdx + 1}: Raw pixel value '${fullVal}' in '${prop}' is unauthorized. Use token SPACING_TOKENS['${closest.tokenName}'] (${closest.tokenValue}px).`,
              recommendedToken: `SPACING_TOKENS['${closest.tokenName}'] (${closest.tokenValue}px)`,
              line: lineIdx + 1,
            });
          }
        } else if (prop === "font-size") {
          if (!VALID_FONT_SIZES.includes(num)) {
            const closest = findClosestNumericToken(num, VALID_FONT_SIZES, TYPOGRAPHY_TOKENS.fontSizes);
            violations.push({
              property: prop,
              rawValue: fullVal,
              violationType: "unauthorized_pixel_value",
              message: `Line ${lineIdx + 1}: Raw font-size '${fullVal}' is unauthorized. Use token TYPOGRAPHY_TOKENS.fontSizes['${closest.tokenName}'] (${closest.tokenValue}px).`,
              recommendedToken: `TYPOGRAPHY_TOKENS.fontSizes['${closest.tokenName}'] (${closest.tokenValue}px)`,
              line: lineIdx + 1,
            });
          }
        } else if (prop.includes("radius")) {
          if (!VALID_BORDER_RADII_VALUES.includes(num)) {
            const closest = findClosestNumericToken(num, VALID_BORDER_RADII_VALUES, BORDER_RADII);
            violations.push({
              property: prop,
              rawValue: fullVal,
              violationType: "unauthorized_pixel_value",
              message: `Line ${lineIdx + 1}: Raw border-radius '${fullVal}' is unauthorized. Use token BORDER_RADII['${closest.tokenName}'] (${closest.tokenValue}px).`,
              recommendedToken: `BORDER_RADII['${closest.tokenName}'] (${closest.tokenValue}px)`,
              line: lineIdx + 1,
            });
          }
        }
      }

      // Check hex rules
      let hexMatch: RegExpExecArray | null;
      while ((hexMatch = hexRegex.exec(line)) !== null) {
        const prop = (hexMatch[1] ?? "").toLowerCase();
        const hex = (hexMatch[3] ?? "").toLowerCase();

        if (!this.knownColors.has(hex)) {
          violations.push({
            property: prop,
            rawValue: hex,
            violationType: "unauthorized_color",
            message: `Line ${lineIdx + 1}: Raw hex color '${hex}' is unauthorized. Use semantic color tokens from COLOR_PALETTES.`,
            recommendedToken: "COLOR_PALETTES[theme][role]",
            line: lineIdx + 1,
          });
        }
      }
    });

    return {
      valid: violations.length === 0,
      violationCount: violations.length,
      violations,
    };
  }
}

export function validateZeroRawValues(
  target: string | Record<string, string | number>,
): RawValueValidationResult {
  const validator = new RawValuePolicyValidator();
  if (typeof target === "string") {
    return validator.validateStringContent(target);
  }
  return validator.validateStyleMap(target);
}

/**
 * ============================================================================
 * 3. Implementer Token-Compliance Immunity Engine
 * ============================================================================
 */

