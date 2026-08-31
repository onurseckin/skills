import { describe, expect, test } from "bun:test";
import {
  EpistemicEventBus,
  EpistemicEventJournal,
  EpistemicEventStream,
  type EpistemicStreamEvent,
} from "../../../../olt/scripts/src/core/epistemic/index.ts";

function createMockEvent(partial: Partial<EpistemicStreamEvent> = {}): EpistemicStreamEvent {
  return {
    id: partial.id ?? `evt-${Date.now()}`,
    type: partial.type ?? "score:recalculated",
    timestamp: partial.timestamp ?? Date.now(),
    payload: partial.payload ?? { test: true },
    confidence: partial.confidence ?? 0.85,
    grade: partial.grade ?? "HIGH",
    source: partial.source ?? "evaluator",
  };
}

describe("Epistemic Event Stream Core & Operators", () => {
  test("subscribes, receives events, tracks subscriber count, and unsubscribes cleanly", () => {
    const stream = new EpistemicEventStream<string>();
    expect(stream.subscriberCount()).toBe(0);
    expect(stream.isClosed()).toBe(false);

    const received: string[] = [];
    const sub = stream.subscribe((msg) => {
      received.push(msg);
    });

    expect(stream.subscriberCount()).toBe(1);
    expect(sub.active).toBe(true);
    stream.emit("first");
    stream.emit("second");
    expect(received).toEqual(["first", "second"]);

    sub.unsubscribe();
    expect(sub.active).toBe(false);
    expect(stream.subscriberCount()).toBe(0);
    stream.emit("third");
    expect(received).toEqual(["first", "second"]);

    stream.close();
    expect(stream.isClosed()).toBe(true);

    // Subscribing after closed
    const closedSub = stream.subscribe(() => {});
    expect(closedSub.id).toBe("closed");
    expect(closedSub.active).toBe(false);
    closedSub.unsubscribe();

    // Emitting after closed is a no-op
    stream.emit("after-close");
    expect(received).toEqual(["first", "second"]);
  });

  test("handles synchronous errors and async promise rejections with and without error handler", async () => {
    const stream = new EpistemicEventStream<number>();
    const errors: string[] = [];

    // Sync throw with handler
    stream.subscribe(
      () => {
        throw new Error("sync failure");
      },
      (err) => {
        errors.push(err.message);
      },
    );

    // Non-Error sync throw with handler
    stream.subscribe(
      () => {
        throw "string failure";
      },
      (err) => {
        errors.push(err.message);
      },
    );

    // Async rejection with handler
    stream.subscribe(
      async () => {
        throw new Error("async failure");
      },
      (err) => {
        errors.push(err.message);
      },
    );

    // Non-Error async rejection with handler
    stream.subscribe(
      async () => {
        throw "async string failure";
      },
      (err) => {
        errors.push(err.message);
      },
    );

    // Sync throw WITHOUT handler
    stream.subscribe(() => {
      throw new Error("unhandled sync");
    });

    // Async rejection WITHOUT handler
    stream.subscribe(async () => {
      throw new Error("unhandled async");
    });

    stream.emit(42);
    // Allow async promises to reject and run catch handlers
    await new Promise((r) => setTimeout(r, 20));

    expect(errors).toContain("sync failure");
    expect(errors).toContain("string failure");
    expect(errors).toContain("async failure");
    expect(errors).toContain("async string failure");
  });

  test("transforms and filters stream via map, filter, tap, take", () => {
    const source = new EpistemicEventStream<number>();
    const tapped: number[] = [];
    const collected: string[] = [];

    const takenStream = source
      .tap((n) => tapped.push(n))
      .filter((n) => n % 2 === 0)
      .map((n) => `num:${n}`)
      .take(2);

    takenStream.subscribe((str) => collected.push(str));

    source.emit(1);
    source.emit(2);
    source.emit(3);
    source.emit(4);
    source.emit(6);

    expect(tapped).toEqual([1, 2, 3, 4, 6]);
    expect(collected).toEqual(["num:2", "num:4"]);
    expect(takenStream.isClosed()).toBe(true);

    // Take with 0 items
    const zeroStream = source.take(0);
    const zeroCollected: number[] = [];
    zeroStream.subscribe((n) => zeroCollected.push(n));
    source.emit(10);
    expect(zeroCollected).toEqual([]);
  });

  test("supports debounce, throttle, and sample stream operators", async () => {
    // Debounce
    const debStream = new EpistemicEventStream<number>();
    const debounced = debStream.debounce(20);
    let debVal: number | undefined;
    debounced.subscribe((v) => {
      debVal = v;
    });

    debStream.emit(1);
    debStream.emit(2);
    debStream.emit(3);
    expect(debVal).toBeUndefined();
    await new Promise((r) => setTimeout(r, 40));
    expect(debVal).toBe(3);

    // Throttle
    const thrStream = new EpistemicEventStream<number>();
    const throttled = thrStream.throttle(30);
    const thrVals: number[] = [];
    throttled.subscribe((v) => thrVals.push(v));

    thrStream.emit(10);
    thrStream.emit(20);
    expect(thrVals).toEqual([10]);
    await new Promise((r) => setTimeout(r, 35));
    thrStream.emit(30);
    expect(thrVals).toEqual([10, 30]);

    // Sample
    const smpStream = new EpistemicEventStream<number>();
    const sampled = smpStream.sample(25);
    let sampledVal: number | undefined;
    sampled.subscribe((v) => {
      sampledVal = v;
    });

    smpStream.emit(100);
    smpStream.emit(200);
    await new Promise((r) => setTimeout(r, 60));
    expect(sampledVal).toBe(200);
  });

  test("buffers events into fixed-size batches", () => {
    const stream = new EpistemicEventStream<number>();
    const batches: (readonly number[])[] = [];

    stream.buffer(3).subscribe((batch) => batches.push(batch));

    stream.emit(1);
    stream.emit(2);
    expect(batches.length).toBe(0);
    stream.emit(3);
    expect(batches.length).toBe(1);
    expect(batches[0]).toEqual([1, 2, 3]);
    stream.emit(4);
    stream.emit(5);
    stream.emit(6);
    expect(batches.length).toBe(2);
    expect(batches[1]).toEqual([4, 5, 6]);
  });
});

