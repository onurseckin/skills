import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessEvent } from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  deliverEventsToWebhook,
  formatEventToNdjson,
  formatEventsToNdjsonStream,
  isHarnessEvent,
  parseNdjsonStream,
  readCapsuleEvents,
  renderAsciiEventStreamTable,
  resolveCapsulePath,
} from "../../../../olt/scripts/src/reporting/event-stream/index.ts";

describe("reporting/event-stream core suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `event-stream-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("validates HarnessEvent structure with isHarnessEvent", () => {
    const valid: HarnessEvent = {
      schema: "harness-event-v1",
      sequence: 1,
      timestamp: "2026-08-29T00:00:00.000Z",
      actor: "implementer_13",
      kind: "task_started",
      payload: { task_id: "task-1" },
    };
    expect(isHarnessEvent(valid)).toBe(true);
    expect(isHarnessEvent(null)).toBe(false);
    expect(isHarnessEvent({})).toBe(false);
    expect(isHarnessEvent({ schema: "v1", sequence: "1" })).toBe(false);
  });

  it("reads and filters capsule events from disk", () => {
    const runDir = join(tempDir, "run-1");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "manifest.json"),
      JSON.stringify({ run_id: "test-run-1", capsule_id: "cap-1" }),
      "utf-8",
    );

    const event1: HarnessEvent = {
      schema: "harness-event-v1",
      sequence: 1,
      timestamp: "2026-08-29T00:00:00.000Z",
      actor: "impl_1",
      kind: "start",
      payload: { task_id: "t1" },
    };
    const event2: HarnessEvent = {
      schema: "harness-event-v1",
      sequence: 2,
      timestamp: "2026-08-29T00:01:00.000Z",
      actor: "val_1",
      kind: "validate",
      payload: { task_id: "t1", status: "pass" },
    };
    const event3: HarnessEvent = {
      schema: "harness-event-v1",
      sequence: 3,
      timestamp: "2026-08-29T00:02:00.000Z",
      actor: "impl_1",
      kind: "complete",
      payload: { task_id: "t1" },
    };

    writeFileSync(
      join(runDir, "events.jsonl"),
      [JSON.stringify(event1), JSON.stringify(event2), JSON.stringify(event3)].join("\n") + "\n",
      "utf-8",
    );

    const result = readCapsuleEvents(runDir, { filterActor: "impl_1" });
    expect(result.runId).toBe("test-run-1");
    expect(result.capsuleId).toBe("cap-1");
    expect(result.totalAvailable).toBe(3);
    expect(result.matchingEvents.length).toBe(2);
    expect(result.latestSeq).toBe(3);
    expect(result.hasMore).toBe(false);

    const seqFiltered = readCapsuleEvents(runDir, { fromSeq: 2, toSeq: 2 });
    expect(seqFiltered.matchingEvents.length).toBe(1);
    expect(seqFiltered.matchingEvents[0]?.actor).toBe("val_1");
  });

  it("handles ndjson formatting and parsing", () => {
    const events: HarnessEvent[] = [
      {
        schema: "harness-event-v1",
        sequence: 1,
        timestamp: "2026-08-29T00:00:00.000Z",
        actor: "agent-1",
        kind: "init",
      },
      {
        schema: "harness-event-v1",
        sequence: 2,
        timestamp: "2026-08-29T00:01:00.000Z",
        actor: "agent-2",
        kind: "done",
      },
    ];

    const singleLine = formatEventToNdjson(events[0]!);
    expect(singleLine.endsWith("\n")).toBe(true);

    const stream = formatEventsToNdjsonStream(events);
    expect(stream.split("\n").filter(Boolean).length).toBe(2);

    const parsed = parseNdjsonStream(stream);
    expect(parsed.length).toBe(2);
    expect(parsed[0]?.actor).toBe("agent-1");
    expect(parsed[1]?.actor).toBe("agent-2");
  });

  it("renders ASCII event stream table correctly", () => {
    const events: HarnessEvent[] = [
      {
        schema: "harness-event-v1",
        sequence: 1,
        timestamp: "2026-08-29T12:00:00.000Z",
        actor: "coordinator",
        kind: "task_assign",
        payload: { task_id: "task-101", role: "implementer" },
      },
    ];

    const table = renderAsciiEventStreamTable(events, { title: "Live Pipeline Events" });
    expect(table).toContain("Live Pipeline Events");
    expect(table).toContain("coordinator");
    expect(table).toContain("task_assign");
    expect(table).toContain("task: task-101");

    const emptyTable = renderAsciiEventStreamTable([]);
    expect(emptyTable).toContain("No events found");
  });

  it("delivers events to webhook endpoint with mock fetch", async () => {
    const events: HarnessEvent[] = [
      {
        schema: "harness-event-v1",
        sequence: 1,
        timestamp: "2026-08-29T00:00:00.000Z",
        actor: "agent-1",
        kind: "test_event",
      },
    ];

    let fetchCalled = 0;
    const mockFetch = async () => {
      fetchCalled += 1;
      return new Response(JSON.stringify({ receipt_id: "rcpt_mock_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const delivery = await deliverEventsToWebhook(events, "https://webhook.example.com/events", {
      customFetch: mockFetch,
    });

    expect(delivery.success).toBe(true);
    expect(delivery.deliveredCount).toBe(1);
    expect(delivery.receiptId).toBe("rcpt_mock_123");
    expect(fetchCalled).toBe(1);
  });
});
