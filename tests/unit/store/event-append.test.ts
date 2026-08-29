import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Manifest, RunState } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { CHECKPOINT_INTERVAL, limits } from "../../../olt/scripts/src/engine/store/constants.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import {
  appendProjectionEvent,
  CommittedWithRecoveryPendingError,
  TRANSACTION_MARKER_FILE,
} from "../../../olt/scripts/src/engine/store/event-append.ts";
import { verifyIntegrity } from "../../../olt/scripts/src/engine/store/integrity.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { cloneObject, initialState } from "../../../olt/scripts/src/engine/store/state.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import { recoverProjection } from "../../../olt/scripts/src/engine/store/recovery.ts";
import { brainstormingProjection } from "../../../olt/scripts/src/engine/store/materialized-projections.ts";

function freshRun(label: string): { runRoot: string; manifest: Manifest } {
  const repo = scratchRoot(import.meta.path, label);
  const runRoot = initRun(repo, "append-run", new TextEncoder().encode("prompt"), "file", true);
  return { runRoot, manifest: loadRun(runRoot).manifest };
}

function eventObjects(runRoot: string): JsonObject[] {
  return readFileSync(join(runRoot, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonObject);
}

function brainstormingDraft(): RunState {
  const body: JsonObject = {
    schema: "harness.brainstorming",
    version: 1,
    prompt: "prompt",
    rounds: 1,
    vectors: [],
    total_expanded_items: 0,
    request_key: "request",
    created_at: "2026-01-01T00:00:00.000Z",
  };
  return {
    ...initialState(),
    planning: {
      brainstorming: { ...body, artifact_sha256: sha256Bytes(canonicalJsonBytes(body)) },
    },
  } as RunState;
}

describe("appendProjectionEvent checkpoints", () => {
  test("stores a patch (not a full projection) between checkpoints, and a full projection at the interval boundary", () => {
    const { runRoot, manifest } = freshRun("checkpoint-interval");
    let current: RunState = initialState();
    for (let index = 1; index <= CHECKPOINT_INTERVAL; index += 1) {
      const draft = { ...cloneObject(current), counter: index } as RunState;
      current = appendProjectionEvent(
        runRoot,
        manifest,
        current,
        "tester",
        "counted",
        { index },
        draft,
        limits(),
      );
    }
    const events = eventObjects(runRoot);
    expect(events).toHaveLength(CHECKPOINT_INTERVAL);
    for (const event of events.slice(0, CHECKPOINT_INTERVAL - 1)) {
      expect(event.projection).toBeNull();
      expect(Array.isArray(event.projection_patch)).toBe(true);
      expect((event.projection_patch as unknown[]).length).toBeGreaterThan(0);
    }
    const last = events.at(-1)!;
    expect(last.projection).not.toBeNull();
    expect(last.projection_patch).toBeNull();
    expect((last.projection as JsonObject).counter).toBe(CHECKPOINT_INTERVAL);
  });

  test("forces a full checkpoint the moment the projected state turns terminal, even off the interval", () => {
    const { runRoot, manifest } = freshRun("terminal-forces-checkpoint");
    const current = initialState();
    const draft = {
      ...cloneObject(current),
      completion_result: { status: "complete" },
    } as RunState;
    appendProjectionEvent(
      runRoot,
      manifest,
      current,
      "tester",
      "run-completed",
      {},
      draft,
      limits(),
    );
    const [event] = eventObjects(runRoot);
    expect(event!.sequence).toBe(1);
    expect(event!.projection).not.toBeNull();
    expect(event!.projection_patch).toBeNull();
  });

  test("a patch encodes exactly the business fields that changed, added, and removed", () => {
    const { runRoot, manifest } = freshRun("patch-business-fields");
    const seedDraft = {
      ...cloneObject(initialState()),
      agents: { a1: { status: "idle" } },
      stale: true,
    } as RunState;
    const afterSeed = appendProjectionEvent(
      runRoot,
      manifest,
      initialState(),
      "tester",
      "seed",
      {},
      seedDraft,
      limits(),
    );
    const nextDraft = cloneObject(afterSeed) as RunState & {
      agents: Record<string, { status: string }>;
      stale?: boolean;
    };
    nextDraft.agents = { a1: { status: "busy" } };
    delete nextDraft.stale;
    appendProjectionEvent(
      runRoot,
      manifest,
      afterSeed,
      "tester",
      "advance",
      {},
      nextDraft,
      limits(),
    );
    const events = eventObjects(runRoot);
    const second = events[1]!;
    expect(second.projection).toBeNull();
    expect(second.projection_patch).toEqual(
      expect.arrayContaining([
        { op: "set", path: ["agents", "a1", "status"], value: "busy" },
        { op: "unset", path: ["stale"] },
      ]),
    );
  });

  test("stores an appended array item as a suffix-only patch and reloads the final state", () => {
    const { runRoot, manifest } = freshRun("append-array-suffix");
    const prefix = Array.from({ length: 100 }, (_, index) => index);
    const seeded = appendProjectionEvent(
      runRoot,
      manifest,
      initialState(),
      "tester",
      "seed-array",
      {},
      { ...cloneObject(initialState()), list: prefix } as RunState,
      limits(),
    );
    const finalState = appendProjectionEvent(
      runRoot,
      manifest,
      seeded,
      "tester",
      "append-array-item",
      {},
      { ...cloneObject(seeded), list: [...prefix, 100] } as RunState,
      limits(),
    );
    const events = eventObjects(runRoot);
    expect(events[1]!.projection_patch).toEqual([{ op: "set", path: ["list", "100"], value: 100 }]);
    expect(loadRun(runRoot).state).toEqual(finalState);
    expect(verifyIntegrity(runRoot)).toEqual([]);
  });

  test("classifies a trace projection failure after the event commit as recovery-pending", () => {
    const { runRoot, manifest } = freshRun("refresh-derived-propagates-failure");
    rmSync(join(runRoot, "trace.md"), { force: true });
    mkdirSync(join(runRoot, "trace.md"));
    const current = initialState();
    const draft = { ...cloneObject(current), counter: 1 } as RunState;
    expect(() =>
      appendProjectionEvent(
        runRoot,
        manifest,
        current,
        "tester",
        "counted",
        { index: 1 },
        draft,
        limits(),
      ),
    ).toThrow(CommittedWithRecoveryPendingError);
    const events = eventObjects(runRoot);
    expect(events).toHaveLength(1);
    expect(existsSync(join(runRoot, TRANSACTION_MARKER_FILE))).toBe(true);
    const marker = JSON.parse(readFileSync(join(runRoot, TRANSACTION_MARKER_FILE), "utf8")) as {
      phase: string;
      sequence: number;
    };
    expect(marker.phase).toBe("PROJECTIONS_PENDING");
    expect(marker.sequence).toBe(1);
  });

  test("leaves canonical files byte-identical and clears its marker when append fails before commit", () => {
    const { runRoot, manifest } = freshRun("pre-commit-rejection");
    const events = readFileSync(join(runRoot, "events.jsonl"));
    const state = readFileSync(join(runRoot, "state.json"));
    expect(() =>
      appendProjectionEvent(
        runRoot,
        manifest,
        initialState(),
        "tester",
        "counted",
        {},
        { ...initialState(), counter: 1 } as RunState,
        limits(),
        {
          beforeEventAppend: () => {
            throw new Error("append fault");
          },
        },
      ),
    ).toThrow("append fault");
    expect(readFileSync(join(runRoot, "events.jsonl"))).toEqual(events);
    expect(readFileSync(join(runRoot, "state.json"))).toEqual(state);
    expect(existsSync(join(runRoot, TRANSACTION_MARKER_FILE))).toBe(false);
  });

  test("crash immediately after event fsync retains a recoverable, fully prepared marker", () => {
    const { runRoot, manifest } = freshRun("after-event-fsync-crash");
    expect(() =>
      appendProjectionEvent(
        runRoot,
        manifest,
        initialState(),
        "tester",
        "brainstormed",
        {
          schema: "harness.brainstorming",
          semantic_version: 1,
          request_key: "a".repeat(64),
          authority_actor: "tester",
          artifact_sha256: brainstormingProjection(brainstormingDraft())!.sha256,
        },
        brainstormingDraft(),
        limits(),
        {
          afterEventCommit: () => {
            throw new Error("crash after event fsync");
          },
        },
      ),
    ).toThrow(CommittedWithRecoveryPendingError);
    const marker = JSON.parse(readFileSync(join(runRoot, TRANSACTION_MARKER_FILE), "utf8")) as {
      phase: string;
      request_key: string;
      payload_sha256: string;
      semantic_schema: string;
      semantic_version: number;
      event_hash: string;
      sequence: number;
      materialized_projections: unknown[];
    };
    expect(marker).toMatchObject({
      phase: "STATE_PENDING",
      request_key: "a".repeat(64),
      semantic_schema: "harness.brainstorming",
      semantic_version: 1,
      sequence: 1,
    });
    expect(marker.event_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(marker.payload_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(marker.materialized_projections).toEqual([
      { path: "brainstorming.json", sha256: expect.any(String) },
    ]);
    expect(() => recoverProjection(runRoot, "recovery")).not.toThrow();
    expect(existsSync(join(runRoot, TRANSACTION_MARKER_FILE))).toBe(false);
  });

  for (const boundary of ["write", "rename", "fsync"] as const) {
    test(`classifies a ${boundary} fault in state projection as recovery-pending`, () => {
      const { runRoot, manifest } = freshRun(`state-${boundary}-fault`);
      expect(() =>
        appendProjectionEvent(
          runRoot,
          manifest,
          initialState(),
          "tester",
          "counted",
          {},
          { ...initialState(), counter: 1 } as RunState,
          limits(),
          {
            writeState: () => {
              throw new Error(`${boundary} fault`);
            },
          },
        ),
      ).toThrow(CommittedWithRecoveryPendingError);
      expect(eventObjects(runRoot)).toHaveLength(1);
      expect(
        JSON.parse(readFileSync(join(runRoot, TRANSACTION_MARKER_FILE), "utf8")),
      ).toMatchObject({
        phase: "STATE_PENDING",
        sequence: 1,
      });
    });
  }

  for (const stage of [
    "materialized temp write",
    "materialized file fsync",
    "materialized rename",
    "materialized directory fsync",
    "marker clear",
  ] as const) {
    test(`${stage} fault after commit leaves one event and a recovery marker`, () => {
      const { runRoot, manifest } = freshRun(`materialized-${stage}`);
      const dependencies =
        stage === "marker clear"
          ? {
              clearMarker: () => {
                throw new Error(`${stage} fault`);
              },
            }
          : {
              materialize: () => {
                throw new Error(`${stage} fault`);
              },
            };
      expect(() =>
        appendProjectionEvent(
          runRoot,
          manifest,
          initialState(),
          "tester",
          "brainstormed",
          {},
          brainstormingDraft(),
          limits(),
          dependencies,
        ),
      ).toThrow(CommittedWithRecoveryPendingError);
      expect(eventObjects(runRoot)).toHaveLength(1);
      expect(existsSync(join(runRoot, TRANSACTION_MARKER_FILE))).toBe(true);
      const eventsBeforeRecovery = readFileSync(join(runRoot, "events.jsonl"), "utf8");
      const recovered = recoverProjection(runRoot, "recovery");
      const projection = brainstormingProjection(recovered);
      expect(projection).toBeDefined();
      expect(readFileSync(join(runRoot, "brainstorming.json"))).toEqual(
        Buffer.from(canonicalJsonBytes(projection!.document)),
      );
      expect(loadRun(runRoot).state).toEqual(recovered);
      expect(existsSync(join(runRoot, "trace.md"))).toBe(true);
      expect(existsSync(join(runRoot, "index.json"))).toBe(true);
      expect(existsSync(join(runRoot, TRANSACTION_MARKER_FILE))).toBe(false);
      expect(readFileSync(join(runRoot, "events.jsonl"), "utf8")).toBe(eventsBeforeRecovery);
    });
  }
});
