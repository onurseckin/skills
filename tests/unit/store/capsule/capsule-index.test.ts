import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  buildIndex,
  indexFreshness,
  loadIndex,
  refreshIndex,
  writeIndex,
} from "../../../../olt/scripts/src/engine/store/capsule/capsule-index.ts";
import { scratchRoot as makeScratchRoot } from "../../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

function baseState(overrides: Partial<RunState> & Record<string, unknown> = {}): RunState {
  return {
    schema: "harness.state",
    version: 1,
    revision: 0,
    event_sequence: 0,
    event_head: null,
    ...overrides,
  } as RunState;
}

describe("writeIndex", () => {
  test("writes index.json to disk and returns the same index it wrote", () => {
    const root = scratchRoot("writes-index-json-to-disk-and-returns-the-same-ind");
    const index = writeIndex(root, baseState(), "run-1");
    const onDisk = JSON.parse(readFileSync(join(root, "index.json"), "utf-8"));
    expect(onDisk.run_id).toBe("run-1");
    expect(index.run_id).toBe("run-1");
  });

  test("falls back to the manifest's run_id when none is given explicitly", () => {
    const root = scratchRoot("falls-back-to-the-manifest-s-run-id-when-none-is-g");
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ run_id: "from-manifest" }));
    const index = writeIndex(root, baseState());
    expect(index.run_id).toBe("from-manifest");
  });

  test("falls back to unknown when manifest.json is missing, malformed, or holds no run_id", () => {
    const root = scratchRoot("falls-back-to-unknown-when-manifest-json-is-missin");
    expect(writeIndex(root, baseState()).run_id).toBe("unknown");
    writeFileSync(join(root, "manifest.json"), "not json");
    expect(writeIndex(root, baseState()).run_id).toBe("unknown");
    writeFileSync(join(root, "manifest.json"), JSON.stringify([1, 2, 3]));
    expect(writeIndex(root, baseState()).run_id).toBe("unknown");
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ run_id: 5 }));
    expect(writeIndex(root, baseState()).run_id).toBe("unknown");
  });
});

describe("loadIndex", () => {
  test("loads a matching manifest and index pair from disk", () => {
    const root = scratchRoot("loads-a-matching-manifest-and-index-pair-from-disk");
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ run_id: "run-1" }));
    writeIndex(root, baseState(), "run-1");
    const loaded = loadIndex(root);
    expect(loaded.manifest.run_id).toBe("run-1");
    expect(loaded.index.run_id).toBe("run-1");
    expect(loaded.runRoot).toBe(root);
  });

  test("throws a HarnessError when manifest.json is unreadable", () => {
    const root = scratchRoot("throws-a-harnesserror-when-manifest-json-is-unread");
    expect(() => loadIndex(root)).toThrow(/manifest\.json is unreadable/);
  });

  test("throws a HarnessError when index.json is unreadable", () => {
    const root = scratchRoot("throws-a-harnesserror-when-index-json-is-unreadabl");
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ run_id: "run-1" }));
    expect(() => loadIndex(root)).toThrow(/index\.json is unreadable/);
  });

  test("throws a HarnessError when index.json parses but is not shaped like a capsule index", () => {
    const root = scratchRoot("throws-a-harnesserror-when-index-json-parses-but-i");
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ run_id: "run-1" }));
    writeFileSync(join(root, "index.json"), JSON.stringify({ schema: "not-the-index-schema" }));
    expect(() => loadIndex(root)).toThrow(/index\.json is not a capsule index/);
    writeFileSync(
      join(root, "index.json"),
      JSON.stringify({ schema: "harness.index", index_of_event: "not-an-object" }),
    );
    expect(() => loadIndex(root)).toThrow(/index\.json is not a capsule index/);
    writeFileSync(join(root, "index.json"), JSON.stringify(["array", "not", "object"]));
    expect(() => loadIndex(root)).toThrow(/index\.json is not a capsule index/);
  });
});

