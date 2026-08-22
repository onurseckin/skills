import { describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:crypto";
import {
  deliverEventsToWebhook,
  formatEventsToNdjsonStream,
  formatEventToNdjson,
  isHarnessEvent,
  parseNdjsonStream,
  readCapsuleEvents,
  renderAsciiEventStreamTable,
  resolveCapsulePath,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/event-stream.ts";
import { streamEventsCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/stream-events.ts";
import type { HarnessEvent } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";

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
      const mockFetch: typeof fetch = async (url, init) => {
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
      const mockFetch: typeof fetch = async () => {
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
      const mockFetch: typeof fetch = async () => {
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

    it("handles empty events list with placeholder message", () => {
      const table = renderAsciiEventStreamTable([]);
      expect(table).toContain("No events found");
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
      }) as typeof fetch;

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
  });
});
