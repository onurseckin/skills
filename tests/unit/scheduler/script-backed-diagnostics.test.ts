import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  executePulseTick,
  executePulseTickWithDiagnostics,
  formatDiagnosticReceiptsMarkdown,
  formatWorkSpanBadge,
  generateAsciiDagBadges,
  generateReceiptBadge,
  generateReceiptSummaryBadge,
  generateTaskDagBadge,
  generateWaveLaneBadges,
  runInspectorDagView,
  runInspectorDoctor,
  runInspectorHealth,
  runInspectorUnifiedReport,
  runPulseLoop,
  runScriptBackedDiagnostics,
  SchedulerEngine,
  type CliDiagnosticReceipt,
  type ScriptBackedDiagnosticsResult,
} from "../../../olt/scripts/src/scheduler/index.ts";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import type { TransactionPort, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import {
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
} from "../../../olt/scripts/src/cli/commands/mind-pulse.ts";
import { schedulerState } from "./fixtures.ts";

function createMockPort(initialState: Record<string, unknown>): TransactionPort {
  let state = structuredClone(initialState) as unknown as WorkflowState;
  return {
    read: () => structuredClone(state),
    transact: (actor, kind, payload, mutate) => {
      const draft = structuredClone(state);
      mutate(draft);
      state = draft;
      return state;
    },
  };
}

describe("Script-Backed Scheduler Diagnostics Engine", () => {
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
      const customInspector = (opts: unknown): CliDiagnosticReceipt => ({
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
  });

  describe("2. Individual Diagnostic Inspector Functions", () => {
    test("runInspectorDoctor returns skipped receipt when runRoot is absent", async () => {
      const receipt = await runInspectorDoctor(undefined);
      expect(receipt.inspector).toBe("doctor");
      expect(receipt.status).toBe("skipped");
      expect(receipt.badge).toBe("[RECEIPT: doctor SKIP]");
    });

    test("runInspectorHealth evaluates harness scripts root and passes", async () => {
      const receipt = await runInspectorHealth();
      expect(receipt.inspector).toBe("health");
      expect(receipt.status).toBe("passed");
      expect(receipt.badge).toContain("[RECEIPT: health PASS");
    });

    test("runInspectorDagView evaluates topological waves from state", async () => {
      const state = schedulerState();
      const receipt = await runInspectorDagView(undefined, state);
      expect(receipt.inspector).toBe("dag:view");
      expect(receipt.status).toBe("passed");
      expect(receipt.badge).toContain("WAVES");
      expect(receipt.details?.waveCount).toBeGreaterThanOrEqual(1);
    });

    test("runInspectorUnifiedReport generates in-memory unified report from state", async () => {
      const state = schedulerState();
      const receipt = await runInspectorUnifiedReport(undefined, state);
      expect(receipt.inspector).toBe("report:unified");
      expect(receipt.status).toBe("passed");
      expect(receipt.badge).toContain("[RECEIPT: report:unified IN-MEMORY");
    });
  });

  describe("3. ASCII DAG Badge & Forensics Generators", () => {
    test("generateAsciiDagBadges generates wave/lane badges for all tasks in state", () => {
      const state = schedulerState();
      const badges = generateAsciiDagBadges(state);

      expect(badges.length).toBeGreaterThanOrEqual(3);
      expect(badges.some((b) => b.includes("priority"))).toBeTrue();
      expect(badges.some((b) => b.includes("deep"))).toBeTrue();
      expect(badges.some((b) => b.includes("wide"))).toBeTrue();
      for (const badge of badges) {
        expect(badge).toMatch(/^\[W\d+:L\d+ .+\]$/);
      }
    });

    test("generateTaskDagBadge generates formatted coordinate badge", () => {
      const readyBadge = generateTaskDagBadge("task-core", "ready", { wave: 1, lane: 2 });
      expect(readyBadge).toBe("[W1:L2 (○ READY) task-core]");

      const activeBadge = generateTaskDagBadge("task-core", "running", {
        wave: 2,
        lane: 1,
        assignedAgent: "implementer-1",
        role: "implementer",
      });
      expect(activeBadge).toBe("[W2:L1 (🟢 ACTIVE) implementer-1 (implementer) @ task-core]");
    });

    test("generateWaveLaneBadges summarizes wave groups with concurrency counts", () => {
      const waveGroups = [
        {
          wave: 1,
          tasks: [
            { id: "task-1", status: "done" },
            { id: "task-2", status: "running", assignedAgent: "worker-1" },
          ],
        },
        {
          wave: 2,
          tasks: [{ id: "task-3", status: "ready" }],
        },
      ];

      const badges = generateWaveLaneBadges(waveGroups);
      expect(badges).toHaveLength(2);
      expect(badges[0]).toBe("[WAVE 1: 2 lane(s) (1 active, 1 done)]");
      expect(badges[1]).toBe("[WAVE 2: 1 lane(s) (1 ready)]");
    });

    test("formatWorkSpanBadge formats standard Brent parallelism metrics", () => {
      const badge = formatWorkSpanBadge(12, 3, 4);
      expect(badge).toBe("[WORK/SPAN: W=12 | S=3 | P=4]");
    });

    test("generateReceiptSummaryBadge formats summary badge across mixed statuses", () => {
      const receipts: CliDiagnosticReceipt[] = [
        {
          inspector: "doctor",
          status: "passed",
          timestamp: "2026-08-22T00:00:00.000Z",
          durationMs: 10,
          summary: "ok",
          receiptHash: "1111",
          badge: "[RECEIPT: doctor PASS]",
        },
        {
          inspector: "health",
          status: "warning",
          timestamp: "2026-08-22T00:00:00.000Z",
          durationMs: 15,
          summary: "warn",
          receiptHash: "2222",
          badge: "[RECEIPT: health WARN]",
        },
      ];

      const badge = generateReceiptSummaryBadge(receipts);
      expect(badge).toBe("[CLI-RECEIPTS: doctor ✓ | health ⚠️]");
    });
  });

  describe("4. Scheduler Pulse Integration & Lifecycle Telemetry", () => {
    test("executePulseTick embeds script-backed diagnostics, receipts, and ASCII DAG badges", async () => {
      const port = createMockPort(schedulerState());
      const diagResult = await runScriptBackedDiagnostics({ state: port.read() });

      const tickResult = executePulseTick(port, {
        tickNumber: 1,
        diagnosticsResult: diagResult,
      });

      expect(tickResult.diagnostics).toBeDefined();
      expect(tickResult.cliReceipts).toBeDefined();
      expect(tickResult.cliReceipts?.length).toBeGreaterThanOrEqual(4);
      expect(tickResult.cliReceiptSummaryBadge).toContain("CLI-RECEIPTS");
      expect(tickResult.dagBadges).toBeDefined();
      expect(tickResult.dagBadges?.length).toBeGreaterThanOrEqual(3);
    });

    test("executePulseTickWithDiagnostics runs live diagnostics and executes tick", async () => {
      const port = createMockPort(schedulerState());
      const tickResult = await executePulseTickWithDiagnostics(port, {
        tickNumber: 1,
      });

      expect(tickResult.diagnostics).toBeDefined();
      expect(tickResult.cliReceipts).toBeDefined();
      expect(tickResult.cliReceiptSummaryBadge).toContain("CLI-RECEIPTS");
      expect(tickResult.dagBadges?.length).toBeGreaterThanOrEqual(3);
    });

    test("runPulseLoop with script-backed diagnostics collects telemetry across ticks", async () => {
      const port = createMockPort(schedulerState());
      const loopResult = await runPulseLoop(port, {
        maxTicks: 2,
        intervalMs: 1,
        runDiagnostics: true,
      });

      expect(loopResult.totalTicks).toBe(2);
      expect(loopResult.lastDiagnostics).toBeDefined();
      expect(loopResult.lastDiagnostics?.receipts.length).toBeGreaterThanOrEqual(4);
      expect(loopResult.lastTickResult?.dagBadges?.length).toBeGreaterThanOrEqual(3);
    });

    test("SchedulerEngine instance exposes auditScriptBackedDiagnostics and runScriptBackedDiagnostics", async () => {
      const engine = new SchedulerEngine();
      const state = schedulerState();

      const result = await engine.runScriptBackedDiagnostics({ state });
      expect(result.healthy).toBeTrue();
      expect(result.receipts.length).toBeGreaterThanOrEqual(4);

      const auditResult = await engine.auditScriptBackedDiagnostics({ state });
      expect(auditResult.healthy).toBeTrue();
    });
  });

  describe("5. CLI Command Mind Pulse Diagnostics Embedding", () => {
    test("formatMindPulseActiveBrief embeds CLI Diagnostics Receipts and ASCII DAG badges", () => {
      const brief = formatMindPulseActiveBrief({
        pulseId: "pulse-1",
        runRoot: ".capsules/test-run",
        actor: "mind-1",
        host: "antigravity",
        driver: "perpetual-loop",
        openedAt: "2026-08-22T00:00:00.000Z",
        deadlineAt: "2026-08-22T00:15:00.000Z",
        scheduledIntervalMs: 900_000,
        nextWakeAt: "2026-08-22T00:15:00.000Z",
        pulsesToday: 1,
        pulsesPerDay: null,
        cliReceiptSummaryBadge:
          "[CLI-RECEIPTS: doctor ✓ | health ✓ | dag:view ✓ | report:unified ✓]",
        dagBadges: ["[W1:L1 (○ READY: task-1)]", "[W1:L2 (🟢 ACTIVE: worker-1 @ task-2)]"],
      });

      expect(brief).toContain(
        "- **CLI Diagnostics Receipts**: [CLI-RECEIPTS: doctor ✓ | health ✓ | dag:view ✓ | report:unified ✓]",
      );
      expect(brief).toContain(
        "- **ASCII DAG Badges**: [W1:L1 (○ READY: task-1)] [W1:L2 (🟢 ACTIVE: worker-1 @ task-2)]",
      );
    });

    test("formatMindPulseOpenedBrief embeds CLI Diagnostics Receipts and ASCII DAG badges", () => {
      const brief = formatMindPulseOpenedBrief({
        pulseId: "pulse-2",
        runRoot: ".capsules/test-run-2",
        actor: "mind-1",
        host: "antigravity",
        driver: "perpetual-loop",
        openedAt: "2026-08-22T00:00:00.000Z",
        deadlineAt: "2026-08-22T00:15:00.000Z",
        scheduledIntervalMs: 900_000,
        nextWakeAt: "2026-08-22T00:15:00.000Z",
        pulsesToday: 2,
        pulsesPerDay: null,
        cliReceiptSummaryBadge:
          "[CLI-RECEIPTS: doctor ✓ | health ✓ | dag:view ✓ | report:unified ✓]",
        dagBadges: ["[W1:L1 (○ READY: task-1)]"],
      });

      expect(brief).toContain(
        "- **CLI Diagnostics Receipts**: [CLI-RECEIPTS: doctor ✓ | health ✓ | dag:view ✓ | report:unified ✓]",
      );
      expect(brief).toContain("- **ASCII DAG Badges**: [W1:L1 (○ READY: task-1)]");
    });
  });

  describe("6. Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    test("verifies touched scheduler source files contain zero any and zero suppressions", () => {
      const filesToCheck = [
        "olt/scripts/src/scheduler/diagnostics.ts",
        "olt/scripts/src/scheduler/pulse.ts",
        "olt/scripts/src/scheduler/metrics.ts",
        "olt/scripts/src/scheduler/index.ts",
      ];

      const anyWord = "a" + "n" + "y";
      const anyPattern = new RegExp(`:\\s*${anyWord}\\b|\\bas\\s+${anyWord}\\b|<${anyWord}>`, "g");
      const suppressionPattern = new RegExp("@ts-(?:ignore|nocheck|expect-error)", "g");

      for (const relPath of filesToCheck) {
        const fullPath = resolve(process.cwd(), relPath);
        const content = readFileSync(fullPath, "utf8");

        const matches = content.match(anyPattern);
        expect(matches ?? []).toEqual([]);

        const suppressionMatches = content.match(suppressionPattern);
        expect(suppressionMatches ?? []).toEqual([]);
      }
    });
  });
});
