import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { WatchdogEventEmitter } from "../../../olt/scripts/src/watchdog/autonomic-watchdog/event-emitter.ts";
import type {
  ReactiveEvent,
  WatchdogEvent,
} from "../../../olt/scripts/src/watchdog/autonomic-watchdog/types.ts";
import { cleanupVirtualWatchdogFS, setupVirtualWatchdogFS } from "../watchdog-fixture.ts";

beforeEach(() => {
  setupVirtualWatchdogFS();
});

afterEach(() => {
  cleanupVirtualWatchdogFS();
});

describe("WatchdogEventEmitter Subscription & Safe Dispatching", () => {
  it("subscribes and unsubscribes via on/off and returned unsubscribe functions", () => {
    const emitter = new WatchdogEventEmitter();
    const received: WatchdogEvent[] = [];

    const unsubscribe = emitter.on("tick", (e) => {
      received.push(e);
    });

    emitter.emit({ type: "tick", tickCount: 1 });
    expect(received.length).toBe(1);

    unsubscribe();
    emitter.emit({ type: "tick", tickCount: 2 });
    expect(received.length).toBe(1);

    const listener = (e: WatchdogEvent) => {
      received.push(e);
    };
    emitter.addEventListener("tick", listener);
    emitter.emit({ type: "tick", tickCount: 3 });
    expect(received.length).toBe(2);

    emitter.removeEventListener("tick", listener);
    emitter.emit({ type: "tick", tickCount: 4 });
    expect(received.length).toBe(2);
  });

  it("handles wildcard * subscriptions alongside specific event types", () => {
    const emitter = new WatchdogEventEmitter();
    const wildcards: WatchdogEvent[] = [];
    const specifics: WatchdogEvent[] = [];

    emitter.on("*", (e) => wildcards.push(e));
    emitter.on("health_audit", (e) => specifics.push(e));

    emitter.emit({ type: "health_audit" });
    expect(specifics.length).toBe(1);
    expect(wildcards.length).toBe(1);

    emitter.emit({ type: "tick", tickCount: 10 });
    expect(specifics.length).toBe(1);
    expect(wildcards.length).toBe(2);
  });

  it("isolates errors thrown in listener callbacks without breaking event emission", () => {
    const emitter = new WatchdogEventEmitter();
    let secondCalled = false;

    emitter.on("test_err", () => {
      throw new Error("Failure in listener");
    });
    emitter.on("test_err", () => {
      secondCalled = true;
    });

    expect(() => emitter.emit({ type: "test_err" })).not.toThrow();
    expect(secondCalled).toBe(true);
  });

  it("emits custom events and reactive event notifications", () => {
    const emitter = new WatchdogEventEmitter();
    const notified: WatchdogEvent[] = [];
    const customTypes: unknown[] = [];

    emitter.on("event_notified", (e) => notified.push(e));
    emitter.on("task_completed", (e) => customTypes.push(e));

    const event: ReactiveEvent = {
      type: "task_completed",
      agentId: "agent-x",
      taskId: "task-y",
    };

    emitter.emitCustomEvent(event);
    expect(notified.length).toBe(1);
    expect(customTypes.length).toBe(1);

    emitter.clear();
    emitter.emitCustomEvent(event);
    expect(notified.length).toBe(1);
  });
});
