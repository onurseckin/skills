/**
 * Defect Remediation: Missing function 'resolveIsLargeText' in reporting/theme/evaluation.ts
 * Defect Ref: defect-doctor-reporting-theme-resolve-is-large-text-undefined
 * Error Code: UNDEFINED_SYMBOL_IN_THEME_EVALUATION
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DefectEntry, DefectSeverity } from "../mind/contracts/defect-contracts.ts";
import { calculateWcagContrast } from "../reporting/theme/color-space.ts";

export const DEFECT_REF = "defect-doctor-reporting-theme-resolve-is-large-text-undefined" as const;
export const UNDEFINED_SYMBOL_IN_THEME_EVALUATION = "UNDEFINED_SYMBOL_IN_THEME_EVALUATION" as const;
export const CANONICAL_THEME_EVALUATION_MODULE_PATH = "olt/scripts/src/reporting/theme/evaluation.ts" as const;

export const LARGE_TEXT_FONT_SIZE_PT = 18 as const;
export const LARGE_TEXT_BOLD_FONT_SIZE_PT = 14 as const;
export const NORMAL_TEXT_WCAG_AA_THRESHOLD = 4.5 as const;
export const LARGE_TEXT_WCAG_AA_THRESHOLD = 3.0 as const;
export const NORMAL_TEXT_WCAG_AAA_THRESHOLD = 7.0 as const;
export const LARGE_TEXT_WCAG_AAA_THRESHOLD = 4.5 as const;

export const REQUIRED_THEME_EVALUATION_SYMBOLS: readonly string[] = Object.freeze([
  "resolveIsLargeText",
  "getRequiredThreshold",
  "evaluateSingleStandard",
  "evaluateThemeContrastMatrix",
]);

export interface ThemeEvaluationSymbolErrorOptions {
  readonly code?: string | undefined;
  readonly defectRef?: string | undefined;
  readonly symbolName?: string | undefined;
  readonly filePath?: string | undefined;
  readonly issues?: readonly string[] | undefined;
  readonly cause?: unknown;
}

export class ThemeEvaluationSymbolError extends Error {
  readonly code: string;
  readonly defectRef: string;
  readonly symbolName: string | undefined;
  readonly filePath: string | undefined;
  readonly issues: readonly string[];

  constructor(message: string, options?: ThemeEvaluationSymbolErrorOptions) {
    super(message);
    this.name = "ThemeEvaluationSymbolError";
    this.code = options?.code ?? UNDEFINED_SYMBOL_IN_THEME_EVALUATION;
    this.defectRef = options?.defectRef ?? DEFECT_REF;
    this.symbolName = options?.symbolName;
    this.filePath = options?.filePath;
    this.issues = options?.issues ?? [];
    Object.setPrototypeOf(this, ThemeEvaluationSymbolError.prototype);
  }
}

export function resolveIsLargeText(fontSizePt: number, isBold = false): boolean {
  if (typeof fontSizePt !== "number" || Number.isNaN(fontSizePt) || fontSizePt <= 0) return false;
  if (fontSizePt >= LARGE_TEXT_FONT_SIZE_PT) return true;
  if (fontSizePt >= LARGE_TEXT_BOLD_FONT_SIZE_PT && Boolean(isBold)) return true;
  return false;
}

export interface EvaluateContrastOptions {
  readonly foreground: string;
  readonly background: string;
  readonly fontSizePt?: number | undefined;
  readonly isBold?: boolean | undefined;
  readonly isLargeText?: boolean | undefined;
  readonly standard?: "wcag-aa" | "wcag-aaa" | undefined;
}

export interface ContrastEvaluationResult {
  readonly foreground: string;
  readonly background: string;
  readonly contrastRatio: number;
  readonly requiredThreshold: number;
  readonly isLargeText: boolean;
  readonly passed: boolean;
  readonly standard: "wcag-aa" | "wcag-aaa";
  readonly details: string;
}

export function evaluateContrast(
  foregroundOrOptions: string | EvaluateContrastOptions,
  background?: string,
  fontSizePt?: number,
  isBold?: boolean,
  standard?: "wcag-aa" | "wcag-aaa",
): ContrastEvaluationResult {
  const isStr = typeof foregroundOrOptions === "string";
  const fg = isStr ? foregroundOrOptions : foregroundOrOptions.foreground;
  const bg = isStr ? (background ?? "#ffffff") : foregroundOrOptions.background;
  const size = isStr ? (typeof fontSizePt === "number" ? fontSizePt : 12) : (foregroundOrOptions.fontSizePt ?? 12);
  const bold = isStr ? Boolean(isBold) : Boolean(foregroundOrOptions.isBold);
  const isLarge = isStr ? undefined : foregroundOrOptions.isLargeText;
  const std: "wcag-aa" | "wcag-aaa" = isStr ? (standard ?? "wcag-aa") : (foregroundOrOptions.standard ?? "wcag-aa");

  const effectiveIsLarge = isLarge !== undefined ? isLarge : resolveIsLargeText(size, bold);
  const ratio = calculateWcagContrast(fg, bg);
  const requiredThreshold = std === "wcag-aaa"
    ? (effectiveIsLarge ? LARGE_TEXT_WCAG_AAA_THRESHOLD : NORMAL_TEXT_WCAG_AAA_THRESHOLD)
    : (effectiveIsLarge ? LARGE_TEXT_WCAG_AA_THRESHOLD : NORMAL_TEXT_WCAG_AA_THRESHOLD);

  return {
    foreground: fg,
    background: bg,
    contrastRatio: ratio,
    requiredThreshold,
    isLargeText: effectiveIsLarge,
    passed: ratio >= requiredThreshold,
    standard: std,
    details: `CR: ${ratio.toFixed(2)}:1 (required: ≥${requiredThreshold.toFixed(1)}:1, ${effectiveIsLarge ? "large" : "normal"} text under ${std.toUpperCase()})`,
  };
}

export function extractDeclaredSymbols(sourceCode: string): readonly string[] {
  const symbols = new Set<string>();
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g;
  const constRegex = /(?:export\s+)?const\s+([a-zA-Z0-9_$]+)\s*=/g;
  const exportBlockRegex = /export\s*\{([^}]+)\}/g;

  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(sourceCode)) !== null) if (match[1]) symbols.add(match[1]);
  while ((match = constRegex.exec(sourceCode)) !== null) if (match[1]) symbols.add(match[1]);
  while ((match = exportBlockRegex.exec(sourceCode)) !== null) {
    if (match[1]) {
      for (const p of match[1].split(",")) {
        const name = p.trim().split(/\s+as\s+/)[0]?.trim();
        if (name) symbols.add(name);
      }
    }
  }
  return Array.from(symbols);
}

export interface ThemeEvaluationSymbolValidationResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly valid: boolean;
  readonly hasResolveIsLargeText: boolean;
  readonly exportedSymbols: readonly string[];
  readonly missingSymbols: readonly string[];
  readonly issues: readonly string[];
  readonly targetPath?: string | undefined;
}

export function validateThemeEvaluationSymbols(sourceCodeOrFilePath?: string): ThemeEvaluationSymbolValidationResult {
  let content = "";
  let targetPath: string | undefined;

  if (!sourceCodeOrFilePath) {
    targetPath = resolve(process.cwd(), CANONICAL_THEME_EVALUATION_MODULE_PATH);
    if (!existsSync(targetPath)) {
      return {
        defectRef: DEFECT_REF,
        valid: false,
        hasResolveIsLargeText: false,
        exportedSymbols: [],
        missingSymbols: [...REQUIRED_THEME_EVALUATION_SYMBOLS],
        issues: [`Theme evaluation file does not exist at ${targetPath}`],
        targetPath,
      };
    }
    content = readFileSync(targetPath, "utf-8");
  } else if (!sourceCodeOrFilePath.includes("\n") && (sourceCodeOrFilePath.endsWith(".ts") || sourceCodeOrFilePath.endsWith(".js") || existsSync(sourceCodeOrFilePath))) {
    targetPath = resolve(sourceCodeOrFilePath);
    if (!existsSync(targetPath)) {
      return {
        defectRef: DEFECT_REF,
        valid: false,
        hasResolveIsLargeText: false,
        exportedSymbols: [],
        missingSymbols: [...REQUIRED_THEME_EVALUATION_SYMBOLS],
        issues: [`File not found at ${targetPath}`],
        targetPath,
      };
    }
    content = readFileSync(targetPath, "utf-8");
  } else {
    content = sourceCodeOrFilePath;
  }

  const declared = extractDeclaredSymbols(content);
  const missing = REQUIRED_THEME_EVALUATION_SYMBOLS.filter((s) => !declared.includes(s));
  const issues = missing.map((sym) => `Required symbol '${sym}' is not declared or exported in theme evaluation module.`);

  return {
    defectRef: DEFECT_REF,
    valid: missing.length === 0 && issues.length === 0,
    hasResolveIsLargeText: declared.includes("resolveIsLargeText"),
    exportedSymbols: declared,
    missingSymbols: missing,
    issues,
    targetPath,
  };
}

export function assertThemeEvaluationSymbolsPurity(sourceCodeOrFilePath?: string): void {
  const result = validateThemeEvaluationSymbols(sourceCodeOrFilePath);
  if (!result.valid) {
    throw new ThemeEvaluationSymbolError(`Theme evaluation symbol validation failed: ${result.issues.join("; ")}`, {
      code: UNDEFINED_SYMBOL_IN_THEME_EVALUATION,
      defectRef: DEFECT_REF,
      symbolName: result.missingSymbols[0] ?? "resolveIsLargeText",
      filePath: result.targetPath,
      issues: result.issues,
    });
  }
}

export interface ThemeEvaluationModuleAuditResult {
  readonly defectRef: typeof DEFECT_REF;
  readonly resolved: boolean;
  readonly targetFile: string;
  readonly symbolValidation: ThemeEvaluationSymbolValidationResult;
  readonly verifiedSymbols: readonly string[];
  readonly sampleEvaluations: {
    readonly normalTextPassed: boolean;
    readonly largeTextPassed: boolean;
    readonly largeTextBoldPassed: boolean;
  };
  readonly issues: readonly string[];
  readonly timestamp: string;
}

export function auditThemeEvaluationModule(filePath?: string): ThemeEvaluationModuleAuditResult {
  const target = filePath ? resolve(filePath) : resolve(process.cwd(), CANONICAL_THEME_EVALUATION_MODULE_PATH);
  const validation = validateThemeEvaluationSymbols(target);
  const normalEval = evaluateContrast({ foreground: "#767676", background: "#ffffff", fontSizePt: 12, isBold: false });
  const largeEval = evaluateContrast({ foreground: "#888888", background: "#ffffff", fontSizePt: 18, isBold: false });
  const largeBoldEval = evaluateContrast({ foreground: "#888888", background: "#ffffff", fontSizePt: 14, isBold: true });

  return {
    defectRef: DEFECT_REF,
    resolved: validation.valid && normalEval.passed && largeEval.passed && largeBoldEval.passed,
    targetFile: target,
    symbolValidation: validation,
    verifiedSymbols: REQUIRED_THEME_EVALUATION_SYMBOLS,
    sampleEvaluations: {
      normalTextPassed: normalEval.passed,
      largeTextPassed: largeEval.passed,
      largeTextBoldPassed: largeBoldEval.passed,
    },
    issues: [...validation.issues],
    timestamp: new Date().toISOString(),
  };
}

export interface CreateThemeEvaluationDefectEntryOptions {
  readonly id?: string | undefined;
  readonly filePath?: string | undefined;
  readonly missingSymbol?: string | undefined;
  readonly status?: string | undefined;
  readonly severity?: DefectSeverity | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly timestamp?: string | undefined;
}

export function createThemeEvaluationDefectEntry(options: CreateThemeEvaluationDefectEntryOptions = {}): DefectEntry {
  const missingSymbol = options.missingSymbol ?? "resolveIsLargeText";
  const filePath = options.filePath ?? CANONICAL_THEME_EVALUATION_MODULE_PATH;

  return {
    id: options.id ?? `${DEFECT_REF}-${Date.now()}`,
    domain: "doctor-theme-evaluation",
    error_code: UNDEFINED_SYMBOL_IN_THEME_EVALUATION,
    title: `Missing function '${missingSymbol}' in reporting/theme/evaluation.ts`,
    description: `Remediation for missing symbol '${missingSymbol}' referenced in theme evaluation: ${filePath}`,
    message: `Doctor checkDualChannelUi fails during theme contrast evaluation because '${missingSymbol}' is undefined.`,
    status: options.status ?? "resolved",
    type: "DOCTOR_FINDING",
    category: "code_defect",
    severity: options.severity ?? "high",
    observation: options.observation ?? `Theme contrast evaluation referenced '${missingSymbol}' which was undefined or unexported in ${filePath}.`,
    remediation: options.remediation ?? `Implement and export '${missingSymbol}(fontSizePt: number, isBold?: boolean): boolean' in reporting/theme/evaluation.ts.`,
    context: {
      file: filePath,
      function: missingSymbol,
      defectReference: DEFECT_REF,
      rule: "wcag-aa-contrast-evaluation",
      mechanism: "symbol-resolution",
    },
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}