describe("Epistemic Event Journal", () => {
  test("maintains ring buffer with bounded capacity, default capacity, and query filters", () => {
    const defaultJournal = new EpistemicEventJournal();
    expect(defaultJournal.size()).toBe(0);

    const journal = new EpistemicEventJournal(3);
    const e1 = createMockEvent({ id: "e1", type: "claim:registered" });
    const e2 = createMockEvent({ id: "e2", type: "score:recalculated" });
    const e3 = createMockEvent({ id: "e3", type: "contradiction:detected" });
    const e4 = createMockEvent({ id: "e4", type: "grade:transition" });

    journal.record(e1);
    journal.record(e2);
    journal.record(e3);
    expect(journal.size()).toBe(3);

    journal.record(e4);
    expect(journal.size()).toBe(3);
    const history = journal.getHistory();
    expect(history.map((e) => e.id)).toEqual(["e2", "e3", "e4"]);

    const sliceHistory = journal.getHistory(2);
    expect(sliceHistory.map((e) => e.id)).toEqual(["e3", "e4"]);

    const contradictions = journal.getHistory(undefined, "contradiction:detected");
    expect(contradictions.length).toBe(1);
    expect(contradictions[0]!.id).toBe("e3");

    journal.clear();
    expect(journal.size()).toBe(0);
    expect(journal.getHistory()).toEqual([]);
  });
});

describe("Epistemic Event Bus", () => {
  test("routes events to type-specific streams and wildcard subscribers with journal access", () => {
    const bus = new EpistemicEventBus();
    const wildcards: string[] = [];
    const breaches: string[] = [];
    const secondBreaches: string[] = [];

    bus.on("*", (event) => wildcards.push(event.id));
    bus.on("threshold:breach", (event) => breaches.push(event.id));
    // Subscribe again to existing type stream
    bus.on("threshold:breach", (event) => secondBreaches.push(event.id));

    // Access stream objects directly
    const master = bus.stream("*");
    const breachStream = bus.stream("threshold:breach");
    // Access already created stream
    const breachStream2 = bus.stream("threshold:breach");
    expect(breachStream2).toBe(breachStream);
    const recalcStream = bus.stream("score:recalculated");
    expect(master).toBeDefined();
    expect(breachStream).toBeDefined();
    expect(recalcStream).toBeDefined();
    expect(bus.stream()).toBe(master);

    const e1 = createMockEvent({ id: "b1", type: "threshold:breach" });
    const e2 = createMockEvent({ id: "s1", type: "score:recalculated" });

    bus.publish(e1);
    bus.publish(e2);

    expect(wildcards).toEqual(["b1", "s1"]);
    expect(breaches).toEqual(["b1"]);
    expect(secondBreaches).toEqual(["b1"]);

    const replayed = bus.replay(10);
    expect(replayed.length).toBe(2);
    expect(bus.replay(1, "threshold:breach").length).toBe(1);

    expect(bus.getJournal().size()).toBe(2);
    bus.clear();
    expect(bus.getJournal().size()).toBe(0);

    bus.close();
    expect(bus.replay().length).toBe(0);
  });
});
