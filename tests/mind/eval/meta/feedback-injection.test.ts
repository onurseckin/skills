import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  analyzeRunForensics,
  calculateEfficiencyScore,
  formatForensicsReport,
  injectRemediationToFeedbackQueue,
  isPollTool,
  isReadTool,
  isWriteTool,
  renderForensicsAsciiTable,
  synthesizeRemediationPlan,
  ROOT_CAUSE_CATEGORIES,
  FORENSICS_SEVERITIES,
  type AnalyzeRunForensicsOptions,
  type FeedbackInjectionOptions,
  type ForensicsAnalysisResult,
  type ForensicsIncident,
  type ForensicsMetrics,
  type ForensicsSeverity,
  type PlanInjectionProposal,
  type RootCauseCategory,
} from "../../../../olt/scripts/src/mind/auditing/meta/index.ts";
import {
  formatMetaAuditReport,
  metaAuditCommand,
  renderEfficiencyMetricsTable,
  renderForensicsIncidentTable,
} from "../../../../olt/scripts/src/cli/commands/meta-audit.ts";
import type { AgentGrantRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { Manifest, RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  __setFeedbackQueuePersistenceTestHook,
  readFeedbackQueue,
} from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";


import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

describe("Meta Auditor - Feedback Queue Remediation Injection", () => {
  describe("Feedback Queue Remediation Injection", () => {
    it("returns zero counts when empty proposals/incidents provided", () => {
      const result = injectRemediationToFeedbackQueue([]);
      expect(result.injectedCount).toBe(0);
      expect(result.injected_count).toBe(0);
      expect(result.itemIds).toEqual([]);
      expect(result.injected_items).toEqual([]);
    });

    it("injects synthesized proposals into feedback queue and skips duplicate titles", () => {
      const scratchDir = mkdtempSync(join(tmpdir(), "meta-scratch-")); mkdirSync(scratchDir, { recursive: true });
      const queuePath = join(scratchDir, "FEEDBACK_QUEUE.jsonl");

      const incident: ForensicsIncident = {
        id: "inc-co-test",
        category: "CONTEXT_OVERFLOW",
        severity: "HIGH",
        title: "Test Context Overflow",
        description: "Agent token budget exceeded",
        observation: "Agent token budget exceeded",
        remediation: "Apply chunking",
        recommendation: "Apply chunking",
        agentId: "agent-1",
      };

      const injectionOptions: FeedbackInjectionOptions = {
        queue_path: queuePath,
      };

      // 1. First injection: should inject 1 proposal
      const res1 = injectRemediationToFeedbackQueue([incident], injectionOptions);
      expect(res1.injectedCount).toBe(1);
      expect(res1.itemIds).toHaveLength(1);
      expect(existsSync(queuePath)).toBe(true);

      const itemsInQueue = readFeedbackQueue(queuePath);
      expect(itemsInQueue).toHaveLength(1);
      expect(itemsInQueue[0]?.title).toContain("Stream Chunking");
      expect(itemsInQueue[0]?.status).toBe("PENDING");
      expect(itemsInQueue[0]?.category).toBe("CORE_ENGINE");

      // 2. Second injection with same incident: should detect duplicate title and skip
      const res2 = injectRemediationToFeedbackQueue([incident], injectionOptions);
      expect(res2.injectedCount).toBe(0);
      expect(res2.itemIds).toHaveLength(0);

      const itemsAfterSecond = readFeedbackQueue(queuePath);
      expect(itemsAfterSecond).toHaveLength(1);
    });

    it("supports passing string run root or customRoot options", () => {
      const scratchDir = mkdtempSync(join(tmpdir(), "meta-scratch-")); mkdirSync(scratchDir, { recursive: true });
      const subQueueDir = join(scratchDir, ".olt");
      mkdirSync(subQueueDir, { recursive: true });

      const incident: ForensicsIncident = {
        id: "inc-tb-test",
        category: "TOKEN_BURNING",
        severity: "HIGH",
        title: "Token Burn Test",
        description: "Test",
        observation: "Test",
        remediation: "Test",
        recommendation: "Test",
      };

      const result = injectRemediationToFeedbackQueue([incident], scratchDir);
      expect(result.injectedCount).toBe(1);
      expect(result.queue_path).toBeDefined();
    });

    it("does not fallback-count a remediation injection when persistence fails", () => {
      const scratchDir = mkdtempSync(join(tmpdir(), "meta-scratch-")); mkdirSync(scratchDir, { recursive: true });
      const queuePath = join(scratchDir, "FEEDBACK_QUEUE.jsonl");
      const incident: ForensicsIncident = {
        id: "inc-persist-failure",
        category: "TOKEN_BURNING",
        severity: "HIGH",
        title: "Persistence Failure",
        description: "Test",
        observation: "Test",
        remediation: "Test",
        recommendation: "Test",
      };
      __setFeedbackQueuePersistenceTestHook((stage) => {
        if (stage === "before_rename") throw new Error("forced persistence failure");
      });
      try {
        expect(() =>
          injectRemediationToFeedbackQueue([incident], { queue_path: queuePath }),
        ).toThrow("forced persistence failure");
        expect(existsSync(queuePath)).toBe(false);
      } finally {
        __setFeedbackQueuePersistenceTestHook(undefined);
      }
    });

    it("keeps one record when synchronized meta-audit injections share a title", async () => {
      const scratchDir = mkdtempSync(join(tmpdir(), "meta-scratch-")); mkdirSync(scratchDir, { recursive: true });
      const queuePath = join(scratchDir, "FEEDBACK_QUEUE.jsonl");
      const latch = join(scratchDir, "inject-go");
      mkdirSync(scratchDir, { recursive: true });
      const modulePath = join(process.cwd(), "olt/scripts/src/mind/auditing/meta/index.ts");
      const child = () =>
        Bun.spawn({
          cmd: [
            "bun",
            "-e",
            `import { injectRemediationToFeedbackQueue } from ${JSON.stringify(modulePath)}; import { existsSync } from "node:fs"; const [queue, latch] = process.argv.slice(-2); while (!existsSync(latch)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1); injectRemediationToFeedbackQueue([{ id: "prop-shared", title: "Shared dedupe title", content: "content", priority: "NORMAL", category: "GENERAL", rootCause: "TOKEN_BURNING", remediationDirective: "directive" }], { queue_path: queue });`,
            queuePath,
            latch,
          ],
          stdout: "pipe",
          stderr: "pipe",
        });
      const first = child();
      const second = child();
      writeFileSync(latch, "go", "utf8");
      expect(await first.exited).toBe(0);
      expect(await second.exited).toBe(0);
      expect(readFeedbackQueue(queuePath)).toHaveLength(1);
    });
  });

});
