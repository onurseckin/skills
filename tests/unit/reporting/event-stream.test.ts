import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  deliverEventsToWebhook,
  formatEventsToNdjsonStream,
  formatEventToNdjson,
  isHarnessEvent,
  parseNdjsonStream,
  readCapsuleEvents,
  renderAsciiEventStreamTable,
  resolveCapsulePath,
  type FetchLike,
} from "../../../olt/scripts/src/reporting/event-stream.ts";
import { streamEventsCommand } from "../../../olt/scripts/src/cli/commands/stream-events.ts";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/capsule.ts";

function createMockCapsule(events: readonly Record<string, unknown>[]): {
  dir: string;
  cleanup: () => void;
} {
  const dir = join(
    process.cwd(),
    `.tmp_test_capsule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });

  const manifest = {
    schema: "harness.manifest",
    version: 1,
    run_id: "test-run-123",
    capsule_id: "cap-abc-456",
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const lines = events.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(join(dir, "events.jsonl"), lines + (lines ? "\n" : ""), "utf8");

  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    },
  };
}

describe("reporting/event-stream", () => {
  const sampleEvents: HarnessEvent[] = [
    {
      schema: "harness.event",
      version: 1,
      run_id: "test-run-123",
      capsule_id: "cap-abc-456",
      sequence: 1,
      revision: 1,
      timestamp: "2026-08-22T05:00:00.000Z",
      actor: "coordinator",
      kind: "plan-compiled",
      payload: { tasks_count: 3 },
      previous_hash: null,
      projection: null,
      hash: "a".repeat(64),
    },
    {
      schema: "harness.event",
      version: 1,
      run_id: "test-run-123",
      capsule_id: "cap-abc-456",
      sequence: 2,
      revision: 2,
      timestamp: "2026-08-22T05:01:00.000Z",
      actor: "impl-1",
      kind: "task-claimed",
      payload: { task_id: "task-1", role: "implementer" },
      previous_hash: "hash1",
      projection: null,
      hash: "b".repeat(64),
    },
    {
      schema: "harness.event",
      version: 1,
      run_id: "test-run-123",
      capsule_id: "cap-abc-456",
      sequence: 3,
      revision: 3,
      timestamp: "2026-08-22T05:02:00.000Z",
      actor: "impl-2",
      kind: "task-claimed",
      payload: { task_id: "task-2", role: "implementer" },
      previous_hash: "hash2",
      projection: null,
      hash: "c".repeat(64),
    },
    {
      schema: "harness.event",
      version: 1,
      run_id: "test-run-123",
      capsule_id: "cap-abc-456",
      sequence: 4,
      revision: 4,
      timestamp: "2026-08-22T05:03:00.000Z",
      actor: "impl-1",
      kind: "task-submitted",
      payload: { task_id: "task-1", status: "submitted" },
      previous_hash: "hash3",
      projection: null,
      hash: "d".repeat(64),
    },
  ];

  describe("readCapsuleEvents", () => {
    it("reads all events from a valid capsule directory", () => {
      const mock = createMockCapsule(sampleEvents);
      try {
        const result = readCapsuleEvents(mock.dir);
        expect(result.runId).toBe("test-run-123");
        expect(result.capsuleId).toBe("cap-abc-456");
        expect(result.totalAvailable).toBe(4);
        expect(result.matchingEvents.length).toBe(4);
        expect(result.latestSeq).toBe(4);
        expect(result.hasMore).toBe(false);
      } finally {
        mock.cleanup();
      }
    });

    it("filters events by fromSeq and toSeq cursor", () => {
      const mock = createMockCapsule(sampleEvents);
      try {
        const result = readCapsuleEvents(mock.dir, { fromSeq: 2, toSeq: 3 });
        expect(result.matchingEvents.length).toBe(2);
        expect(result.matchingEvents[0]?.sequence).toBe(2);
        expect(result.matchingEvents[1]?.sequence).toBe(3);
      } finally {
        mock.cleanup();
      }
    });

    it("filters events by type and actor", () => {
      const mock = createMockCapsule(sampleEvents);
      try {
        const byType = readCapsuleEvents(mock.dir, { filterType: "task-claimed" });
        expect(byType.matchingEvents.length).toBe(2);

        const byActor = readCapsuleEvents(mock.dir, { filterActor: "impl-1" });
        expect(byActor.matchingEvents.length).toBe(2);
        expect(byActor.matchingEvents[0]?.kind).toBe("task-claimed");
        expect(byActor.matchingEvents[1]?.kind).toBe("task-submitted");

        const byBoth = readCapsuleEvents(mock.dir, {
          filterType: "task-claimed",
          filterActor: "impl-1",
        });
        expect(byBoth.matchingEvents.length).toBe(1);
        expect(byBoth.matchingEvents[0]?.sequence).toBe(2);
      } finally {
        mock.cleanup();
      }
    });

    it("handles maxEvents limit with hasMore indicator", () => {
      const mock = createMockCapsule(sampleEvents);
      try {
        const result = readCapsuleEvents(mock.dir, { maxEvents: 2 });
        expect(result.matchingEvents.length).toBe(2);
        expect(result.hasMore).toBe(true);
        expect(result.totalAvailable).toBe(4);
      } finally {
        mock.cleanup();
      }
    });

    it("throws INVALID_ARGUMENT when run directory does not exist", () => {
      expect(() => readCapsuleEvents("/non/existent/path")).toThrow(
        "capsule run directory not found",
      );
    });
  });

  describe("NDJSON formatting and parsing", () => {
    it("formats individual events and stream to NDJSON", () => {
      const single = formatEventToNdjson(sampleEvents[0]!);
      expect(single.endsWith("\n")).toBe(true);
      expect(JSON.parse(single.trim()).sequence).toBe(1);

      const stream = formatEventsToNdjsonStream(sampleEvents);
      const lines = stream.trim().split("\n");
      expect(lines.length).toBe(4);
    });

    it("parses NDJSON stream back to structured events", () => {
      const stream = formatEventsToNdjsonStream(sampleEvents);
      const parsed = parseNdjsonStream(stream);
      expect(parsed.length).toBe(4);
      expect(parsed[0]?.sequence).toBe(1);
      expect(parsed[1]?.actor).toBe("impl-1");
      expect(parsed[3]?.kind).toBe("task-submitted");
    });

    it("handles empty and malformed whitespace in NDJSON gracefully", () => {
      const raw =
        "\n\n" +
        JSON.stringify(sampleEvents[0]) +
        "\n  \n" +
        JSON.stringify(sampleEvents[1]) +
        "\n";
      const parsed = parseNdjsonStream(raw);
      expect(parsed.length).toBe(2);
    });
  });

  describe("deliverEventsToWebhook", () => {
    it("delivers events successfully with mock fetch and parses receipt ID", async () => {
      const mockFetch: FetchLike = async () => {
        const headers = new Headers();
        headers.set("x-receipt-id", "rcpt-test-12345");
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          statusText: "OK",
          headers,
        });
      };

      const res = await deliverEventsToWebhook(sampleEvents, "https://example.com/webhook", {
        customFetch: mockFetch,
      });

      expect(res.success).toBe(true);
      expect(res.deliveredCount).toBe(4);
      expect(res.statusCode).toBe(200);
      expect(res.receiptId).toBe("rcpt-test-12345");
      expect(res.attempts).toBe(1);
    });

    it("retries on 500 error and succeeds on subsequent attempt", async () => {
      let callCount = 0;
      const mockFetch: FetchLike = async () => {
        callCount++;
        if (callCount === 1) {
          return new Response("Internal Server Error", { status: 500, statusText: "Error" });
        }
        return new Response(JSON.stringify({ receipt_id: "rcpt-retry-ok" }), {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
        });
      };

      const res = await deliverEventsToWebhook(sampleEvents, "https://example.com/webhook", {
        customFetch: mockFetch,
        retries: 2,
        backoffBaseMs: 1,
      });

      expect(res.success).toBe(true);
      expect(res.attempts).toBe(2);
      expect(res.receiptId).toBe("rcpt-retry-ok");
    });

    it("does not retry 400 client errors", async () => {
      let callCount = 0;
      const mockFetch: FetchLike = async () => {
        callCount++;
        return new Response("Bad Request", { status: 400, statusText: "Bad Request" });
      };

      const res = await deliverEventsToWebhook(sampleEvents, "https://example.com/webhook", {
        customFetch: mockFetch,
        retries: 3,
      });

      expect(res.success).toBe(false);
      expect(res.attempts).toBe(1);
      expect(res.statusCode).toBe(400);
    });

    it("handles empty event batches without network call", async () => {
      const res = await deliverEventsToWebhook([], "https://example.com/webhook");
      expect(res.success).toBe(true);
      expect(res.deliveredCount).toBe(0);
      expect(res.attempts).toBe(0);
    });

    it("chunks events into multiple batches when batchSize is specified", async () => {
      const calls: { url: string | URL | Request; body: unknown }[] = [];
      const mockFetch: FetchLike = async (url, init) => {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
        calls.push({ url, body });
        return new Response(JSON.stringify({ receipt_id: `rcpt-batch-${calls.length}` }), {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
        });
      };

      const res = await deliverEventsToWebhook(sampleEvents, "https://example.com/webhook", {
        customFetch: mockFetch,
        batchSize: 2,
      });

      expect(res.success).toBe(true);
      expect(res.deliveredCount).toBe(4);
      expect(calls.length).toBe(2);
      expect(res.receiptId).toBe("rcpt-batch-2");
      expect(res.attempts).toBe(2);

      const batch1 = calls[0]?.body as { events: unknown[]; count: number };
      const batch2 = calls[1]?.body as { events: unknown[]; count: number };
      expect(batch1.count).toBe(2);
      expect(batch2.count).toBe(2);
    });

    it("handles partial failure during multi-batch delivery", async () => {
      let callCount = 0;
      const mockFetch: FetchLike = async () => {
        callCount++;
        if (callCount === 1) {
          return new Response(JSON.stringify({ receipt_id: "rcpt-1" }), {
            status: 200,
            statusText: "OK",
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
      };

      const res = await deliverEventsToWebhook(sampleEvents, "https://example.com/webhook", {
        customFetch: mockFetch,
        batchSize: 2,
        retries: 2,
      });

      expect(res.success).toBe(false);
      expect(res.deliveredCount).toBe(2);
      expect(res.statusCode).toBe(401);
      expect(res.error).toContain("HTTP 401");
    });

    it("retries on HTTP 429 rate limit responses", async () => {
      let callCount = 0;
      const mockFetch: FetchLike = async () => {
        callCount++;
        if (callCount === 1) {
          return new Response("Too Many Requests", {
            status: 429,
            statusText: "Too Many Requests",
          });
        }
        return new Response(JSON.stringify({ receipt_id: "rcpt-after-429" }), {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
        });
      };

      const res = await deliverEventsToWebhook(sampleEvents, "https://example.com/webhook", {
        customFetch: mockFetch,
        retries: 2,
        backoffBaseMs: 1,
      });

      expect(res.success).toBe(true);
      expect(res.attempts).toBe(2);
      expect(res.receiptId).toBe("rcpt-after-429");
    });

    it("forwards custom headers during delivery", async () => {
      let capturedHeaders: HeadersInit | undefined;
      const mockFetch: FetchLike = async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify({ receipt_id: "rcpt-hdr" }), {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
        });
      };

      await deliverEventsToWebhook(sampleEvents, "https://example.com/webhook", {
        customFetch: mockFetch,
        headers: { "X-Custom-Auth": "secret-token-123" },
      });

      expect(capturedHeaders).toBeDefined();
      const rec = capturedHeaders as Record<string, string>;
      expect(rec["X-Custom-Auth"]).toBe("secret-token-123");
    });
  });

  describe("renderAsciiEventStreamTable", () => {
    it("renders formatted ASCII table with headers and data", () => {
      const table = renderAsciiEventStreamTable(sampleEvents);
      expect(table).toContain("Seq");
      expect(table).toContain("Time (UTC)");
      expect(table).toContain("Actor");
      expect(table).toContain("Kind");
      expect(table).toContain("Summary");
      expect(table).toContain("coordinator");
      expect(table).toContain("task-claimed");
    });

    it("renders optional title header and truncates rows when maxLines is set", () => {
      const table = renderAsciiEventStreamTable(sampleEvents, {
        title: "Test Capsule Stream",
        maxLines: 2,
      });
      expect(table).toContain("=== Test Capsule Stream ===");
      expect(table).toContain("... [2 more events truncated]");
    });

    it("handles empty events list with placeholder message", () => {
      const table = renderAsciiEventStreamTable([]);
      expect(table).toContain("No events found");
    });
  });

  describe("isHarnessEvent and edge cases", () => {
    it("validates HarnessEvent structure accurately", () => {
      expect(isHarnessEvent(sampleEvents[0])).toBe(true);
      expect(isHarnessEvent(null)).toBe(false);
      expect(isHarnessEvent(undefined)).toBe(false);
      expect(isHarnessEvent("invalid")).toBe(false);
      expect(isHarnessEvent(123)).toBe(false);
      expect(isHarnessEvent([])).toBe(false);
      expect(isHarnessEvent({ schema: "harness.event" })).toBe(false);
    });

    it("reads events when passing direct events.jsonl file path", () => {
      const mock = createMockCapsule(sampleEvents);
      try {
        const directFile = join(mock.dir, "events.jsonl");
        const result = readCapsuleEvents(directFile);
        expect(result.matchingEvents.length).toBe(4);
      } finally {
        mock.cleanup();
      }
    });

    it("throws INTEGRITY error when events.jsonl has corrupt JSON line", () => {
      const mock = createMockCapsule([]);
      try {
        writeFileSync(join(mock.dir, "events.jsonl"), "invalid-json-content\n", "utf8");
        expect(() => readCapsuleEvents(mock.dir)).toThrow("failed to parse event at line 1");
      } finally {
        mock.cleanup();
      }
    });

    it("throws INVALID_ARGUMENT error when events.jsonl is missing in directory", () => {
      const dir = join(
        process.cwd(),
        `.tmp_test_empty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(dir, { recursive: true });
      try {
        expect(() => readCapsuleEvents(dir)).toThrow("events.jsonl not found");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("streamEventsCommand", () => {
    it("executes CLI command with markdown output", async () => {
      const mock = createMockCapsule(sampleEvents);
      try {
        const result = await streamEventsCommand({
          run: mock.dir,
          all: true,
        });

        expect(result.run_id).toBe("test-run-123");
        expect(result.total_events).toBe(4);
        expect(result.matched_events).toBe(4);
        expect(result.markdown).toContain("Event Stream: `test-run-123`");
      } finally {
        mock.cleanup();
      }
    });

    it("executes CLI command with NDJSON format flag", async () => {
      const mock = createMockCapsule(sampleEvents);
      try {
        const result = await streamEventsCommand({
          run: mock.dir,
          format: "ndjson",
          "from-seq": "2",
        });

        expect(result.ndjson).toBeDefined();
        expect(result.ndjson!.split("\n").filter(Boolean).length).toBe(3);
      } finally {
        mock.cleanup();
      }
    });

    it("executes CLI command with webhook delivery integration", async () => {
      const mock = createMockCapsule(sampleEvents);
      // Mock global fetch for this test
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ receipt_id: "rcpt-cli-123" }), {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      try {
        const result = await streamEventsCommand({
          run: mock.dir,
          "webhook-url": "https://dashboard.internal/api/events",
          json: true,
        });

        expect(result.webhook_delivery).toBeDefined();
        expect(result.webhook_delivery?.success).toBe(true);
        expect(result.webhook_delivery?.receiptId).toBe("rcpt-cli-123");
      } finally {
        globalThis.fetch = originalFetch;
        mock.cleanup();
      }
    });

    it("handles direct events.jsonl file paths and partial/legacy event objects", () => {
      const mock = createMockCapsule([]);
      const eventsFile = join(mock.dir, "events.jsonl");
      const partialEvent = {
        sequence: 1,
        kind: "legacy-event",
        actor: "legacy-actor",
      };
      writeFileSync(eventsFile, JSON.stringify(partialEvent) + "\n", "utf8");

      try {
        const res = readCapsuleEvents(eventsFile);
        expect(res.matchingEvents.length).toBe(1);
        expect(res.matchingEvents[0]?.sequence).toBe(1);
      } finally {
        mock.cleanup();
      }
    });

    it("handles webhook delivery with alternative receiptId shapes and fallback generation", async () => {
      // Test response with receiptId
      const mockFetchReceiptId: FetchLike = async () =>
        new Response(JSON.stringify({ receiptId: "rcpt-alt-id" }), { status: 200 });

      const res1 = await deliverEventsToWebhook(sampleEvents, "https://example.com/webhook", {
        customFetch: mockFetchReceiptId,
      });
      expect(res1.receiptId).toBe("rcpt-alt-id");

      // Test response with id field
      const mockFetchId: FetchLike = async () =>
        new Response(JSON.stringify({ id: "id-receipt-99" }), { status: 200 });

      const res2 = await deliverEventsToWebhook(sampleEvents, "https://example.com/webhook", {
        customFetch: mockFetchId,
      });
      expect(res2.receiptId).toBe("id-receipt-99");

      // Test response without json receipt
      const mockFetchNoReceipt: FetchLike = async () => new Response("plain ok", { status: 200 });

      const res3 = await deliverEventsToWebhook(sampleEvents, "https://example.com/webhook", {
        customFetch: mockFetchNoReceipt,
      });
      expect(res3.receiptId).toBeDefined();
      expect(res3.receiptId?.startsWith("rcpt_")).toBe(true);
    });
  });
});
