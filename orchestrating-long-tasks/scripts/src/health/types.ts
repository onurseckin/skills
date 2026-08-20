export type HealthCheckId =
  | "unused-code"
  | "dead-code"
  | "unenforced-declarations"
  | "intent-drift"
  | "literal-fallbacks"
  | "vendor-identifiers"
  | "vendor-prose";

/**
 * A failure is code that can misbehave at run time. An advisory is surface that cannot: an exported
 * type nobody imports is unused, but nothing it does can be wrong. Both are reported; only failures
 * decide `healthy`, because a check whose noise outweighs its signal stops being read.
 */
export type HealthSeverity = "failure" | "advisory";

export interface HealthFinding {
  readonly check: HealthCheckId;
  readonly severity: HealthSeverity;
  /** Stable identity across runs. The acknowledgement list is keyed on it. */
  readonly key: string;
  readonly file: string;
  readonly line?: number;
  readonly detail: string;
  /**
   * Present only when the finding is on the acknowledgement list. An acknowledged finding is still
   * reported and still counted; it is excluded from the regression bar, not from the truth.
   */
  readonly acknowledged?: string;
}

export interface HealthCheckResult {
  readonly check: HealthCheckId;
  readonly title: string;
  readonly findings: readonly HealthFinding[];
  /** What this check inspected, so a clean result cannot be mistaken for a wider guarantee. */
  readonly scanned: number;
  /** What the check cannot see. Printed with the result, never omitted. */
  readonly limitations: readonly string[];
}

export interface HealthReport {
  readonly healthy: boolean;
  readonly checks: readonly HealthCheckResult[];
  readonly failure_count: number;
  readonly advisory_count: number;
  readonly acknowledged_count: number;
  /** Checks that were asked for but could not run, and why. */
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
