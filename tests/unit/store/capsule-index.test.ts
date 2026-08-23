import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "../../../olt/scripts/src/core/contracts/capsule.ts";
import {
  buildIndex,
  indexFreshness,
  loadIndex,
  refreshIndex,
  writeIndex,
} from "../../../olt/scripts/src/engine/store/capsule-index.ts";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";

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

describe("buildIndex", () => {
  test("indexes tasks, their findings, and derives open_finding_ids from unresolved status", () => {
    const root = scratchRoot("indexes-tasks-their-findings-and-derives-open-find");
    const state = baseState({
      tasks: {
        "T-2": {
          status: "in_progress",
          requirement_ids: ["R-1", 42],
          findings: [
            { id: "F-1", status: "open", requirement_id: "R-1", severity: "high" },
            { id: "F-2", status: "resolved" },
            "not-an-object",
            { status: "open" },
          ],
          validations: [
            { checks: [{ command_id: "C-1" }, { command_id: 5 }, "not-an-object"] },
            "not-an-object",
          ],
        },
        "T-1": {},
      },
    });
    const index = buildIndex(root, state, "run-1");
    expect(index.schema).toBe("harness.index");
    expect(index.run_id).toBe("run-1");
    expect(index.tasks.map((task) => task.id)).toEqual(["T-1", "T-2"]);
    const t2 = index.tasks.find((task) => task.id === "T-2")!;
    expect(t2.status).toBe("in_progress");
    expect(t2.requirement_ids).toEqual(["R-1"]);
    expect(t2.command_ids).toEqual(["C-1"]);
    expect(t2.finding_ids).toEqual(["F-1", "F-2"]);
    expect(t2.open_finding_ids).toEqual(["F-1"]);
    const t1 = index.tasks.find((task) => task.id === "T-1")!;
    expect(t1.status).toBe("unknown");
    expect(t1.requirement_ids).toEqual([]);
    expect(index.findings).toEqual([
      { id: "F-1", task_id: "T-2", requirement_id: "R-1", severity: "high", status: "open" },
      { id: "F-2", task_id: "T-2", status: "resolved" },
    ]);
  });

  test("returns empty tasks and findings when state.tasks is absent or not an object", () => {
    const root = scratchRoot("returns-empty-tasks-and-findings-when-state-tasks-");
    expect(buildIndex(root, baseState(), "run").tasks).toEqual([]);
    expect(buildIndex(root, baseState({ tasks: "nope" }), "run").tasks).toEqual([]);
  });

  test("indexes commands, skipping non-object entries and defaulting optional fields away", () => {
    const root = scratchRoot("indexes-commands-skipping-non-object-entries-and-d");
    const state = baseState({
      commands: {
        "C-2": { status: "succeeded", exit_code: 0, task_id: "T-1" },
        "C-1": "not-an-object",
      },
    });
    const index = buildIndex(root, state, "run");
    expect(index.commands).toEqual([
      { id: "C-2", path: "commands/C-2", status: "succeeded", exit_code: 0, task_id: "T-1" },
    ]);
  });

  test("returns no commands when state.commands is not an object", () => {
    const root = scratchRoot("returns-no-commands-when-state-commands-is-not-an-");
    expect(buildIndex(root, baseState({ commands: [] }), "run").commands).toEqual([]);
  });

  test("indexes packets, skipping entries missing role or agent_id", () => {
    const root = scratchRoot("indexes-packets-skipping-entries-missing-role-or-a");
    const state = baseState({
      packets: {
        "P-1": { role: "worker", agent_id: "A-1", task_id: "T-1" },
        "P-2": { role: "worker" },
        "P-3": { agent_id: "A-1" },
        "P-4": { role: "worker", agent_id: "A-2" },
      },
    });
    const index = buildIndex(root, state, "run");
    expect(index.packets).toEqual([
      { id: "P-1", role: "worker", agent_id: "A-1", task_id: "T-1", path: "packets/P-1" },
      { id: "P-4", role: "worker", agent_id: "A-2", task_id: null, path: "packets/P-4" },
    ]);
  });

  test("returns no packets when state.packets is not an object", () => {
    const root = scratchRoot("returns-no-packets-when-state-packets-is-not-an-ob");
    expect(buildIndex(root, baseState({ packets: 3 }), "run").packets).toEqual([]);
  });

  test("indexes reports/, attributing owner task ids and parsed round numbers from the file name", () => {
    const root = scratchRoot("indexes-reports-attributing-owner-task-ids-and-par");
    mkdirSync(join(root, "reports"));
    writeFileSync(join(root, "reports", "T-1-probe-02.json"), "{}");
    writeFileSync(join(root, "reports", "T-1-review.json"), "{}");
    writeFileSync(join(root, "reports", "not-json.txt"), "ignored");
    mkdirSync(join(root, "reports", "a-directory.json"));
    const state = baseState({ tasks: { "T-1": {} } });
    const index = buildIndex(root, state, "run");
    expect(index.reports).toEqual([
      {
        name: "T-1-probe-02.json",
        path: "reports/T-1-probe-02.json",
        bytes: 2,
        task_id: "T-1",
        round: 2,
      },
      { name: "T-1-review.json", path: "reports/T-1-review.json", bytes: 2, task_id: "T-1" },
    ]);
  });

  test("returns no reports when the reports directory does not exist", () => {
    const root = scratchRoot("returns-no-reports-when-the-reports-directory-does");
    expect(buildIndex(root, baseState(), "run").reports).toEqual([]);
  });

  test("skips a report entry whose stat fails, such as a dangling symlink", () => {
    const root = scratchRoot("skips-a-report-entry-whose-stat-fails-such-as-a-da");
    mkdirSync(join(root, "reports"));
    writeFileSync(join(root, "reports", "T-1-review.json"), "{}");
    symlinkSync(join(root, "reports", "missing-target"), join(root, "reports", "T-1-broken.json"));
    const index = buildIndex(root, baseState({ tasks: { "T-1": {} } }), "run");
    expect(index.reports.map((report) => report.name)).toEqual(["T-1-review.json"]);
  });

  test("returns no reports when reports/ exists but is not a directory", () => {
    const root = scratchRoot("returns-no-reports-when-reports-exists-but-is-not-");
    writeFileSync(join(root, "reports"), "not a directory");
    expect(buildIndex(root, baseState(), "run").reports).toEqual([]);
  });

  test("indexes captures with their reference counts across duplicate sha256 values", () => {
    const root = scratchRoot("indexes-captures-with-their-reference-counts-acros");
    writeFileSync(
      join(root, "captures.json"),
      JSON.stringify({
        captures: [
          {
            kind: "screenshot",
            name: "a.png",
            sha256: "a".repeat(64),
            bytes: 5,
            blob_path: `blobs/aa/${"a".repeat(64)}`,
            path: "evidence/a.png",
            storage: "hardlink",
            original_path: "/tmp/a.png",
            task_id: "T-1",
          },
          {
            kind: "screenshot",
            name: "b.png",
            sha256: "a".repeat(64),
            bytes: 5,
            blob_path: `blobs/aa/${"a".repeat(64)}`,
            path: "evidence/b.png",
            storage: "hardlink",
            original_path: "/tmp/b.png",
          },
        ],
      }),
    );
    const index = buildIndex(root, baseState(), "run");
    expect(index.captures).toHaveLength(2);
    expect(index.captures[0]).toMatchObject({ name: "a.png", task_id: "T-1" });
    expect(index.captures[1]).toMatchObject({ name: "b.png" });
    expect(index.captures[1]!.command_id).toBeUndefined();
    expect(index.index_of_captures).toHaveLength(64);
  });

  test("returns null index_of_captures when captures.json does not exist", () => {
    const root = scratchRoot("returns-null-index-of-captures-when-captures-json-");
    expect(buildIndex(root, baseState(), "run").index_of_captures).toBeNull();
  });

  test("indexes blobs with byte counts and zero references when uncaptured", () => {
    const root = scratchRoot("indexes-blobs-with-byte-counts-and-zero-references");
    const digest = "b".repeat(64);
    mkdirSync(join(root, "blobs", "bb"), { recursive: true });
    writeFileSync(join(root, "blobs", "bb", digest), "hello");
    const index = buildIndex(root, baseState(), "run");
    expect(index.blobs).toEqual([
      { sha256: digest, bytes: 5, path: `blobs/bb/${digest}`, references: 0 },
    ]);
  });

  test("carries the event sequence and head from state into index_of_event", () => {
    const root = scratchRoot("carries-the-event-sequence-and-head-from-state-int");
    const index = buildIndex(root, baseState({ event_sequence: 4, event_head: "deadbeef" }), "run");
    expect(index.index_of_event).toEqual({ sequence: 4, head: "deadbeef" });
  });
});

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

  test("does nothing when state.json is missing or malformed, swallowing the error", () => {
    const root = scratchRoot("does-nothing-when-state-json-is-missing-or-malform");
    expect(() => refreshIndex(root)).not.toThrow();
    writeFileSync(join(root, "state.json"), "not json");
    expect(() => refreshIndex(root)).not.toThrow();
  });
});
