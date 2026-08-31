import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "../../../olt/scripts/src/core/contracts/index.ts";
import { buildIndex } from "../../../olt/scripts/src/engine/store/capsule/capsule-index.ts";
import { scratchRoot as makeScratchRoot } from "../../shared/scratch-root.ts";

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
