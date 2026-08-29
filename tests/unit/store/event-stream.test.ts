import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HarnessEvent, RunState } from "../../../olt/scripts/src/core/contracts/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import { validateEventChain } from "../../../olt/scripts/src/engine/store/event-stream.ts";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

const IDENTITY = { runId: "run-1", capsuleId: "c".repeat(32) };

function projectionFor(sequence: number): RunState {
  // A stored event projection never carries event_head (the production writer deletes it before
  // persisting, since it would otherwise embed the event's own hash inside itself); the RunState
  // type still declares the field as required, so the cast reflects the real on-disk shape.
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
  const path = join(root, "events.jsonl");
  return path;
}

describe("validateEventChain", () => {
  test("accepts an empty file and returns the initial state with no events", () => {
    const root = scratchRoot("accepts-an-empty-file-and-returns-the-initial-stat");
    const path = eventsPath(root);
    writeFileSync(path, "");
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues).toEqual([]);
    expect(result.eventCount).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.finalState.event_sequence).toBe(0);
  });

  test("accepts a single valid event and chains a second event onto its hash", () => {
    const root = scratchRoot("accepts-a-single-valid-event-and-chains-a-second-e");
    const path = eventsPath(root);
    const first = makeEvent({}, 1, null);
    const second = makeEvent({ previous_hash: first.hash }, 2, first.hash);
    writeEvents(path, [first, second]);
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues).toEqual([]);
    expect(result.eventCount).toBe(2);
    expect(result.events).toEqual([first, second]);
    expect(result.finalState.event_head).toBe(second.hash);
  });

  test("reports EVENT_COUNT and stops once the configured maxEventCount is exceeded", () => {
    const root = scratchRoot("reports-event-count-and-stops-once-the-configured-");
    const path = eventsPath(root);
    const first = makeEvent({}, 1, null);
    const second = makeEvent({ previous_hash: first.hash }, 2, first.hash);
    writeEvents(path, [first, second]);
    const result = validateEventChain(path, IDENTITY, { maxEventCount: 1 });
    expect(result.issues.some((i) => i.code === "EVENT_COUNT")).toBe(true);
  });

  test("reports EVENT_SIZE for an oversized line and skips parsing it", () => {
    const root = scratchRoot("reports-event-size-for-an-oversized-line-and-skips");
    const path = eventsPath(root);
    const first = makeEvent({}, 1, null);
    writeEvents(path, [first]);
    const result = validateEventChain(path, IDENTITY, { maxEventBytes: 10 });
    expect(result.issues.some((i) => i.code === "EVENT_SIZE")).toBe(true);
    expect(result.eventCount).toBe(0);
  });

  test("reports EVENT_TORN for an unterminated final line when reportTorn is true, and carries tornTail", () => {
    const root = scratchRoot("reports-event-torn-for-an-unterminated-final-line-");
    const path = eventsPath(root);
    writeFileSync(path, '{"schema":"harness.event"}');
    const result = validateEventChain(path, IDENTITY, {}, true);
    expect(result.issues.some((i) => i.code === "EVENT_TORN")).toBe(true);
    expect(result.tornTail).toBeDefined();
  });

  test("omits the EVENT_TORN issue but still reports the torn tail when reportTorn is false", () => {
    const root = scratchRoot("omits-the-event-torn-issue-but-still-reports-the-t");
    const path = eventsPath(root);
    writeFileSync(path, '{"schema":"harness.event"}');
    const result = validateEventChain(path, IDENTITY, {}, false);
    expect(result.issues.some((i) => i.code === "EVENT_TORN")).toBe(false);
    expect(result.tornTail).toBeDefined();
  });

  test("reports EVENT_JSON for a line that is not valid JSON", () => {
    const root = scratchRoot("reports-event-json-for-a-line-that-is-not-valid-js");
    const path = eventsPath(root);
    writeFileSync(path, "not json at all\n");
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_JSON")).toBe(true);
  });

  test("reports EVENT_JSON when a line parses to a JSON array instead of an object", () => {
    const root = scratchRoot("reports-event-json-when-a-line-parses-to-a-json-ar");
    const path = eventsPath(root);
    writeFileSync(path, "[1,2,3]\n");
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_JSON")).toBe(true);
  });

  test("reports EVENT_CANONICAL when the stored line is not canonical JSON for its own content", () => {
    const root = scratchRoot("reports-event-canonical-when-the-stored-line-is-no");
    const path = eventsPath(root);
    const event = makeEvent({}, 1, null);
    writeFileSync(path, `${JSON.stringify(event)}\n`);
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_CANONICAL")).toBe(true);
  });

  test("reports EVENT_SCHEMA for a wrong schema or version", () => {
    const root = scratchRoot("reports-event-schema-for-a-wrong-schema-or-version");
    const path = eventsPath(root);
    writeEvents(path, [makeEvent({ schema: "wrong" as never }, 1, null)]);
    let result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_SCHEMA")).toBe(true);

    const root2 = scratchRoot("reports-event-schema-for-a-wrong-schema-or-version-root2");
    const path2 = eventsPath(root2);
    writeEvents(path2, [makeEvent({ version: 2 }, 1, null)]);
    result = validateEventChain(path2, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_SCHEMA")).toBe(true);
  });

  test("reports EVENT_RUN_ID and EVENT_CAPSULE_ID when identity fields disagree", () => {
    const root = scratchRoot("reports-event-run-id-and-event-capsule-id-when-ide");
    const path = eventsPath(root);
    writeEvents(path, [makeEvent({ run_id: "different-run" }, 1, null)]);
    let result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_RUN_ID")).toBe(true);

    const root2 = scratchRoot("reports-event-run-id-and-event-capsule-id-when-ide-root2");
    const path2 = eventsPath(root2);
    writeEvents(path2, [makeEvent({ capsule_id: "d".repeat(32) }, 1, null)]);
    result = validateEventChain(path2, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_CAPSULE_ID")).toBe(true);
  });

  test("reports EVENT_SEQUENCE and EVENT_REVISION when they diverge from the expected counter", () => {
    const root = scratchRoot("reports-event-sequence-and-event-revision-when-the");
    const path = eventsPath(root);
    writeEvents(path, [makeEvent({ sequence: 5 }, 1, null)]);
    let result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_SEQUENCE")).toBe(true);

    const root2 = scratchRoot("reports-event-sequence-and-event-revision-when-the-root2");
    const path2 = eventsPath(root2);
    writeEvents(path2, [makeEvent({ revision: 5 }, 1, null)]);
    result = validateEventChain(path2, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_REVISION")).toBe(true);
  });

  test("reports EVENT_CHAIN when previous_hash does not match the running chain head", () => {
    const root = scratchRoot("reports-event-chain-when-previous-hash-does-not-ma");
    const path = eventsPath(root);
    writeEvents(path, [makeEvent({ previous_hash: "b".repeat(64) }, 1, null)]);
    const result = validateEventChain(path, IDENTITY);
    expect(result.issues.some((i) => i.code === "EVENT_CHAIN")).toBe(true);
  });

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
