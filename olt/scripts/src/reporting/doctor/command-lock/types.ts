export interface CognitiveValidatorCommandLockOptions {
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly commands?: Readonly<Record<string, unknown>> | readonly unknown[] | null | undefined;
  readonly events?: readonly unknown[] | null | undefined;
  readonly grants?: readonly unknown[] | null | undefined;
}

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

export function isDoctorFindingBlocking(
  finding: Pick<DoctorDiagnosticFinding, "severity"> | { readonly severity: string },
): boolean {
  const s = String(finding.severity).toUpperCase();
  return s === "ERROR" || s === "CRITICAL" || s === "HIGH";
}

export function computeDoctorEnginePassed(
  findings: readonly (Pick<DoctorDiagnosticFinding, "severity"> | { readonly severity: string })[],
): boolean {
  return !findings.some(isDoctorFindingBlocking);
}
