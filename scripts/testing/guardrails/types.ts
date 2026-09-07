/**
 * @file types.ts
 * Type definitions for the Test Purity Guardrail system.
 */

export type PurityViolationCategory = "filesystem" | "subprocess" | "ast_scan" | "anti_pattern";

export type PurityAuditScope = "repository" | "staged" | "explicit";

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

export interface PurityAuditRequest {
  readonly scope: PurityAuditScope;
  readonly files: readonly string[];
}

export interface PurityAuditResult {
  readonly passed: boolean;
  readonly scope: PurityAuditScope;
  readonly requestedFiles: number;
  readonly scannedFiles: number;
  readonly vacuous: boolean;
  readonly violations: readonly PurityViolation[];
  readonly terminalReport: string;
  readonly markdownReport: string;
}
