import { describe, expect, it } from "bun:test";
import {
  StreamMultiplexer,
  type StreamSubscriber,
} from "../../../olt/scripts/src/reporting/tui/stream-multiplexer.ts";
import type {
  MuxEnvelope,
  StreamSource,
} from "../../../olt/scripts/src/reporting/tui/stream-sources.ts";

class MockStreamSource implements StreamSource {
  public readonly channelName: string;
  private queuedEvents: MuxEnvelope[] = [];

  constructor(channelName: string) {
    this.channelName = channelName;
  }

  public enqueue(payload: Record<string, unknown>, actor = "test-actor", timestamp?: string): void {
    this.queuedEvents.push({
      id: `raw-${this.queuedEvents.length + 1}`,
      channel: this.channelName,
      timestamp: timestamp ?? new Date().toISOString(),
      sequence: 0,
      actor,
      kind: "mock_event",
      payload,
    });
  }

  public pollNewEvents(): readonly MuxEnvelope[] {
    const events = [...this.queuedEvents];
    this.queuedEvents = [];
    return events;
  }
}

describe("Stream Multiplexer Engine Coverage (stream-multiplexer.ts)", () => {
  describe("Registration, Push, and Subscription", () => {
    it("registers and unregisters stream sources", () => {
      const mux = new StreamMultiplexer();
      const source1 = new MockStreamSource("channel-a");
      const source2 = new MockStreamSource("channel-b");

      mux.registerSource(source1);
      mux.registerSource(source2);

      source1.enqueue({ msg: "from-a" });
      source2.enqueue({ msg: "from-b" });

      const polled1 = mux.pollSources();
      expect(polled1.length).toBe(2);

      mux.unregisterSource("channel-a");
      source1.enqueue({ msg: "ignored" });
      source2.enqueue({ msg: "from-b-again" });

      const polled2 = mux.pollSources();
      expect(polled2.length).toBe(1);
      expect(polled2[0]?.channel).toBe("channel-b");
    });

    it("pushes events with default and custom attributes", () => {
      const mux = new StreamMultiplexer();
      const ev1 = mux.pushEvent("tasks", { id: 101 });
      expect(ev1.channel).toBe("tasks");
      expect(ev1.actor).toBe("system");
      expect(ev1.kind).toBe("custom_event");
      expect(ev1.sequence).toBe(1);
      expect(ev1.id).toBe("tasks-1");

      const customTs = "2026-09-01T15:00:00.000Z";
      const ev2 = mux.pushEvent("alerts", { alert: "warn" }, "watchdog", "health_alert", customTs);
      expect(ev2.actor).toBe("watchdog");
      expect(ev2.kind).toBe("health_alert");
      expect(ev2.timestamp).toBe(customTs);
      expect(ev2.sequence).toBe(2);
    });

    it("notifies channel and global subscribers and handles failing subscribers safely", () => {
      const mux = new StreamMultiplexer();
      const channelEvents: string[] = [];
      const allEvents: string[] = [];

      const badSubscriber: StreamSubscriber = () => {
        throw new Error("Subscriber crash simulation");
      };

      const unsubChannel = mux.subscribe("telemetry", (ev) => {
        channelEvents.push(ev.channel);
      });
      const unsubBad = mux.subscribe("telemetry", badSubscriber);
      const unsubBadGlobal = mux.subscribeAll(badSubscriber);
      const unsubGlobal = mux.subscribeAll((ev) => {
        allEvents.push(ev.channel);
      });

      mux.pushEvent("telemetry", { metric: 1 });
      mux.pushEvent("logs", { log: "line" });

      expect(channelEvents).toEqual(["telemetry"]);
      expect(allEvents).toEqual(["telemetry", "logs"]);

      unsubChannel();
      unsubBad();
      unsubBadGlobal();
      unsubGlobal();

      mux.pushEvent("telemetry", { metric: 2 });
      expect(channelEvents.length).toBe(1);
      expect(allEvents.length).toBe(2);
    });
  });

  describe("Polling and Sorting", () => {
    it("sorts polled envelopes chronologically and resolves ties by sequence", () => {
      const mux = new StreamMultiplexer();
      const src1 = new MockStreamSource("source-1");
      const src2 = new MockStreamSource("source-2");

      mux.registerSource(src1);
      mux.registerSource(src2);

      const t1 = "2026-09-01T10:00:00.000Z";
      const t2 = "2026-09-01T10:00:05.000Z";

      src1.enqueue({ order: 2 }, "worker", t2);
      src1.enqueue({ order: 1 }, "worker", t1);
      src2.enqueue({ order: 3 }, "worker", t2); // same timestamp as order 2

      const polled = mux.pollSources();
      expect(polled.length).toBe(3);
      expect(polled[0]?.timestamp).toBe(t1);
      expect(polled[1]?.sequence).toBeLessThan(polled[2]?.sequence ?? 0);
    });
  });

  describe("Querying, Limiting, and Buffer Sizing", () => {
    it("queries events by channel and actor with limits", () => {
      const mux = new StreamMultiplexer();
      mux.pushEvent("chan-1", { idx: 1 }, "agent-A");
      mux.pushEvent("chan-1", { idx: 2 }, "agent-B");
      mux.pushEvent("chan-2", { idx: 3 }, "agent-A");
      mux.pushEvent("chan-1", { idx: 4 }, "agent-A");

      expect(mux.getEvents().length).toBe(4);
      expect(mux.getEvents("chan-1").length).toBe(3);
      expect(mux.getEvents("chan-1", 2).length).toBe(2);
      expect(mux.getEvents("chan-1", 10).length).toBe(3);
      expect(mux.getEvents("chan-1", 0).length).toBe(3);

      expect(mux.getEventsByActor("agent-A").length).toBe(3);
      expect(mux.getEventsByActor("agent-A", 2).length).toBe(2);
      expect(mux.getEventsByActor("agent-A", 0).length).toBe(3);
      expect(mux.getEventsByActor("nonexistent").length).toBe(0);
    });

    it("manages buffer overflow, dynamic resize, and clearing", () => {
      const mux = new StreamMultiplexer({ maxBufferSize: 3 });
      expect(mux.getBufferSize()).toBe(0);
      expect(mux.getDroppedCount()).toBe(0);

      mux.pushEvent("c", { i: 1 });
      mux.pushEvent("c", { i: 2 });
      mux.pushEvent("c", { i: 3 });
      expect(mux.getBufferSize()).toBe(3);
      expect(mux.getDroppedCount()).toBe(0);

      // Overflow by 2
      mux.pushEvent("c", { i: 4 });
      mux.pushEvent("c", { i: 5 });
      expect(mux.getBufferSize()).toBe(3);
      expect(mux.getDroppedCount()).toBe(2);

      // Dynamically shrink buffer
      mux.setMaxBufferSize(1);
      expect(mux.getBufferSize()).toBe(1);
      expect(mux.getDroppedCount()).toBe(4); // 2 previous + 2 excess dropped

      // Clamping zero / negative max size to 1
      mux.setMaxBufferSize(-10);
      expect(mux.getBufferSize()).toBe(1);

      mux.clearBuffer();
      expect(mux.getBufferSize()).toBe(0);
      expect(mux.getEvents()).toEqual([]);
    });
  });
});
