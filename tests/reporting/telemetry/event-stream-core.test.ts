import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { spyOn } from "bun:test";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  deliverEventsToWebhook,
  formatEventToNdjson,
  formatEventsToNdjsonStream,
  isHarnessEvent,
  parseNdjsonStream,
  readCapsuleEvents,
  renderAsciiEventStreamTable,
} from "../../../olt/scripts/src/reporting/event-stream/index.ts";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const eventStreamCoreSuiteName = "reporting/event-stream core suite";

describe(eventStreamCoreSuiteName, () => {
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

  it("reads and filters capsule events from in-memory virtual filesystem", () => {
    const vfs = new VirtualMemoryFS();
    const runDir = "/virtual/capsules/run-1";
    vfs.mkdirSync(runDir, { recursive: true });
    vfs.writeFileSync(
      `${runDir}/manifest.json`,
      JSON.stringify({ run_id: "test-run-1", capsule_id: "cap-1" }),
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

    vfs.writeFileSync(
      `${runDir}/events.jsonl`,
      [JSON.stringify(event1), JSON.stringify(event2), JSON.stringify(event3)].join("\n") + "\n",
    );

    const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => vfs.existsSync(String(p)));
    const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => {
      const stat = vfs.statSync(String(p));
      return {
        isFile: () => !stat?.isDirectory(),
        isDirectory: () => Boolean(stat?.isDirectory()),
      } as unknown as fs.Stats;
    });
    const realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) => String(p));
    const readSpy = spyOn(fs, "readFileSync").mockImplementation((p) =>
      vfs.readFileSync(String(p), "utf8"),
    );

    try {
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
    } finally {
      existsSpy.mockRestore();
      lstatSpy.mockRestore();
      realpathSpy.mockRestore();
      readSpy.mockRestore();
    }
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
