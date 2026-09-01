// @ts-nocheck
import { HarnessError } from "../../../core/errors/index.ts";
import {
  SPACING_TOKENS,
  TYPOGRAPHY_TOKENS,
  BORDER_RADII,
  VALID_SPACING_VALUES,
  VALID_FONT_SIZES,
  VALID_BORDER_RADII_VALUES,
  COLOR_PALETTES,
} from "./constants.ts";
import type {
  StyleAdjustmentRequest,
  TokenImmunityDefense,
  ThemeMode,
} from "./types.ts";
import {
  RawValuePolicyValidator,
  findClosestNumericToken,
  getAllKnownTokenColors,
} from "./raw-value-validator.ts";
export class TokenComplianceImmunity {
  private defenseCounter = 0;

  /**
   * Check if a style adjustment request is compliant with the design token system
   */
  public validateRequestCompliance(request: StyleAdjustmentRequest): {
    compliant: boolean;
    reasoning: string;
    suggestedTokens?: string[];
  } {
    const propLower = request.requestedProperty.toLowerCase();
    const valStr = String(request.requestedValue).trim().toLowerCase();

    // If it's a named token reference or CSS var, it is compliant
    if (
      valStr.startsWith("var(") ||
      valStr.startsWith("token(") ||
      valStr.startsWith("spacing.") ||
      valStr.startsWith("typography.") ||
      valStr.startsWith("colors.") ||
      valStr in SPACING_TOKENS ||
      valStr in TYPOGRAPHY_TOKENS.fontSizes ||
      valStr in BORDER_RADII
    ) {
      return {
        compliant: true,
        reasoning: `Requested value '${request.requestedValue}' corresponds to a valid design system token.`,
      };
    }

    // Check pixel spacing
    const pxMatch = valStr.match(/^(-?\d+(\.\d+)?)px$/);
    if (pxMatch && pxMatch[1] !== undefined) {
      const num = Math.abs(parseFloat(pxMatch[1]));
      if (
        propLower.includes("margin") ||
        propLower.includes("padding") ||
        propLower.includes("gap") ||
        propLower === "top" ||
        propLower === "left" ||
        propLower === "right" ||
        propLower === "bottom"
      ) {
        if (!VALID_SPACING_VALUES.includes(num)) {
          const closest = findClosestNumericToken(num, VALID_SPACING_VALUES, SPACING_TOKENS);
          return {
            compliant: false,
            reasoning: `Requested spacing value '${request.requestedValue}' violates Sovereign Token Standard. Nearest valid token is '${closest.tokenName}' (${closest.tokenValue}px).`,
            suggestedTokens: [`SPACING_TOKENS['${closest.tokenName}'] (${closest.tokenValue}px)`],
          };
        }
      } else if (propLower === "font-size") {
        if (!VALID_FONT_SIZES.includes(num)) {
          const closest = findClosestNumericToken(num, VALID_FONT_SIZES, TYPOGRAPHY_TOKENS.fontSizes);
          return {
            compliant: false,
            reasoning: `Requested font-size '${request.requestedValue}' violates Sovereign Token Standard. Nearest valid token is '${closest.tokenName}' (${closest.tokenValue}px).`,
            suggestedTokens: [`TYPOGRAPHY_TOKENS.fontSizes['${closest.tokenName}'] (${closest.tokenValue}px)`],
          };
        }
      }
    }

    // Check raw hex color
    if (/^#[0-9a-fA-F]{3,8}$/.test(valStr)) {
      const knownColors = getAllKnownTokenColors();
      if (!knownColors.has(valStr)) {
        return {
          compliant: false,
          reasoning: `Requested color '${request.requestedValue}' is an uncalibrated raw hex value. Styles must use canonical COLOR_PALETTES role tokens.`,
          suggestedTokens: ["COLOR_PALETTES.light.primary", "COLOR_PALETTES.dark.primary", "COLOR_PALETTES.light.surfaceElevated"],
        };
      }
    }

    return {
      compliant: true,
      reasoning: `Value '${request.requestedValue}' is valid or semantic.`,
    };
  }

