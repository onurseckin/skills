import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  admitFeedbackToQueue,
  appendFeedbackItem,
  appendFeedbackItemsDedupedByTitle,
  clearFeedbackQueue,
  ingestFeedbackItem,
  sealFeedbackResolution,
  updateFeedbackItem,
  updateOrPruneFeedbackItems,
} from "../../../../olt/scripts/src/mind/feedback/queue/ops.ts";
import { readFeedbackQueue } from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import type {
  FeedbackItem,
  FeedbackResolutionProof,
} from "../../../../olt/scripts/src/mind/feedback/queue/types.ts";

describe("Feedback Queue Operations Suite", () => {
  let tempDir: string;
  let queuePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "fb-ops-test-"));
    queuePath = join(tempDir, "feedback-queue.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeItem(id: string, overrides: Partial<FeedbackItem> = {}): FeedbackItem {
    return {
      id,
      title: `Title ${id}`,
      content: `Content ${id}`,
      priority: "NORMAL",
      category: "GENERAL",
      status: "PENDING",
      ...overrides,
    };
  }

  it("appendFeedbackItem appends item and throws INVALID_ARGUMENT on duplicate id", () => {
    const item1 = makeItem("fb-1", { priority: "HIGH", timestamp: "2026-09-01T10:00:00.000Z" });
    const appended = appendFeedbackItem(item1, queuePath);
    expect(appended.id).toBe("fb-1");

    expect(() => appendFeedbackItem(makeItem("fb-1"), queuePath)).toThrow(HarnessError);

    const item2 = appendFeedbackItem(makeItem("fb-2"), queuePath);
    expect(item2.timestamp).toBeDefined();

    const items = readFeedbackQueue(queuePath);
    expect(items.length).toBe(2);
  });

  it("appendFeedbackItemsDedupedByTitle dedupes by title and throws INTEGRITY on duplicate id", () => {
    appendFeedbackItem(makeItem("fb-1", { title: "Existing title" }), queuePath);

    const result = appendFeedbackItemsDedupedByTitle(
      [
        makeItem("fb-2", { title: "  EXISTING TITLE  " }),
        makeItem("fb-3", { title: "New title 1" }),
        makeItem("fb-4", { title: "New title 1" }),
      ],
      queuePath,
    );

    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe("fb-3");

    expect(() =>
      appendFeedbackItemsDedupedByTitle(
        [makeItem("fb-1", { title: "Brand new title with existing ID" })],
        queuePath,
      ),
    ).toThrow(HarnessError);
  });

  it("clearFeedbackQueue and updateOrPruneFeedbackItems modify queue in transaction", () => {
    appendFeedbackItem(makeItem("fb-1"), queuePath);
    appendFeedbackItem(makeItem("fb-2", { priority: "CRITICAL_USER_FEEDBACK" }), queuePath);

    const pruned = updateOrPruneFeedbackItems<number>(
      (item) => (item.id === "fb-1" ? null : { ...item, priority: "CRITICAL_USER_FEEDBACK" }),
      queuePath,
      (items) => items.length,
    );
    expect(pruned).toBe(1);

    const rawUpdate = updateOrPruneFeedbackItems(
      (item) => ({ ...item, content: "Mutated" }),
      queuePath,
    );
    expect(Array.isArray(rawUpdate)).toBe(true);

    clearFeedbackQueue(queuePath);
    expect(readFeedbackQueue(queuePath)).toEqual([]);
  });

  it("ingestFeedbackItem generates id and defaults priority and category", () => {
    const item1 = ingestFeedbackItem({ title: "Auto ID Item", content: "Content body" }, queuePath);
    expect(item1.id).toMatch(/^fb-/);
    expect(item1.priority).toBe("NORMAL");
    expect(item1.category).toBe("GENERAL");
    expect(item1.status).toBe("PENDING");
    expect(item1.candidate_id).toBeNull();

    const item2 = ingestFeedbackItem(
      {
        id: "fb-custom-id",
        title: "Custom Item",
        content: "Content body 2",
        priority: "CRITICAL_USER_FEEDBACK",
        category: "CORE_ENGINE",
        candidate_id: "cand-123",
        metadata: { env: "test" },
      },
      queuePath,
    );
    expect(item2.id).toBe("fb-custom-id");
    expect(item2.priority).toBe("CRITICAL_USER_FEEDBACK");
    expect(item2.category).toBe("CORE_ENGINE");
    expect(item2.candidate_id).toBe("cand-123");
    expect(item2.metadata?.["env"]).toBe("test");
  });

  it("admitFeedbackToQueue admits by string ID and by object", () => {
    expect(() => admitFeedbackToQueue("non-existent-id", queuePath)).toThrow(HarnessError);

    appendFeedbackItem(makeItem("fb-admit-1"), queuePath);
    const admitted1 = admitFeedbackToQueue("fb-admit-1", queuePath);
    expect(admitted1.status).toBe("ADMITTED");
    expect(admitted1.processed_at).toBeDefined();

    const reAdmitted = admitFeedbackToQueue("fb-admit-1", queuePath);
    expect(reAdmitted.processed_at).toBe(admitted1.processed_at);

    const admitted2 = admitFeedbackToQueue(
      makeItem("fb-admit-1", { title: "Updated Title", status: "ADMITTED" }),
      queuePath,
    );
    expect(admitted2.title).toBe("Updated Title");
    expect(admitted2.status).toBe("ADMITTED");

    const admitted3 = admitFeedbackToQueue(
      makeItem("fb-admit-new", { title: "Brand New", status: "ADMITTED" }),
      queuePath,
    );
    expect(admitted3.id).toBe("fb-admit-new");
    expect(admitted3.status).toBe("ADMITTED");
  });

  it("updateFeedbackItem updates existing item and preserves id and timestamp", () => {
    expect(() => updateFeedbackItem("non-existent", { title: "X" }, queuePath)).toThrow(
      HarnessError,
    );

    appendFeedbackItem(makeItem("fb-up", { timestamp: "2026-09-01T00:00:00.000Z" }), queuePath);
    const updated = updateFeedbackItem(
      "fb-up",
      { title: "Updated", priority: "HIGH_ARCHITECTURAL_FEATURE" },
      queuePath,
    );
    expect(updated.id).toBe("fb-up");
    expect(updated.title).toBe("Updated");
    expect(updated.priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
    expect(updated.timestamp).toBe("2026-09-01T00:00:00.000Z");
  });

  it("sealFeedbackResolution seals by ID or candidate ID and attaches proof details", () => {
    appendFeedbackItem(
      makeItem("fb-seal-1", {
        candidate_id: "cand-seal-1",
        resolution_note: "Existing note",
        test_path: "tests/old.test.ts",
        assertions: 2,
      }),
      queuePath,
    );

    const proof: FeedbackResolutionProof = {
      task_id: "task-99",
      resolved_at: "2026-09-01T12:00:00.000Z",
      proof_summary: "Fixed bug completely",
      test_path: "tests/new.test.ts",
      assertions: 5,
      runtime_ms: 120,
      commit_sha: "abc1234",
    };

    const sealed = sealFeedbackResolution("cand-seal-1", proof, { customPath: queuePath });
    expect(sealed.status).toBe("COMPLETED");
    expect(sealed.processed_at).toBe("2026-09-01T12:00:00.000Z");
    expect(sealed.resolution_note).toBe("Fixed bug completely");
    expect(sealed.test_path).toBe("tests/new.test.ts");
    expect(sealed.assertions).toBe(5);
    expect(sealed.runtime_ms).toBe(120);
    expect(sealed.commit_sha).toBe("abc1234");
    expect(sealed.resolution?.task_id).toBe("task-99");

    expect(() =>
      sealFeedbackResolution("non-existent-candidate", proof, { customPath: queuePath }),
    ).toThrow(HarnessError);

    appendFeedbackItem(makeItem("fb-seal-2"), queuePath);
    const proofMinimal: FeedbackResolutionProof = {
      task_id: "task-100",
      resolved_at: "2026-09-01T13:00:00.000Z",
      test_assertion: "asserts true",
    };
    const sealed2 = sealFeedbackResolution("fb-seal-2", proofMinimal, { customPath: queuePath });
    expect(sealed2.resolution_note).toBe("asserts true");

    appendFeedbackItem(makeItem("fb-seal-3"), queuePath);
    const proofEmptyNote: FeedbackResolutionProof = {
      task_id: "task-101",
      resolved_at: "2026-09-01T14:00:00.000Z",
    };
    const sealed3 = sealFeedbackResolution("fb-seal-3", proofEmptyNote, { customPath: queuePath });
    expect(sealed3.resolution_note).toBe("Empirically resolved by task-101");
  });
});
