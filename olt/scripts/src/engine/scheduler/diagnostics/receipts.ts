import { createHash } from "node:crypto";
import type { HealthCheckId } from "../../../health/types.ts";
import type { DoctorOptions } from "../../../reporting/doctor.ts";
import type { Clock, WorkflowState } from "../../../workflow/types.ts";

export type DiagnosticInspectorName =
  | "doctor"
  | "health"
  | "dag:view"
  | "report:unified"
  | (string & {});

export type DiagnosticReceiptStatus = "passed" | "failed" | "warning" | "skipped";

export interface CliDiagnosticReceipt {
  readonly inspector: DiagnosticInspectorName;
  readonly status: DiagnosticReceiptStatus;
  readonly timestamp: string;
  readonly durationMs: number;
  readonly summary: string;
  readonly receiptHash: string;
  readonly badge: string;
  readonly details?: Record<string, unknown> | undefined;
  readonly error?: string | undefined;
}

export interface ScriptBackedDiagnosticsOptions {
  readonly runRoot?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly scriptsRoot?: string | undefined;
  readonly state?: WorkflowState | Record<string, unknown> | unknown | undefined;
  readonly inspectors?: readonly DiagnosticInspectorName[] | undefined;
  readonly clock?: Clock | undefined;
  readonly strict?: boolean | undefined;
  readonly doctorOptions?: DoctorOptions | undefined;
  readonly healthChecks?: readonly HealthCheckId[] | undefined;
  readonly customInspectors?:
    | Readonly<
        Record<
          string,
          (
            options: ScriptBackedDiagnosticsOptions,
          ) => Promise<CliDiagnosticReceipt> | CliDiagnosticReceipt
        >
      >
    | undefined;
}

export interface ScriptBackedDiagnosticsResult {
  readonly healthy: boolean;
  readonly executedAt: string;
  readonly durationMs: number;
  readonly receipts: readonly CliDiagnosticReceipt[];
  readonly receiptSummaryBadge: string;
  readonly doctorReceipt?: CliDiagnosticReceipt | undefined;
  readonly healthReceipt?: CliDiagnosticReceipt | undefined;
  readonly dagViewReceipt?: CliDiagnosticReceipt | undefined;
  readonly unifiedReportReceipt?: CliDiagnosticReceipt | undefined;
  readonly liveAsciiDag?: string | undefined;
  readonly dagBadges?: readonly string[] | undefined;
  readonly errors: readonly string[];
}

export function computeReceiptHash(
  inspector: string,
  timestamp: string,
  status: string,
  summary: string,
): string {
  return createHash("sha256")
    .update(`${inspector}:${timestamp}:${status}:${summary}`)
    .digest("hex");
}

export function generateReceiptBadge(receipt: CliDiagnosticReceipt): string {
  const icon =
    receipt.status === "passed"
      ? "PASS"
      : receipt.status === "warning"
        ? "WARN"
        : receipt.status === "skipped"
          ? "SKIP"
          : "FAIL";
  return `[RECEIPT: ${receipt.inspector} ${icon}]`;
}

export function generateReceiptSummaryBadge(receipts: readonly CliDiagnosticReceipt[]): string {
  if (receipts.length === 0) {
    return "[CLI-RECEIPTS: none]";
  }
  const parts = receipts.map((r) => {
    const symbol =
      r.status === "passed"
        ? "✓"
        : r.status === "warning"
          ? "⚠️"
          : r.status === "skipped"
            ? "○"
            : "✗";
    return `${r.inspector} ${symbol}`;
  });
  return `[CLI-RECEIPTS: ${parts.join(" | ")}]`;
}

export function formatDiagnosticReceiptsMarkdown(result: ScriptBackedDiagnosticsResult): string {
  const lines: string[] = [
    `### Script-Backed Diagnostics Engine Telemetry`,
    `- **Status**: ${result.healthy ? "HEALTHY (All CLI Diagnostics Passed)" : "ATTENTION (Diagnostics Failed)"}`,
    `- **Executed At**: \`${result.executedAt}\` (${result.durationMs}ms)`,
    `- **Summary Badge**: \`${result.receiptSummaryBadge}\``,
  ];

  if (result.receipts.length > 0) {
    lines.push(`- **Live CLI Diagnostic Receipts**:`);
    for (const receipt of result.receipts) {
      const mark =
        receipt.status === "passed"
          ? "✓"
          : receipt.status === "skipped"
            ? "○"
            : receipt.status === "warning"
              ? "⚠️"
              : "✗";
      lines.push(
        `  - \`${receipt.badge}\` **${receipt.inspector}** (${receipt.durationMs}ms) [${mark}]: ${receipt.summary}`,
      );
      lines.push(`    - *Receipt Hash*: \`${receipt.receiptHash.slice(0, 16)}...\``);
    }
  }

  if (result.dagBadges && result.dagBadges.length > 0) {
    lines.push(`- **ASCII DAG Badges**:`);
    lines.push(`  ${result.dagBadges.join(" ")}`);
  }

  if (result.errors.length > 0) {
    lines.push(`- **Diagnostic Errors**:`);
    for (const err of result.errors) {
      lines.push(`  - ❌ ${err}`);
    }
  }

  return lines.join("\n");
}
