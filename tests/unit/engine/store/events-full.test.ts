import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { initRun } from "../../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { loadRun } from "../../../../olt/scripts/src/engine/store/capsule/load.ts";
import {
  appendProjectionEvent,
  readTransactionMarker,
  clearTransactionMarker,
  transactionRecoveryStatus,
} from "../../../../olt/scripts/src/engine/store/events/event-append.ts";
import {
  transact,
  transactIdempotent,
} from "../../../../olt/scripts/src/engine/store/events/transaction.ts";
import {
  validateProjection,
  validateProjectionPatch,
  exactInteger,
} from "../../../../olt/scripts/src/engine/store/events/event-validation.ts";
import {
  validateEventChain,
} from "../../../../olt/scripts/src/engine/store/events/event-stream.ts";
import {
  streamEventLines,
} from "../../../../olt/scripts/src/engine/store/events/event-lines.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../../olt/scripts/src/core/json.ts";

function makeTmpDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

describe("engine/store/events/event-validation.ts", () => {
  it("exactInteger validates integer matches", () => {
    expect(exactInteger(5, 5)).toBe(true);
    expect(exactInteger(5, 6)).toBe(false);
    expect(exactInteger("5", 5)).toBe(false);
    expect(exactInteger(5.5, 5.5)).toBe(false);
  });

  it("validateProjection catches invalid schema, version, revision, sequence", () => {
    expect(validateProjection(null, 1, 1, 1).length).toBe(1);
    expect(validateProjection([], 1, 1, 1).length).toBe(1);

    const badProj = {
      event_head: "circular",
      schema: "bad_schema",
      version: 99,
      revision: 2,
      event_sequence: 3,
    };
    const issues = validateProjection(badProj, 1, 1, 1);
    expect(issues.length).toBe(5);
  });

  it("validateProjectionPatch catches bad patch ops", () => {
    expect(validateProjectionPatch(null, 1).length).toBe(1);
    expect(validateProjectionPatch(["not-an-obj"], 1).length).toBe(1);
    expect(validateProjectionPatch([{ op: "unknown_op" }], 1).length).toBe(1);
    expect(validateProjectionPatch([{ op: "set", path: "invalid" }], 1).length).toBe(1);
  });
});

describe("engine/store/events/transaction.ts", () => {
  it("executes state transactions and appends events", () => {
    const tmp = makeTmpDir("transaction-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const runRoot = initRun(
        tmp,
        "test-run-tx",
        new TextEncoder().encode("prompt"),
        "file",
        true,
      );
      const loaded = loadRun(runRoot, false);

      const nextState = transact(
        runRoot,
        "worker",
        "task_created",
        { task_id: "task-1" },
        (state) => {
          state.tasks = {
            "task-1": {
              id: "task-1",
              status: "ready",
              requirement_ids: [],
            },
          };
        },
      );

      expect(nextState.tasks["task-1"]).toBeDefined();
      expect(nextState.revision).toBe(1);
      expect(nextState.event_sequence).toBe(1);

      // Stream lines and validate event chain
      const eventsPath = join(runRoot, "events.jsonl");
      const lines = Array.from(streamEventLines(eventsPath, 1024 * 1024, 64 * 1024 * 1024));
      expect(lines.length).toBe(1);

      const chain = validateEventChain(
        eventsPath,
        { runId: "test-run-tx", capsuleId: loaded.manifest.capsule_id },
        {},
        true,
        true,
      );
      expect(chain.events.length).toBe(1);

      // Mutating reserved keys throws
      expect(() =>
        transact(
          runRoot,
          "worker",
          "invalid_mutate",
          {},
          (state) => {
            (state as any).revision = 999;
          },
        ),
      ).toThrow(HarnessError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("transactIdempotent prevents duplicate commits", () => {
    const tmp = makeTmpDir("tx-idempotent-test-");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const runRoot = initRun(
        tmp,
        "test-run-idem",
        new TextEncoder().encode("prompt"),
        "file",
        true,
      );

      const body = {
        request_key: "req-1",
        content_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        version: 1,
        authority_actor: "coordinator",
        projection_destinations: ["spec.json"],
        schema: "harness.brainstorming",
      };
      const artifact_sha256 = sha256Bytes(canonicalJsonBytes(body));
      const document = { ...body, artifact_sha256 };

      const identity = {
        requestKey: "req-1",
        contentDigest: body.content_digest,
        semanticVersion: 1,
        authorityActor: "coordinator",
        destinations: ["spec.json"],
      };

      const res1 = transactIdempotent(
        runRoot,
        "coordinator",
        "brainstorm_committed",
        identity,
        { details: "v1" },
        (state) => {
          state.planning = {
            brainstorming: document,
          };
        },
      );
      expect(res1.already_committed).toBe(false);

      const res2 = transactIdempotent(
        runRoot,
        "coordinator",
        "brainstorm_committed",
        identity,
        { details: "v2" },
        (state) => {
          state.planning = {
            brainstorming: document,
          };
        },
      );
      expect(res2.already_committed).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
