import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  executePulseTick,
  executePulseTickWithDiagnostics,
  formatWorkSpanBadge,
  generateAsciiDagBadges,
  generateReceiptBadge,
  generateReceiptSummaryBadge,
  generateTaskDagBadge,
  generateWaveLaneBadges,
  runPulseLoop,
  runScriptBackedDiagnostics,
  SchedulerEngine,
  type CliDiagnosticReceipt,
} from "../../../../olt/scripts/src/engine/scheduler/index.ts";
import type { TransactionPort, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import { schedulerState } from "../fixtures.ts";
import {
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
} from "../../../../olt/scripts/src/cli/commands/mind-pulse.ts";

function createMockPort(initialState: Record<string, unknown>): TransactionPort {
  let state = structuredClone(initialState) as unknown as WorkflowState;
  return {
    read: () => structuredClone(state),
    transact: (_actor, _kind, _payload, mutate) => {
      const draft = structuredClone(state);
      mutate(draft);
      state = draft;
      return state;
    },
  };
}

describe("Script-Backed Diagnostics: Formatting, Pulse & Invariants", () => {
  describe("1. Badge Formatting Across All Statuses", () => {
    test("generateReceiptBadge formats passed, failed, warning, and skipped badges", () => {
      const rPassed: CliDiagnosticReceipt = {
        inspector: "test",
        status: "passed",
        timestamp: "now",
        durationMs: 5,
        summary: "ok",
        receiptHash: "00",
        badge: "",
      };
      expect(generateReceiptBadge(rPassed)).toBe("[RECEIPT: test PASS]");

      const rFailed = { ...rPassed, status: "failed" as const };
      expect(generateReceiptBadge(rFailed)).toBe("[RECEIPT: test FAIL]");

      const rWarn = { ...rPassed, status: "warning" as const };
      expect(generateReceiptBadge(rWarn)).toBe("[RECEIPT: test WARN]");

      const rSkip = { ...rPassed, status: "skipped" as const };
      expect(generateReceiptBadge(rSkip)).toBe("[RECEIPT: test SKIP]");
    });

    test("generateReceiptSummaryBadge handles empty receipts", () => {
      expect(generateReceiptSummaryBadge([])).toBe("[CLI-RECEIPTS: none]");
    });

    test("generateAsciiDagBadges handles raw tasks array and empty input", () => {
      const tasks = [
        { id: "t1", status: "ready", priority: 1 },
        { id: "t2", status: "running", assignedAgent: "worker-1" },
      ];
      const badges = generateAsciiDagBadges(tasks);
      expect(badges.length).toBe(2);

      expect(generateAsciiDagBadges(null)).toEqual([]);
      expect(generateAsciiDagBadges({})).toEqual([]);
    });
  });

  describe("2. ASCII DAG Badge & Forensics Generators", () => {
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

  describe("3. Scheduler Pulse Integration & Lifecycle Telemetry", () => {
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

  describe("4. CLI Command Mind Pulse Diagnostics Embedding", () => {
    test("formatMindPulseActiveBrief embeds CLI Diagnostics Receipts and ASCII DAG badges", () => {
      const brief = formatMindPulseActiveBrief({
        pulseId: "pulse-1",
        runRoot: ".olt/capsules/test-run",
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
        runRoot: ".olt/capsules/test-run-2",
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

  describe("5. Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    test("verifies touched scheduler source files contain zero any and zero suppressions", () => {
      const filesToCheck = [
        "olt/scripts/src/engine/scheduler/diagnostics/index.ts",
        "olt/scripts/src/engine/scheduler/feedback/pulse-core.ts",
        "olt/scripts/src/engine/scheduler/topology/metrics.ts",
        "olt/scripts/src/engine/scheduler/index.ts",
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
