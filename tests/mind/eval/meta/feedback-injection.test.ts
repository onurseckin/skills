import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/index.ts";
import {
  injectRemediationToFeedbackQueue,
  type FeedbackInjectionOptions,
  type ForensicsIncident,
} from "../../../../olt/scripts/src/mind/auditing/meta/index.ts";
import {
  __setFeedbackQueuePersistenceTestHook,
  readFeedbackQueue,
} from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";

describe("Meta Auditor - Feedback Queue Remediation Injection (in-memory virtual)", () => {
  let scratchDir: string;
  let queuePath: string;

  beforeEach(() => {
    setupVirtualMindFS();
    scratchDir = scratchRoot("feedback-injection", "test");
    queuePath = join(scratchDir, "FEEDBACK_QUEUE.jsonl");
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  it("returns zero counts when empty proposals/incidents provided", () => {
    const result = injectRemediationToFeedbackQueue([]);
    expect(result.injectedCount).toBe(0);
    expect(result.injected_count).toBe(0);
    expect(result.itemIds).toEqual([]);
    expect(result.injected_items).toEqual([]);
  });

  it("injects synthesized proposals into feedback queue and skips duplicate titles", () => {
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
    expect(fs.existsSync(queuePath)).toBe(true);

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
    const queuePathFail = join(scratchDir, "FEEDBACK_QUEUE_FAIL.jsonl");
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
        injectRemediationToFeedbackQueue([incident], { queue_path: queuePathFail }),
      ).toThrow("forced persistence failure");
      expect(fs.existsSync(queuePathFail)).toBe(false);
    } finally {
      __setFeedbackQueuePersistenceTestHook(undefined);
    }
  });

  it("keeps one record when synchronized meta-audit injections share a title", () => {
    const queuePathDedupe = join(scratchDir, "FEEDBACK_QUEUE_DEDUPE.jsonl");
    const proposal = {
      id: "prop-shared",
      title: "Shared dedupe title",
      content: "content",
      priority: "NORMAL" as const,
      category: "GENERAL" as const,
      rootCause: "TOKEN_BURNING" as const,
      remediationDirective: "directive",
    };

    const first = injectRemediationToFeedbackQueue([proposal], { queue_path: queuePathDedupe });
    const second = injectRemediationToFeedbackQueue([proposal], { queue_path: queuePathDedupe });

    expect(first.injectedCount).toBe(1);
    expect(second.injectedCount).toBe(0);
    expect(readFeedbackQueue(queuePathDedupe)).toHaveLength(1);
  });
});
