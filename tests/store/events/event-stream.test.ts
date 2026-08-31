import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HarnessEvent, RunState } from "../../../olt/scripts/src/core/contracts/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import { validateEventChain } from "../../../olt/scripts/src/engine/store/events/event-stream.ts";
import { scratchRoot as makeScratchRoot } from "../../shared/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

const IDENTITY = { runId: "run-1", capsuleId: "c".repeat(32) };

function projectionFor(sequence: number): RunState {
  return {
    schema: "harness.state",
    version: 1,
    revision: sequence,
    event_sequence: sequence,
  } as RunState;
}

function makeEvent(
  overrides: Partial<HarnessEvent> = {},
  sequence = 1,
  previousHash: string | null = null,
): HarnessEvent {
  const content = {
    schema: "harness.event" as const,
    version: 1,
    run_id: IDENTITY.runId,
    capsule_id: IDENTITY.capsuleId,
    sequence,
    revision: sequence,
    timestamp: "2026-08-20T00:00:00.000Z",
    actor: "tester",
    kind: "task-created",
    payload: { task_id: "T-1" },
    previous_hash: previousHash,
    projection: projectionFor(sequence),
    ...overrides,
  };
  const hash =
    "hash" in overrides && overrides.hash !== undefined
      ? overrides.hash
      : sha256Bytes(canonicalJsonBytes(content as never));
  return { ...content, hash } as HarnessEvent;
}

function writeEvents(path: string, events: readonly HarnessEvent[]): void {
  const body = events
    .map((event) => `${new TextDecoder().decode(canonicalJsonBytes(event as never))}\n`)
    .join("");
  writeFileSync(path, body);
}

function eventsPath(root: string): string {
  return join(root, "events.jsonl");
}

