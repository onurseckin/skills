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

export type PurityAllowance = ReadonlyMap<string, number>;

export interface PurityExceedance {
  readonly file: string;
  readonly rule: string;
  readonly observed: number;
  readonly allowed: number;
}

export interface PurityTolerance {
  readonly blocking: readonly PurityViolation[];
  readonly tolerated: readonly PurityViolation[];
  readonly exceedances: readonly PurityExceedance[];
}

export interface PurityAuditOptions {
  readonly files?: readonly string[] | undefined;
  readonly stagedOnly?: boolean | undefined;
  readonly all?: boolean | undefined;
  readonly strict?: boolean | undefined;
  readonly allowance?: PurityAllowance | undefined;
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
  readonly blockingViolations: readonly PurityViolation[];
  readonly toleratedViolations: readonly PurityViolation[];
  readonly exceedances: readonly PurityExceedance[];
  readonly terminalReport: string;
  readonly markdownReport: string;
}
