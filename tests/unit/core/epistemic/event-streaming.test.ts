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
  test("subscribes, receives events, and unsubscribes cleanly", () => {
    const stream = new EpistemicEventStream<string>();
    const received: string[] = [];

    const sub = stream.subscribe((msg) => {
      received.push(msg);
    });

    stream.emit("first");
    stream.emit("second");
    expect(received).toEqual(["first", "second"]);
    expect(sub.active).toBe(true);

    sub.unsubscribe();
    expect(sub.active).toBe(false);
    stream.emit("third");
    expect(received).toEqual(["first", "second"]);
  });

  test("handles errors cleanly via error handler callback", () => {
    const stream = new EpistemicEventStream<number>();
    const errors: Error[] = [];

    stream.subscribe(
      () => {
        throw new Error("stream processing failure");
      },
      (err) => {
        errors.push(err);
      },
    );

    stream.emit(42);
    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toBe("stream processing failure");
  });

  test("transforms and filters stream via map, filter, tap, take", () => {
    const source = new EpistemicEventStream<number>();
    const tapped: number[] = [];
    const collected: string[] = [];

    source
      .tap((n) => tapped.push(n))
      .filter((n) => n % 2 === 0)
      .map((n) => `num:${n}`)
      .take(2)
      .subscribe((str) => collected.push(str));

    source.emit(1);
    source.emit(2);
    source.emit(3);
    source.emit(4);
    source.emit(6);

    expect(tapped).toEqual([1, 2, 3, 4, 6]);
    expect(collected).toEqual(["num:2", "num:4"]);
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
  test("maintains ring buffer with bounded capacity and query filters", () => {
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

    const contradictions = journal.getHistory(undefined, "contradiction:detected");
    expect(contradictions.length).toBe(1);
    expect(contradictions[0]!.id).toBe("e3");
  });
});

describe("Epistemic Event Bus", () => {
  test("routes events to type-specific streams and wildcard subscribers", () => {
    const bus = new EpistemicEventBus();
    const wildcards: string[] = [];
    const breaches: string[] = [];

    bus.on("*", (event) => wildcards.push(event.id));
    bus.on("threshold:breach", (event) => breaches.push(event.id));

    const e1 = createMockEvent({ id: "b1", type: "threshold:breach" });
    const e2 = createMockEvent({ id: "s1", type: "score:recalculated" });

    bus.publish(e1);
    bus.publish(e2);

    expect(wildcards).toEqual(["b1", "s1"]);
    expect(breaches).toEqual(["b1"]);

    const replayed = bus.replay(10);
    expect(replayed.length).toBe(2);
    expect(bus.replay(1, "threshold:breach").length).toBe(1);

    bus.close();
    expect(bus.replay().length).toBe(0);
  });
});
