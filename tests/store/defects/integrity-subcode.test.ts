import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { IntegrityIssue } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { verifyIntegrity } from "../../../olt/scripts/src/engine/store/integrity/integrity.ts";
import { issue } from "../../../olt/scripts/src/engine/store/integrity/issues.ts";
import { transact } from "../../../olt/scripts/src/engine/store/events/transaction.ts";
import {
  cleanupVirtualStoreFS,
  getVirtualStoreFS,
  scratchRoot,
  setupVirtualStoreFS,
} from "../store-fixture.ts";

function freshRun(label: string): string {
  const repo = scratchRoot(import.meta.path, label);
  return initRun(repo, "subcode-run", new TextEncoder().encode("prompt"), "file", true);
}

describe("IntegrityIssue subcode and issue helper", () => {
  test("issue helper constructs issue without subcode when omitted", () => {
    const item: IntegrityIssue = issue("STATE_PROJECTION", "mismatch");
    expect(item).toEqual({
      code: "STATE_PROJECTION",
      message: "mismatch",
    });
    expect(item.subcode).toBeUndefined();
  });

  test("issue helper constructs issue with subcode and path when provided", () => {
    const item: IntegrityIssue = issue("STATE_PROJECTION", "mismatch", "path/to/file", "READ_RACE");
    expect(item).toEqual({
      code: "STATE_PROJECTION",
      message: "mismatch",
      path: "path/to/file",
      subcode: "READ_RACE",
    });
  });
});

describe("verifyIntegrity READ_RACE discrimination", () => {
  beforeEach(() => {
    setupVirtualStoreFS();
  });

  afterEach(() => {
    cleanupVirtualStoreFS();
  });

  test("flags transient read race with subcode READ_RACE when state.json lags behind 1 event", () => {
    const vfs = getVirtualStoreFS();
    const runRoot = freshRun("lag-1-event");

    // Capture initial state before transaction
    const stateFile = join(runRoot, "state.json");
    const initialStateBytes = vfs.readFileSync(stateFile);

    // Mutate state to add event 1
    transact(runRoot, "test-actor", "test-kind", {}, (draft) => {
      draft.test_field = "value-1";
    });

    // Overwrite state.json with initial state (simulating read race where events.jsonl updated first)
    vfs.writeFileSync(stateFile, initialStateBytes);

    const issues = verifyIntegrity(runRoot);
    const projectionIssues = issues.filter((i) => i.code === "STATE_PROJECTION");
    expect(projectionIssues.length).toBe(1);
    expect(projectionIssues[0]?.subcode).toBe("READ_RACE");
  });

  test("flags transient read race with subcode READ_RACE when state.json lags behind multiple events", () => {
    const vfs = getVirtualStoreFS();
    const runRoot = freshRun("lag-multiple-events");
    const stateFile = join(runRoot, "state.json");

    // Event 1
    transact(runRoot, "test-actor", "event-1", {}, (draft) => {
      draft.step = 1;
    });
    const stateAfterEvent1 = vfs.readFileSync(stateFile);

    // Event 2 and 3
    transact(runRoot, "test-actor", "event-2", {}, (draft) => {
      draft.step = 2;
    });
    transact(runRoot, "test-actor", "event-3", {}, (draft) => {
      draft.step = 3;
    });

    // Reset state.json to state after event 1 (2 events behind)
    vfs.writeFileSync(stateFile, stateAfterEvent1);

    const issues = verifyIntegrity(runRoot);
    const projectionIssues = issues.filter((i) => i.code === "STATE_PROJECTION");
    expect(projectionIssues.length).toBe(1);
    expect(projectionIssues[0]?.subcode).toBe("READ_RACE");
  });

  test("does not set subcode on STATE_PROJECTION when state.json is deliberately corrupted with fake revision", () => {
    const vfs = getVirtualStoreFS();
    const runRoot = freshRun("corrupted-revision");
    vfs.writeFileSync(
      join(runRoot, "state.json"),
      canonicalJsonBytes({
        schema: "harness.state",
        version: 1,
        revision: 5,
        event_sequence: 0,
        event_head: null,
      }),
    );

    const issues = verifyIntegrity(runRoot);
    const projectionIssues = issues.filter((i) => i.code === "STATE_PROJECTION");
    expect(projectionIssues.length).toBe(1);
    expect(projectionIssues[0]?.subcode).toBeUndefined();
  });

  test("does not set subcode on STATE_PROJECTION when state.json contains tampered payload", () => {
    const vfs = getVirtualStoreFS();
    const runRoot = freshRun("tampered-payload");
    const stateFile = join(runRoot, "state.json");

    transact(runRoot, "test-actor", "event-1", {}, (draft) => {
      draft.task_count = 10;
    });

    // Read current state, tamper with a property while keeping revision and event_head
    const current = JSON.parse(vfs.readFileSync(stateFile, "utf8")) as JsonObject;
    current.task_count = 999;
    vfs.writeFileSync(stateFile, canonicalJsonBytes(current));

    const issues = verifyIntegrity(runRoot);
    const projectionIssues = issues.filter((i) => i.code === "STATE_PROJECTION");
    expect(projectionIssues.length).toBe(1);
    expect(projectionIssues[0]?.subcode).toBeUndefined();
  });

  test("does not set subcode on STATE_PROJECTION when state.json contains fake event_head digest", () => {
    const vfs = getVirtualStoreFS();
    const runRoot = freshRun("fake-head");
    const stateFile = join(runRoot, "state.json");

    transact(runRoot, "test-actor", "event-1", {}, (draft) => {
      draft.value = "real";
    });

    const current = JSON.parse(vfs.readFileSync(stateFile, "utf8")) as JsonObject;
    current.event_head = "0000000000000000000000000000000000000000000000000000000000000000";
    vfs.writeFileSync(stateFile, canonicalJsonBytes(current));

    const issues = verifyIntegrity(runRoot);
    const projectionIssues = issues.filter((i) => i.code === "STATE_PROJECTION");
    expect(projectionIssues.length).toBe(1);
    expect(projectionIssues[0]?.subcode).toBeUndefined();
  });

  test("does not set subcode READ_RACE when events.jsonl has corruption", () => {
    const vfs = getVirtualStoreFS();
    const runRoot = freshRun("events-corrupted");
    const eventsFile = join(runRoot, "events.jsonl");

    transact(runRoot, "test-actor", "event-1", {}, (draft) => {
      draft.value = "ok";
    });

    // Corrupt events.jsonl with a broken line
    vfs.writeFileSync(eventsFile, new TextEncoder().encode("bad json line\n"));

    const issues = verifyIntegrity(runRoot);
    const projectionIssues = issues.filter((i) => i.code === "STATE_PROJECTION");
    for (const issueItem of projectionIssues) {
      expect(issueItem.subcode).toBeUndefined();
    }
  });
});
