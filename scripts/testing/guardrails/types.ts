/**
 * @file types.ts
 * Type definitions for the Test Purity Guardrail system.
 */

export type PurityViolationCategory = "filesystem" | "subprocess" | "ast_scan" | "anti_pattern";

export interface PurityViolation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly category: PurityViolationCategory;
  readonly rule: string;
  readonly message: string;
  readonly snippet?: string;
}

export interface PurityAuditOptions {
  readonly files?: readonly string[] | undefined;
  readonly stagedOnly?: boolean | undefined;
  readonly all?: boolean | undefined;
}

export interface PurityAuditResult {
  readonly passed: boolean;
  readonly scannedFiles: number;
  readonly violations: readonly PurityViolation[];
  readonly terminalReport: string;
  readonly markdownReport: string;
}