describe("indexFreshness", () => {
  test("returns current when the index matches state and the capture digest is unchanged", () => {
    const root = scratchRoot("returns-current-when-the-index-matches-state-and-t");
    const state = baseState({ event_sequence: 2, event_head: "abc" });
    writeFileSync(join(root, "state.json"), JSON.stringify(state));
    const index = buildIndex(root, state, "run");
    expect(indexFreshness(root, index)).toBe("current");
  });

  test("returns unknown when state.json is missing or not valid JSON", () => {
    const root = scratchRoot("returns-unknown-when-state-json-is-missing-or-not-");
    const index = buildIndex(root, baseState(), "run");
    expect(indexFreshness(root, index)).toBe("unknown");
    writeFileSync(join(root, "state.json"), "not json");
    expect(indexFreshness(root, index)).toBe("unknown");
  });

  test("returns unknown when state.json is not an object or has malformed sequence/head types", () => {
    const root = scratchRoot("returns-unknown-when-state-json-is-not-an-object-o");
    const index = buildIndex(root, baseState(), "run");
    writeFileSync(join(root, "state.json"), JSON.stringify([1, 2]));
    expect(indexFreshness(root, index)).toBe("unknown");
    writeFileSync(
      join(root, "state.json"),
      JSON.stringify({ event_sequence: "not-a-number", event_head: null }),
    );
    expect(indexFreshness(root, index)).toBe("unknown");
    writeFileSync(join(root, "state.json"), JSON.stringify({ event_sequence: 1, event_head: 5 }));
    expect(indexFreshness(root, index)).toBe("unknown");
  });

  test("returns stale when the sequence or head in state.json no longer matches the index", () => {
    const root = scratchRoot("returns-stale-when-the-sequence-or-head-in-state-j");
    const state = baseState({ event_sequence: 2, event_head: "abc" });
    const index = buildIndex(root, state, "run");
    writeFileSync(join(root, "state.json"), JSON.stringify({ ...state, event_sequence: 3 }));
    expect(indexFreshness(root, index)).toBe("stale");
  });

  test("returns stale when sequence and head match but the capture ledger digest has since changed", () => {
    const root = scratchRoot("returns-stale-when-sequence-and-head-match-but-the");
    const state = baseState({ event_sequence: 0, event_head: null });
    writeFileSync(join(root, "state.json"), JSON.stringify(state));
    const index = buildIndex(root, state, "run");
    writeFileSync(join(root, "captures.json"), JSON.stringify({ captures: [] }));
    expect(indexFreshness(root, index)).toBe("stale");
  });

  test("stays current when captures.json is rewritten with different key order and spacing but the same content", () => {
    const root = scratchRoot("stays-current-when-captures-json-is-rewritten-with");
    const state = baseState({ event_sequence: 0, event_head: null });
    writeFileSync(join(root, "state.json"), JSON.stringify(state));
    const ledger = {
      schema: "harness.captures",
      version: 1,
      captures: [],
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    writeFileSync(join(root, "captures.json"), JSON.stringify(ledger, null, 2));
    const index = buildIndex(root, state, "run");
    writeFileSync(
      join(root, "captures.json"),
      JSON.stringify({
        updated_at: ledger.updated_at,
        captures: ledger.captures,
        version: ledger.version,
        schema: ledger.schema,
      }),
    );
    expect(indexFreshness(root, index)).toBe("current");
  });
});

describe("refreshIndex", () => {
  test("rewrites index.json from the current state.json on disk", () => {
    const root = scratchRoot("rewrites-index-json-from-the-current-state-json-on");
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ run_id: "run-1" }));
    const state = baseState({ event_sequence: 1, event_head: "h" });
    writeFileSync(join(root, "state.json"), JSON.stringify(state));
    refreshIndex(root);
    const onDisk = JSON.parse(readFileSync(join(root, "index.json"), "utf-8"));
    expect(onDisk.index_of_event).toEqual({ sequence: 1, head: "h" });
    expect(onDisk.run_id).toBe("run-1");
  });

  test("throws instead of silently leaving index.json stale when state.json is missing or malformed", () => {
    const root = scratchRoot("throws-instead-of-silently-leaving-index-json-stal");
    expect(() => refreshIndex(root)).toThrow(/state\.json/);
    writeFileSync(join(root, "state.json"), "not json");
    expect(() => refreshIndex(root)).toThrow(/state\.json/);
  });
});
