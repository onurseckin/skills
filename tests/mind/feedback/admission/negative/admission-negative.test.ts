import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import {
  admitFeedbackToQueue,
  appendFeedbackItem,
} from "../../../../../olt/scripts/src/mind/feedback/queue/ops.ts";
import { admitAndDispatchFeedbackAtomically } from "../../../../../olt/scripts/src/mind/feedback/queue/metrics.ts";
import { readFeedbackQueue } from "../../../../../olt/scripts/src/mind/feedback/queue/ingest.ts";
import { withFeedbackQueueTransaction } from "../../../../../olt/scripts/src/mind/feedback/queue/admission.ts";
import type { FeedbackItem } from "../../../../../olt/scripts/src/mind/feedback/queue/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Feedback Admission Negative Paths Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const testDir = "/virtual/mind/feedback/admission";
  const queuePath = `${testDir}/negative.jsonl`;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(testDir, { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  function makeItem(id: string, overrides: Partial<FeedbackItem> = {}): FeedbackItem {
    return {
      id,
      timestamp: "2026-09-01T10:00:00.000Z",
      priority: "NORMAL",
      category: "GENERAL",
      status: "PENDING",
      title: `Item ${id}`,
      content: `Content for ${id}`,
      ...overrides,
    };
  }

  describe("Non-Existent ID Rejection (INVALID_STATE)", () => {
    it("throws INVALID_STATE when attempting to admit non-existent string ID", () => {
      expect(() => admitFeedbackToQueue("non-existent-fb", queuePath)).toThrow(HarnessError);
      try {
        admitFeedbackToQueue("non-existent-fb", queuePath);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        expect((err as HarnessError).code).toBe("INVALID_STATE");
        expect((err as Error).message).toContain("not found in queue");
      }
    });

    it("throws INVALID_STATE when attempting atomic dispatch on missing feedback ID", () => {
      expect(() =>
        admitAndDispatchFeedbackAtomically(
          "fb-missing-atomic",
          () => ({ taskId: "task-valid-01" }),
          queuePath,
        ),
      ).toThrow(HarnessError);

      try {
        admitAndDispatchFeedbackAtomically(
          "fb-missing-atomic",
          () => ({ taskId: "task-valid-01" }),
          queuePath,
        );
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        expect((err as HarnessError).code).toBe("INVALID_STATE");
      }
    });
  });

  describe("Dispatcher Integrity Failures (INTEGRITY)", () => {
    it("throws INTEGRITY error when dispatcher returns an empty taskId", () => {
      appendFeedbackItem(makeItem("fb-empty-task"), queuePath);

      expect(() =>
        admitAndDispatchFeedbackAtomically("fb-empty-task", () => ({ taskId: "" }), queuePath),
      ).toThrow(HarnessError);

      try {
        admitAndDispatchFeedbackAtomically("fb-empty-task", () => ({ taskId: "" }), queuePath);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        expect((err as HarnessError).code).toBe("INTEGRITY");
        expect((err as Error).message).toContain("did not return a valid taskId");
      }
    });

    it("throws INTEGRITY error when dispatcher returns whitespace-only taskId", () => {
      appendFeedbackItem(makeItem("fb-whitespace-task"), queuePath);

      expect(() =>
        admitAndDispatchFeedbackAtomically(
          "fb-whitespace-task",
          () => ({ taskId: "    \t  " }),
          queuePath,
        ),
      ).toThrow(HarnessError);
    });
  });

  describe("Transaction Rollback & Invariant Preservation", () => {
    it("preserves queue contents unmutated when an admission transaction aborts", () => {
      appendFeedbackItem(makeItem("fb-safe-1"), queuePath);
      appendFeedbackItem(makeItem("fb-safe-2"), queuePath);

      // Attempt transaction that throws an error midway
      expect(() =>
        withFeedbackQueueTransaction(queuePath, () => {
          throw new HarnessError("INVALID_STATE", "Simulated mid-admission transaction abort");
        }),
      ).toThrow(HarnessError);

      const items = readFeedbackQueue(queuePath);
      expect(items.length).toBe(2);
      expect(items.map((i) => i.id)).toEqual(["fb-safe-1", "fb-safe-2"]);
      expect(items.every((i) => i.status === "PENDING")).toBe(true);
    });
  });
});
