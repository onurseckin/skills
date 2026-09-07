import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  isOwnEnoent,
  parseFeedbackQueue,
  readFeedbackQueue,
  readFeedbackQueueFile,
  readFeedbackQueueStrict,
  strictFeedbackItem,
} from "../../../olt/scripts/src/mind/feedback/queue/ingest.ts";
import {
  appendFeedbackItem,
  appendFeedbackItemsDedupedByTitle,
  ingestFeedbackItem,
} from "../../../olt/scripts/src/mind/feedback/queue/ops.ts";
import { writeFeedbackQueue } from "../../../olt/scripts/src/mind/feedback/queue/admission.ts";
import type { FeedbackItem } from "../../../olt/scripts/src/mind/feedback/queue/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Feedback Queue Ingest Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const queuePath = "/virtual/mind/feedback/queue.jsonl";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync("/virtual/mind/feedback", { recursive: true });
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
      title: `Title for ${id}`,
      content: `Content for ${id}`,
      ...overrides,
    };
  }

  describe("strictFeedbackItem Validation & Boundary Guards", () => {
    it("parses valid feedback record into normalized FeedbackItem", () => {
      const valid = {
        id: "fb-001",
        timestamp: "2026-09-01T12:00:00.000Z",
        priority: "CRITICAL_USER_FEEDBACK",
        status: "PENDING",
        category: "ENGINE",
        title: "Kernel freeze fix",
        content: "Address worker deadlock",
        candidate_id: "cand-123",
        test_path: "tests/kernel.test.ts",
        commit_sha: "abcdef1",
        metadata: { subsystem: "core" },
      };

      const item = strictFeedbackItem(valid, 1);
      expect(item.id).toBe("fb-001");
      expect(item.priority).toBe("CRITICAL_USER_FEEDBACK");
      expect(item.category).toBe("ENGINE");
      expect(item.candidate_id).toBe("cand-123");
    });

    it("rejects non-object and array records with INTEGRITY error", () => {
      expect(() => strictFeedbackItem(null, 1)).toThrow(HarnessError);
      expect(() => strictFeedbackItem("invalid json string", 2)).toThrow(HarnessError);
      expect(() => strictFeedbackItem([1, 2, 3], 3)).toThrow(HarnessError);
    });

    it("rejects invalid timestamp string formats with INTEGRITY error", () => {
      const badTimestamp = {
        id: "fb-bad-time",
        timestamp: "not-a-valid-date",
        priority: "NORMAL",
        status: "PENDING",
        category: "GENERAL",
        title: "Bad time",
        content: "Desc",
      };
      expect(() => strictFeedbackItem(badTimestamp, 4)).toThrow(HarnessError);
    });

    it("rejects non-string optional attributes with INTEGRITY error", () => {
      const badCandidateId = {
        id: "fb-bad-cand",
        timestamp: "2026-09-01T10:00:00.000Z",
        priority: "NORMAL",
        status: "PENDING",
        category: "GENERAL",
        title: "Candidate type check",
        content: "Desc",
        candidate_id: 12345,
      };
      expect(() => strictFeedbackItem(badCandidateId, 5)).toThrow(HarnessError);

      const badTestPath = {
        id: "fb-bad-path",
        timestamp: "2026-09-01T10:00:00.000Z",
        priority: "NORMAL",
        status: "PENDING",
        category: "GENERAL",
        title: "Test path type check",
        content: "Desc",
        test_path: true,
      };
      expect(() => strictFeedbackItem(badTestPath, 6)).toThrow(HarnessError);
    });

    it("rejects non-object metadata or array metadata with INTEGRITY error", () => {
      const badMetadataPrimitive = {
        id: "fb-meta-prim",
        timestamp: "2026-09-01T10:00:00.000Z",
        priority: "NORMAL",
        status: "PENDING",
        category: "GENERAL",
        title: "Meta check",
        content: "Desc",
        metadata: "string-metadata",
      };
      expect(() => strictFeedbackItem(badMetadataPrimitive, 7)).toThrow(HarnessError);

      const badMetadataArray = {
        id: "fb-meta-arr",
        timestamp: "2026-09-01T10:00:00.000Z",
        priority: "NORMAL",
        status: "PENDING",
        category: "GENERAL",
        title: "Meta check",
        content: "Desc",
        metadata: ["tag1", "tag2"],
      };
      expect(() => strictFeedbackItem(badMetadataArray, 8)).toThrow(HarnessError);
    });

    it("rejects unparseable processed_at timestamp with INTEGRITY error", () => {
      const badProcessedAt = {
        id: "fb-bad-proc",
        timestamp: "2026-09-01T10:00:00.000Z",
        priority: "NORMAL",
        status: "PROCESSED",
        category: "GENERAL",
        title: "Processed check",
        content: "Desc",
        processed_at: "unparseable-date",
      };
      expect(() => strictFeedbackItem(badProcessedAt, 9)).toThrow(HarnessError);
    });
  });

  describe("File Reading & Parsing Resilience", () => {
    it("returns empty string when reading non-existent file (ENOENT)", () => {
      const missingPath = "/virtual/mind/feedback/missing.jsonl";
      const content = readFeedbackQueueFile(missingPath);
      expect(content).toBe("");
    });

    it("detects own ENOENT error correctly", () => {
      expect(isOwnEnoent(null)).toBe(false);
      expect(isOwnEnoent("string")).toBe(false);
      const enoentErr = new Error("File not found");
      Object.defineProperty(enoentErr, "code", { value: "ENOENT" });
      expect(isOwnEnoent(enoentErr)).toBe(true);
    });

    it("ignores blank and whitespace-only lines without throwing", () => {
      const raw = `
        {"id":"fb-1","timestamp":"2026-09-01T10:00:00.000Z","priority":"NORMAL","status":"PENDING","category":"GENERAL","title":"Item 1","content":"C1"}
        
        \t  
        {"id":"fb-2","timestamp":"2026-09-01T10:01:00.000Z","priority":"HIGH_ARCHITECTURAL_FEATURE","status":"PENDING","category":"ARCHITECTURE","title":"Item 2","content":"C2"}
      `;
      const parsed = parseFeedbackQueue(raw);
      expect(parsed.length).toBe(2);
      expect(parsed[0]?.id).toBe("fb-2");
      expect(parsed[1]?.id).toBe("fb-1");
    });

    it("throws INTEGRITY error on duplicate id within JSONL file with line number", () => {
      const raw = [
        JSON.stringify(makeItem("fb-dup")),
        JSON.stringify(makeItem("fb-other")),
        JSON.stringify(makeItem("fb-dup")),
      ].join("\n");

      expect(() => parseFeedbackQueue(raw)).toThrow(HarnessError);
      try {
        parseFeedbackQueue(raw);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        expect((err as HarnessError).code).toBe("INTEGRITY");
        expect((err as Error).message).toContain("duplicates id 'fb-dup'");
        expect((err as Error).message).toContain("line 3");
      }
    });

    it("reads and parses strict feedback queue from virtual memory", () => {
      writeFeedbackQueue([makeItem("fb-10"), makeItem("fb-20")], queuePath);
      const items = readFeedbackQueueStrict(queuePath);
      expect(items.length).toBe(2);
      expect(items.map((i) => i.id)).toEqual(["fb-10", "fb-20"]);
    });
  });

  describe("Deduplication & Atomic Ingestion Operations", () => {
    it("ingestFeedbackItem auto-generates ID and sets default status and priority", () => {
      const ingested = ingestFeedbackItem(
        {
          title: "Auto-ID feedback",
          content: "Auto-assigned description",
        },
        queuePath,
      );

      expect(ingested.id).toStartWith("fb-");
      expect(ingested.status).toBe("PENDING");
      expect(ingested.priority).toBe("NORMAL");
      expect(ingested.category).toBe("GENERAL");

      const items = readFeedbackQueue(queuePath);
      expect(items.length).toBe(1);
      expect(items[0]?.id).toBe(ingested.id);
    });

    it("appendFeedbackItem rejects duplicate ID with INVALID_ARGUMENT error", () => {
      appendFeedbackItem(makeItem("fb-unique"), queuePath);
      expect(() => appendFeedbackItem(makeItem("fb-unique"), queuePath)).toThrow(HarnessError);
      try {
        appendFeedbackItem(makeItem("fb-unique"), queuePath);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        expect((err as HarnessError).code).toBe("INVALID_ARGUMENT");
      }
    });

    it("appendFeedbackItemsDedupedByTitle handles case-insensitivity and whitespace", () => {
      appendFeedbackItem(makeItem("fb-base", { title: "Refactor Memory Recycling" }), queuePath);

      const toAdd = [
        makeItem("fb-skip-1", { title: "  refactor memory recycling  " }),
        makeItem("fb-skip-2", { title: "REFACTOR MEMORY RECYCLING" }),
        makeItem("fb-new-1", { title: "Brand New Feature" }),
        makeItem("fb-skip-3", { title: "brand new feature" }),
      ];

      const appended = appendFeedbackItemsDedupedByTitle(toAdd, queuePath);
      expect(appended.length).toBe(1);
      expect(appended[0]?.id).toBe("fb-new-1");

      const all = readFeedbackQueue(queuePath);
      expect(all.length).toBe(2);
      expect(all.map((i) => i.id)).toEqual(["fb-base", "fb-new-1"]);
    });

    it("appendFeedbackItemsDedupedByTitle throws INTEGRITY if title is unique but ID exists", () => {
      appendFeedbackItem(makeItem("fb-collision", { title: "Existing title" }), queuePath);

      const colliding = [makeItem("fb-collision", { title: "Completely distinct new title" })];

      expect(() => appendFeedbackItemsDedupedByTitle(colliding, queuePath)).toThrow(HarnessError);
      try {
        appendFeedbackItemsDedupedByTitle(colliding, queuePath);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        expect((err as HarnessError).code).toBe("INTEGRITY");
      }
    });
  });
});
