import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defaultLayout, runHealthCheck } from "../../../health/index.ts";
import type { HealthCheckId } from "../../../health/types.ts";
import { runDoctor, type DoctorOptions } from "../../../reporting/doctor.ts";
import { systemClock, type Clock } from "../../../workflow/types.ts";
import {
  computeReceiptHash,
  type CliDiagnosticReceipt,
  type DiagnosticReceiptStatus,
} from "./receipts.ts";

export async function runInspectorDoctor(
  runRoot?: string,
  options: DoctorOptions = {},
  clock: Clock = systemClock,
): Promise<CliDiagnosticReceipt> {
  const start = Date.now();
  const timestamp = clock.now().toISOString();

  if (!runRoot || !existsSync(runRoot)) {
    const durationMs = Date.now() - start;
    const summary = runRoot
      ? `Capsule run directory not found: ${runRoot}`
      : "No runRoot specified; doctor inspector skipped";
    const receiptHash = computeReceiptHash("doctor", timestamp, "skipped", summary);
    return {
      inspector: "doctor",
      status: "skipped",
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge: "[RECEIPT: doctor SKIP]",
      details: { runRoot },
    };
  }

  try {
    const docResult = await runDoctor(runRoot, options);
    const durationMs = Date.now() - start;
    const healthy = docResult.healthy === true;
    const issues = Array.isArray(docResult.issues) ? (docResult.issues as readonly string[]) : [];
    const findings = Array.isArray(docResult.behavioral_findings)
      ? docResult.behavioral_findings
      : [];
    const criticalIssues = Array.isArray(docResult.critical_issues)
      ? (docResult.critical_issues as readonly string[])
      : issues.filter((i) => !i.startsWith("[INFO]") && !i.includes("[minor]"));
    const status: DiagnosticReceiptStatus = healthy ? "passed" : "failed";
    const summary =
      status === "passed"
        ? `Capsule doctor verified 100% integrity (healthy: true, 0 findings)`
        : `Doctor detected ${criticalIssues.length} issue(s) and ${findings.length} behavioral finding(s)`;
    const receiptHash = computeReceiptHash("doctor", timestamp, status, summary);
    const badge = `[RECEIPT: doctor ${status === "passed" ? "PASS" : "FAIL"}]`;

    return {
      inspector: "doctor",
      status,
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge,
      details: {
        healthy: docResult.healthy,
        issuesCount: issues.length,
        behavioralFindingsCount: findings.length,
        bunVersion: docResult.bun_version,
      },
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    const summary = `Doctor execution failed with error: ${errMsg}`;
    const receiptHash = computeReceiptHash("doctor", timestamp, "failed", summary);
    return {
      inspector: "doctor",
      status: "failed",
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge: "[RECEIPT: doctor FAIL]",
      error: errMsg,
    };
  }
}

export async function runInspectorHealth(
  scriptsRoot?: string,
  checks?: readonly HealthCheckId[],
  clock: Clock = systemClock,
): Promise<CliDiagnosticReceipt> {
  const start = Date.now();
  const timestamp = clock.now().toISOString();

  try {
    const layout = scriptsRoot !== undefined ? defaultLayout(scriptsRoot) : defaultLayout();
    if (!existsSync(resolve(layout.scriptsRoot, "src"))) {
      const durationMs = Date.now() - start;
      const summary = `No scripts/src directory found under ${layout.scriptsRoot}; health check skipped`;
      const receiptHash = computeReceiptHash("health", timestamp, "skipped", summary);
      return {
        inspector: "health",
        status: "skipped",
        timestamp,
        durationMs,
        summary,
        receiptHash,
        badge: "[RECEIPT: health SKIP]",
        details: { scriptsRoot: layout.scriptsRoot },
      };
    }

    const report = runHealthCheck(layout, checks ?? ["intent-drift"]);
    const durationMs = Date.now() - start;
    const status: DiagnosticReceiptStatus = report.healthy ? "passed" : "failed";
    const summary = report.healthy
      ? `Semantic health passed: 0 failures across ${report.checks.length} checks`
      : `Semantic health failed: ${report.failure_count} failure(s) across ${report.checks.length} checks`;
    const receiptHash = computeReceiptHash("health", timestamp, status, summary);
    const badge = `[RECEIPT: health ${report.healthy ? "PASS" : `FAIL (${report.failure_count})`}]`;

    return {
      inspector: "health",
      status,
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge,
      details: {
        healthy: report.healthy,
        failureCount: report.failure_count,
        checksRun: report.checks.length,
      },
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    const summary = `Health check execution failed with error: ${errMsg}`;
    const receiptHash = computeReceiptHash("health", timestamp, "failed", summary);
    return {
      inspector: "health",
      status: "failed",
      timestamp,
      durationMs,
      summary,
      receiptHash,
      badge: "[RECEIPT: health FAIL]",
      error: errMsg,
    };
  }
}
