export type HealthCheckId =
  | "unused-code"
  | "dead-code"
  | "unenforced-declarations"
  | "intent-drift"
  | "literal-fallbacks"
  | "vendor-identifiers"
  | "vendor-prose";

export type HealthSeverity = "failure" | "advisory";

export interface HealthFinding {
  readonly check: HealthCheckId;
  readonly severity: HealthSeverity;
  readonly key: string;
  readonly file: string;
  readonly line?: number;
  readonly detail: string;
  readonly acknowledged?: string;
}

export interface HealthCheckResult {
  readonly check: HealthCheckId;
  readonly title: string;
  readonly findings: readonly HealthFinding[];
  readonly scanned: number;
  readonly limitations: readonly string[];
}

export interface HealthReport {
  readonly healthy: boolean;
  readonly checks: readonly HealthCheckResult[];
  readonly failure_count: number;
  readonly advisory_count: number;
  readonly acknowledged_count: number;
  readonly skipped: readonly { readonly check: HealthCheckId; readonly reason: string }[];
}

export function finding(
  check: HealthCheckId,
  key: string,
  file: string,
  detail: string,
  line?: number,
): HealthFinding {
  return { check, severity: "failure", key, file, detail, ...(line === undefined ? {} : { line }) };
}

export function advisory(
  check: HealthCheckId,
  key: string,
  file: string,
  detail: string,
  line?: number,
): HealthFinding {
  return { ...finding(check, key, file, detail, line), severity: "advisory" };
}
