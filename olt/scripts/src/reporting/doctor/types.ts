/**
 * Doctor Diagnostic Engine Types & Contracts
 */

export type DoctorSeverity = "ERROR" | "WARN" | "INFO";

export interface DoctorDiagnosticFinding {
  readonly code: string;
  readonly severity: DoctorSeverity;
  readonly message: string;
  readonly engine: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface DoctorCheckEngineResult {
  readonly engine: string;
  readonly passed: boolean;
  readonly findings: readonly DoctorDiagnosticFinding[];
}

export interface DoctorAutoHealResult {
  readonly autoHealed: readonly string[];
  readonly recoveredLeases: readonly string[];
  readonly projectionRecovered: boolean;
  readonly quarantinedFragments: readonly string[];
}
