import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { resolve } from "node:path";
import {
  formatDiagnosticReceiptsMarkdown,
  runInspectorDagView,
  runInspectorDoctor,
  runInspectorHealth,
  runInspectorUnifiedReport,
  runScriptBackedDiagnostics,
  type CliDiagnosticReceipt,
} from "../../../olt/scripts/src/engine/scheduler/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupVirtualBrowserFS,
  setupVirtualBrowserFS,
  tempDir,
} from "../../reporting/browser/browser-virtual-fs.ts";
import { schedulerState } from "../fixtures.ts";

describe("Script-Backed Diagnostics: Execution & Receipts", () => {
  beforeEach(() => {
    setupVirtualBrowserFS();
  });

  afterEach(() => {
    cleanupVirtualBrowserFS();
  });

  describe("1. Script-Backed Diagnostics Execution & Receipts", () => {
    test("runScriptBackedDiagnostics executes all default inspectors and returns healthy result", async () => {
      const state = schedulerState();
      const result = await runScriptBackedDiagnostics({ state });

      expect(result.healthy).toBeTrue();
      expect(result.receipts.length).toBeGreaterThanOrEqual(4);
      expect(result.receiptSummaryBadge).toContain("CLI-RECEIPTS");
      expect(result.receiptSummaryBadge).toContain("doctor");
      expect(result.receiptSummaryBadge).toContain("health");
      expect(result.receiptSummaryBadge).toContain("dag:view");
      expect(result.receiptSummaryBadge).toContain("report:unified");
      expect(result.errors).toHaveLength(0);
      expect(result.executedAt).toBeString();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("generates deterministic SHA-256 cryptographic receipt hashes", async () => {
      const state = schedulerState();
      const result = await runScriptBackedDiagnostics({ state });

      for (const receipt of result.receipts) {
        expect(receipt.receiptHash).toBeString();
        expect(receipt.receiptHash).toHaveLength(64);
        expect(receipt.badge).toContain("RECEIPT:");
        expect(receipt.summary).toBeString();
        expect(receipt.timestamp).toBeString();
      }
    });

    test("formats structured diagnostic receipts markdown brief", async () => {
      const state = schedulerState();
      const result = await runScriptBackedDiagnostics({ state });
      const md = formatDiagnosticReceiptsMarkdown(result);

      expect(md).toContain("### Script-Backed Diagnostics Engine Telemetry");
      expect(md).toContain("- **Status**: HEALTHY");
      expect(md).toContain("- **Summary Badge**:");
      expect(md).toContain("- **Live CLI Diagnostic Receipts**:");
      expect(md).toContain("- **ASCII DAG Badges**:");
    });

    test("supports custom inspector registration with graceful error handling", async () => {
      const customInspector = (_opts: unknown): CliDiagnosticReceipt => ({
        inspector: "custom:security",
        status: "passed",
        timestamp: new Date().toISOString(),
        durationMs: 5,
        summary: "Security scan clean (0 vulnerabilities)",
        receiptHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        badge: "[RECEIPT: custom:security PASS]",
      });

      const result = await runScriptBackedDiagnostics({
        inspectors: ["custom:security", "dag:view"],
        customInspectors: {
          "custom:security": customInspector,
        },
        state: schedulerState(),
      });

      expect(result.receipts).toHaveLength(2);
      expect(result.receipts[0]?.inspector).toBe("custom:security");
      expect(result.receipts[0]?.status).toBe("passed");
      expect(result.receiptSummaryBadge).toContain("custom:security ✓");
    });

    test("strict mode throws HarnessError when an inspector fails", async () => {
      const failingInspector = (): CliDiagnosticReceipt => ({
        inspector: "failing:check",
        status: "failed",
        timestamp: new Date().toISOString(),
        durationMs: 2,
        summary: "Critical defect detected",
        receiptHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        badge: "[RECEIPT: failing:check FAIL]",
      });

      await expect(
        runScriptBackedDiagnostics({
          inspectors: ["failing:check"],
          customInspectors: {
            "failing:check": failingInspector,
          },
          strict: true,
        }),
      ).rejects.toThrow(HarnessError);
    });

    test("isolates inspector throw without crashing the overall diagnostics suite", async () => {
      const throwingInspector = (): CliDiagnosticReceipt => {
        throw new Error("Crash during execution");
      };

      const result = await runScriptBackedDiagnostics({
        inspectors: ["throwing:check", "dag:view"],
        customInspectors: {
          "throwing:check": throwingInspector,
        },
        state: schedulerState(),
      });

      expect(result.healthy).toBeFalse();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.receipts.some((r) => r.inspector === "throwing:check" && r.status === "failed"),
      ).toBeTrue();
      expect(
        result.receipts.some((r) => r.inspector === "dag:view" && r.status === "passed"),
      ).toBeTrue();
    });

    test("handles unrecognized inspector names by generating warning receipt", async () => {
      const result = await runScriptBackedDiagnostics({
        inspectors: ["unrecognized:inspector" as unknown as "doctor"],
        state: schedulerState(),
      });
      expect(result.healthy).toBeFalse();
      expect(result.receipts[0]?.status).toBe("warning");
      expect(result.receipts[0]?.summary).toContain("Unrecognized inspector");
    });
  });

  describe("2. Individual Diagnostic Inspector Functions", () => {
    test("runInspectorDoctor evaluates initialized runRoot and handles absent path", async () => {
      const receipt1 = await runInspectorDoctor(undefined);
      expect(receipt1.inspector).toBe("doctor");
      expect(receipt1.status).toBe("skipped");
      expect(receipt1.badge).toBe("[RECEIPT: doctor SKIP]");

      const receipt2 = await runInspectorDoctor("/nonexistent/invalid/run/dir");
      expect(receipt2.status).toBe("skipped");

      const root = tempDir("diag-doc-test");
      const runRoot = initRun(
        root,
        "diag-doc-run",
        Buffer.from("Prompt for diag doctor"),
        "argv",
        true,
      );
      const receipt3 = await runInspectorDoctor(runRoot);
      expect(receipt3.status).toBe("passed");
      expect(receipt3.badge).toBe("[RECEIPT: doctor PASS]");

      const corruptDocRoot = tempDir("corrupt-doc-test");
      const corruptDocRun = resolve(corruptDocRoot, "corrupt-run");
      fs.mkdirSync(corruptDocRun, { recursive: true });
      fs.writeFileSync(resolve(corruptDocRun, "manifest.json"), "NOT_JSON");
      const receiptCorrupt = await runInspectorDoctor(corruptDocRun);
      expect(receiptCorrupt.status).toBe("failed");
    });

    test("runInspectorHealth evaluates harness scripts root and handles missing src dir", async () => {
      const receipt = await runInspectorHealth();
      expect(receipt.inspector).toBe("health");
      expect(receipt.status).toBe("passed");
      expect(receipt.badge).toContain("[RECEIPT: health PASS");

      const skipReceipt = await runInspectorHealth("/nonexistent/scripts/root");
      expect(skipReceipt.status).toBe("skipped");
    });

    test("runInspectorDagView evaluates topological waves from state, real runRoot, and cycles", async () => {
      const state = schedulerState();
      const receipt1 = await runInspectorDagView(undefined, state);
      expect(receipt1.inspector).toBe("dag:view");
      expect(receipt1.status).toBe("passed");
      expect(receipt1.badge).toContain("WAVES");
      expect(receipt1.details?.waveCount).toBeGreaterThanOrEqual(1);

      const receipt2 = await runInspectorDagView(undefined, undefined);
      expect(receipt2.status).toBe("passed");

      const root = tempDir("diag-dag-test");
      const runRoot = initRun(
        root,
        "diag-dag-run",
        Buffer.from("Prompt for diag dag view"),
        "argv",
        true,
      );
      const receipt3 = await runInspectorDagView(runRoot);
      expect(receipt3.status).toBe("passed");

      const cyclicGraphState = {
        graph: {
          edges: [
            { source: "a", target: "b", type: "depends_on" },
            { source: "b", target: "a", type: "depends_on" },
          ],
        },
        tasks: { a: { id: "a" }, b: { id: "b" } },
      };
      const receiptFail = await runInspectorDagView(undefined, cyclicGraphState);
      expect(receiptFail.status).toBe("failed");
    });

    test("runInspectorUnifiedReport generates in-memory unified report, real runRoot report, and handles missing input", async () => {
      const state = schedulerState();
      const receipt1 = await runInspectorUnifiedReport(undefined, state);
      expect(receipt1.inspector).toBe("report:unified");
      expect(receipt1.status).toBe("passed");
      expect(receipt1.badge).toContain("[RECEIPT: report:unified IN-MEMORY");

      const receiptSkip = await runInspectorUnifiedReport(undefined, undefined);
      expect(receiptSkip.status).toBe("skipped");

      const root = tempDir("diag-unified-test");
      const runRoot = initRun(
        root,
        "diag-unified-run",
        Buffer.from("Prompt for diag unified report"),
        "argv",
        true,
      );
      const receiptReal = await runInspectorUnifiedReport(runRoot);
      expect(receiptReal.status).toBe("passed");

      const corruptRoot = tempDir("corrupt-unified-test");
      const corruptRunRoot = resolve(corruptRoot, "corrupt-run");
      fs.mkdirSync(corruptRunRoot, { recursive: true });
      const receiptCatch = await runInspectorUnifiedReport(corruptRunRoot);
      expect(receiptCatch.status).toBe("failed");
    });
  });
});