describe("validateEventChain payloads & replay", () => {
  test("reports EVENT_ACTOR and EVENT_KIND for blank actor or kind", () => {
    const root = scratchRoot("reports-event-actor-and-event-kind-for-blank-actor");
    const path = eventsPath(root);
    writeEvents(path, [makeEvent({ actor: "   " }, 1, null)]);
    let result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_ACTOR")).toBe(true);

    const root2 = scratchRoot("reports-event-actor-and-event-kind-for-blank-actor-root2");
    const path2 = eventsPath(root2);
    writeEvents(path2, [makeEvent({ kind: "" }, 1, null)]);
    result = validateEventChain(path2, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_KIND")).toBe(true);
  });

  test("reports EVENT_PAYLOAD when the payload is not an object", () => {
    const root = scratchRoot("reports-event-payload-when-the-payload-is-not-an-o");
    const path = eventsPath(root);
    writeEvents(path, [makeEvent({ payload: "not-an-object" as never }, 1, null)]);
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_PAYLOAD")).toBe(true);
  });

  test("reports EVENT_TIME for a non-UTC or unparseable timestamp", () => {
    const root = scratchRoot("reports-event-time-for-a-non-utc-or-unparseable-ti");
    const path = eventsPath(root);
    writeEvents(path, [makeEvent({ timestamp: "2026-08-20T00:00:00.000+02:00" }, 1, null)]);
    let result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_TIME")).toBe(true);

    const root2 = scratchRoot("reports-event-time-for-a-non-utc-or-unparseable-ti-root2");
    const path2 = eventsPath(root2);
    writeEvents(path2, [makeEvent({ timestamp: "not-a-timestampZ" }, 1, null)]);
    result = validateEventChain(path2, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_TIME")).toBe(true);
  });

  test("propagates projection validation issues via EVENT_PROJECTION", () => {
    const root = scratchRoot("propagates-projection-validation-issues-via-event-");
    const path = eventsPath(root);
    writeEvents(path, [
      makeEvent({ projection: { ...projectionFor(1), schema: "wrong" as never } }, 1, null),
    ]);
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_PROJECTION")).toBe(true);
  });

  test("reports EVENT_HASH when the hash is not a lowercase sha256 string", () => {
    const root = scratchRoot("reports-event-hash-when-the-hash-is-not-a-lowercas");
    const path = eventsPath(root);
    writeEvents(path, [makeEvent({ hash: "not-a-hash" }, 1, null)]);
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_HASH")).toBe(true);
  });

  test("reports EVENT_HASH when the hash does not match the event's own content", () => {
    const root = scratchRoot("reports-event-hash-when-the-hash-does-not-match-th");
    const path = eventsPath(root);
    writeEvents(path, [makeEvent({ hash: "f".repeat(64) }, 1, null)]);
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_HASH")).toBe(true);
  });

  test("does not advance the chain or collect the event when any issue was found on that line", () => {
    const root = scratchRoot("does-not-advance-the-chain-or-collect-the-event-wh");
    const path = eventsPath(root);
    const bad = makeEvent({ actor: "" }, 1, null);
    const followsBad = makeEvent({ sequence: 2, revision: 2, previous_hash: null }, 2, null);
    writeEvents(path, [bad, followsBad]);
    const result = validateEventChain(path, IDENTITY);
    expect(result.eventCount).toBe(0);
    expect(result.events).toEqual([]);
  });

  test("does not collect events into the returned array when collectEvents is false", () => {
    const root = scratchRoot("does-not-collect-events-into-the-returned-array-wh");
    const path = eventsPath(root);
    writeEvents(path, [makeEvent({}, 1, null)]);
    const result = validateEventChain(path, IDENTITY, {}, true, false);
    expect(result.eventCount).toBe(1);
    expect(result.events).toEqual([]);
  });

  test("reports EVENT_READ when the underlying file cannot be streamed at all", () => {
    const root = scratchRoot("reports-event-read-when-the-underlying-file-cannot");
    const directoryAsPath = join(root, "a-directory");
    mkdirSync(directoryAsPath);
    const result = validateEventChain(directoryAsPath, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_READ")).toBe(true);
  });

  test("reconstructs finalState by replaying patch events forward from a checkpoint", () => {
    const root = scratchRoot("reconstructs-finalstate-by-replaying-patch-events-");
    const path = eventsPath(root);
    const checkpointProjection = {
      schema: "harness.state",
      version: 1,
      revision: 1,
      event_sequence: 1,
      counter: 5,
    } as RunState;
    const first = makeEvent({ projection: checkpointProjection }, 1, null);
    const second = makeEvent(
      { projection: null, projection_patch: [{ op: "set", path: ["counter"], value: 6 }] },
      2,
      first.hash,
    );
    const third = makeEvent(
      {
        projection: null,
        projection_patch: [{ op: "set", path: ["nested", "flag"], value: true }],
      },
      3,
      second.hash,
    );
    writeEvents(path, [first, second, third]);
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues).toEqual([]);
    expect(result.eventCount).toBe(3);
    expect(result.finalState).toEqual({
      schema: "harness.state",
      version: 1,
      revision: 3,
      event_sequence: 3,
      event_head: third.hash,
      counter: 6,
      nested: { flag: true },
    });
  });

  test("a later checkpoint overrides everything accumulated by patches before it", () => {
    const root = scratchRoot("a-later-checkpoint-overrides-everything-accumulate");
    const path = eventsPath(root);
    const first = makeEvent(
      { projection: null, projection_patch: [{ op: "set", path: ["counter"], value: 1 }] },
      1,
      null,
    );
    const secondProjection = {
      schema: "harness.state",
      version: 1,
      revision: 2,
      event_sequence: 2,
      counter: 99,
    } as RunState;
    const second = makeEvent({ projection: secondProjection }, 2, first.hash);
    writeEvents(path, [first, second]);
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues).toEqual([]);
    expect(result.finalState.counter).toBe(99);
  });

  test("reports EVENT_PROJECTION_PATCH when a patch-only event carries a malformed patch", () => {
    const root = scratchRoot("reports-event-projection-patch-when-a-patch-only-e");
    const path = eventsPath(root);
    writeEvents(path, [
      makeEvent({ projection: null, projection_patch: "not-an-array" as never }, 1, null),
    ]);
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_PROJECTION_PATCH")).toBe(true);
  });

  test("reports EVENT_PROJECTION when an event carries neither a checkpoint projection nor a patch", () => {
    const root = scratchRoot("reports-event-projection-when-an-event-carries-nei");
    const path = eventsPath(root);
    writeEvents(path, [makeEvent({ projection: null }, 1, null)]);
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_PROJECTION")).toBe(true);
  });

  test("reports EVENT_PROJECTION when an event carries both a checkpoint projection and a patch", () => {
    const root = scratchRoot("reports-event-projection-when-an-event-carries-bot");
    const path = eventsPath(root);
    writeEvents(path, [
      makeEvent({ projection_patch: [{ op: "set", path: ["counter"], value: 1 }] }, 1, null),
    ]);
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_PROJECTION")).toBe(true);
  });
});