  /**
   * Generate an authoritative Immunity Defense receipt rejecting out-of-spec request
   */
  public generateImmunityDefense(request: StyleAdjustmentRequest): TokenImmunityDefense {
    this.defenseCounter += 1;
    const defenseId = `DEFENSE-TKN-${String(this.defenseCounter).padStart(4, "0")}-${Date.now().toString(36)}`;
    const propLower = request.requestedProperty.toLowerCase();
    const valStr = String(request.requestedValue).trim();

    let citedTokenStandard = "Design System Token Sovereign ground truth";
    let tokenName = "md";
    let tokenValue: string | number = 16;
    let cssExpression = "var(--spacing-md, 16px)";

    const pxMatch = valStr.match(/^(-?\d+(\.\d+)?)px$/i);
    if (pxMatch && pxMatch[1] !== undefined) {
      const num = Math.abs(parseFloat(pxMatch[1]));
      if (
        propLower.includes("margin") ||
        propLower.includes("padding") ||
        propLower.includes("gap") ||
        propLower === "top" ||
        propLower === "left" ||
        propLower === "right" ||
        propLower === "bottom"
      ) {
        const closest = findClosestNumericToken(num, VALID_SPACING_VALUES, SPACING_TOKENS);
        citedTokenStandard = "SPACING_TOKENS (Section 12.1 Universal Design Constants)";
        tokenName = closest.tokenName;
        tokenValue = closest.tokenValue;
        cssExpression = `var(--spacing-${tokenName}, ${tokenValue}px)`;
      } else if (propLower === "font-size") {
        const closest = findClosestNumericToken(num, VALID_FONT_SIZES, TYPOGRAPHY_TOKENS.fontSizes);
        citedTokenStandard = "TYPOGRAPHY_TOKENS.fontSizes (Section 12.1 Universal Typography)";
        tokenName = closest.tokenName;
        tokenValue = closest.tokenValue;
        cssExpression = `var(--font-size-${tokenName}, ${tokenValue}px)`;
      } else if (propLower.includes("radius")) {
        const closest = findClosestNumericToken(num, VALID_BORDER_RADII_VALUES, BORDER_RADII);
        citedTokenStandard = "BORDER_RADII (Section 12.1 Universal Border Radii)";
        tokenName = closest.tokenName;
        tokenValue = closest.tokenValue;
        cssExpression = `var(--radius-${tokenName}, ${tokenValue}px)`;
      }
    } else if (/^#[0-9a-fA-F]{3,8}$/.test(valStr)) {
      citedTokenStandard = "COLOR_PALETTES (Section 12.1 Semantic Color Palettes)";
      tokenName = "primary";
      tokenValue = COLOR_PALETTES.light.primary;
      cssExpression = "var(--color-primary, #2563eb)";
    }

    const defenseReasoning =
      `Implementer invokes Token-Compliance Immunity under Master Strategic Blueprint Section 12.2. ` +
      `The requested style '${request.requestedProperty}: ${request.requestedValue}' for component '${request.componentTarget}' ` +
      `violates Sovereign Design System boundaries. The out-of-spec demand is respectfully rejected. ` +
      `Please reframe the design critique using compliant token '${tokenName}' (${tokenValue}) or submit a Token Evolution Proposal.`;

    return {
      defenseId,
      timestamp: new Date().toISOString(),
      status: "INVOKED",
      requestedProperty: request.requestedProperty,
      requestedValue: request.requestedValue,
      citedTokenStandard,
      compliantAlternative: {
        tokenName,
        tokenValue,
        cssExpression,
      },
      defenseReasoning,
    };
  }
}

/**
 * ============================================================================
 * 4. Constructive Compositional Dialectic Engine
 * ============================================================================
 */

