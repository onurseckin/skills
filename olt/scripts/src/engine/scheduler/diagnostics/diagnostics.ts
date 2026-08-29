import { HarnessError } from "../../../core/errors/index.ts";
import { systemClock } from "../../../workflow/types.ts";
import {
  type DiagnosticInspectorName,
  type DiagnosticReceiptStatus,
  type CliDiagnosticReceipt,
  type ScriptBackedDiagnosticsOptions,
  type ScriptBackedDiagnosticsResult,
  computeReceiptHash,
  generateReceiptBadge,
  generateReceiptSummaryBadge,
  formatDiagnosticReceiptsMarkdown,
} from "./receipts.ts";
import { generateAsciiDagBadges } from "./ascii-badges.ts";
import {
  runInspectorDoctor,
  runInspectorHealth,
  runInspectorDagView,
  runInspectorUnifiedReport,
} from "./inspectors.ts";

export {
  type DiagnosticInspectorName,
  type DiagnosticReceiptStatus,
  type CliDiagnosticReceipt,
  type ScriptBackedDiagnosticsOptions,
  type ScriptBackedDiagnosticsResult,
  computeReceiptHash,
  generateReceiptBadge,
  generateReceiptSummaryBadge,
  formatDiagnosticReceiptsMarkdown,
  generateAsciiDagBadges,
  runInspectorDoctor,
  runInspectorHealth,
  runInspectorDagView,
  runInspectorUnifiedReport,
};

export async function runScriptBackedDiagnostics(
  options: ScriptBackedDiagnosticsOptions = {},
): Promise<ScriptBackedDiagnosticsResult> {
  const start = Date.now();
  const clock = options.clock ?? systemClock;
  const executedAt = clock.now().toISOString();
  const errors: string[] = [];

  const inspectorsToRun: DiagnosticInspectorName[] = options.inspectors
    ? [...options.inspectors]
    : ["doctor", "health", "dag:view", "report:unified"];

  const receipts: CliDiagnosticReceipt[] = [];
  let doctorReceipt: CliDiagnosticReceipt | undefined;
  let healthReceipt: CliDiagnosticReceipt | undefined;
  let dagViewReceipt: CliDiagnosticReceipt | undefined;
  let unifiedReportReceipt: CliDiagnosticReceipt | undefined;

  for (const inspector of inspectorsToRun) {
    if (options.customInspectors && inspector in options.customInspectors) {
      try {
        const customFn = options.customInspectors[inspector]!;
        const receipt = await customFn(options);
        receipts.push(receipt);
        if (receipt.status === "failed") {
          errors.push(receipt.error ?? `${inspector} inspector failed: ${receipt.summary}`);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const receiptHash = computeReceiptHash(
          inspector,
          executedAt,
          "failed",
          `Custom inspector error: ${errMsg}`,
        );
        receipts.push({
          inspector,
          status: "failed",
          timestamp: executedAt,
          durationMs: 0,
          summary: `Custom inspector threw: ${errMsg}`,
          receiptHash,
          badge: `[RECEIPT: ${inspector} FAIL]`,
          error: errMsg,
        });
        errors.push(errMsg);
      }
      continue;
    }

    if (inspector === "doctor") {
      doctorReceipt = await runInspectorDoctor(options.runRoot, options.doctorOptions ?? {}, clock);
      receipts.push(doctorReceipt);
      if (doctorReceipt.status === "failed") {
        errors.push(doctorReceipt.error ?? doctorReceipt.summary);
      }
    } else if (inspector === "health") {
      healthReceipt = await runInspectorHealth(options.scriptsRoot, options.healthChecks, clock);
      receipts.push(healthReceipt);
      if (healthReceipt.status === "failed") {
        errors.push(healthReceipt.error ?? healthReceipt.summary);
      }
    } else if (inspector === "dag:view") {
      dagViewReceipt = await runInspectorDagView(
        options.runRoot,
        options.state,
        options.repoRoot ?? process.cwd(),
        clock,
      );
      receipts.push(dagViewReceipt);
      if (dagViewReceipt.status === "failed") {
        errors.push(dagViewReceipt.error ?? dagViewReceipt.summary);
      }
    } else if (inspector === "report:unified") {
      unifiedReportReceipt = await runInspectorUnifiedReport(options.runRoot, options.state, clock);
      receipts.push(unifiedReportReceipt);
      if (unifiedReportReceipt.status === "failed") {
        errors.push(unifiedReportReceipt.error ?? unifiedReportReceipt.summary);
      }
    } else {
      const summary = `Unrecognized inspector '${inspector}'; check registered inspector list`;
      const receiptHash = computeReceiptHash(inspector, executedAt, "warning", summary);
      receipts.push({
        inspector,
        status: "warning",
        timestamp: executedAt,
        durationMs: 0,
        summary,
        receiptHash,
        badge: `[RECEIPT: ${inspector} WARN]`,
      });
    }
  }

  const durationMs = Date.now() - start;
  const hasFailures = receipts.some((r) => r.status === "failed");
  const hasWarnings = receipts.some((r) => r.status === "warning");
  const healthy = !hasFailures && !hasWarnings;

  if (options.strict && (!healthy || errors.length > 0)) {
    throw new HarnessError(
      "INTEGRITY",
      `Script-backed diagnostics failed in strict mode: ${errors.join("; ") || "unhealthy receipts"}`,
    );
  }

  const receiptSummaryBadge = generateReceiptSummaryBadge(receipts);
  const dagBadges = generateAsciiDagBadges(options.state ?? []);

  return {
    healthy,
    executedAt,
    durationMs,
    receipts,
    receiptSummaryBadge,
    doctorReceipt,
    healthReceipt,
    dagViewReceipt,
    unifiedReportReceipt,
    dagBadges,
    errors,
  };
}
