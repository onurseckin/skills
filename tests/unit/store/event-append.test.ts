import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Manifest,
  RunState,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import {
  CHECKPOINT_INTERVAL,
  limits,
} from "../../../orchestrating-long-tasks/scripts/src/store/constants.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { appendProjectionEvent } from "../../../orchestrating-long-tasks/scripts/src/store/event-append.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/load.ts";
import {
  cloneObject,
  initialState,
} from "../../../orchestrating-long-tasks/scripts/src/store/state.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "store-event-append-"));
  roots.push(root);
  return root;
}

function freshRun(): { runRoot: string; manifest: Manifest } {
  const repo = scratchRoot();
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

describe("appendProjectionEvent checkpoints", () => {
  test("stores a patch (not a full projection) between checkpoints, and a full projection at the interval boundary", () => {
    const { runRoot, manifest } = freshRun();
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
    const { runRoot, manifest } = freshRun();
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
    const { runRoot, manifest } = freshRun();
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
});
