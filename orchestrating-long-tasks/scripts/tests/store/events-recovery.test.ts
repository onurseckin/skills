import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "../../src/contracts/json.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../src/core/json.ts";
import { initRun } from "../../src/store/capsule.ts";
import { loadRun } from "../../src/store/load.ts";
import { recoverProjection } from "../../src/store/recovery.ts";
import { transact } from "../../src/store/transaction.ts";
import { verifyIntegrity } from "../../src/store/integrity.ts";

const messages = (issues: readonly { message: string }[]): string =>
  issues.map((issue) => issue.message).join("\n");

function init(): string {
  const root = mkdtempSync(join(tmpdir(), "harness-events-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  return initRun(repo, "run-001", new TextEncoder().encode("prompt"), "file", true);
}

function eventObjects(run: string): JsonObject[] {
  return readFileSync(join(run, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
}

describe("event stream and recovery", () => {
  test("test_transactions_advance_hash_chain_and_projection_together", () => {
    const run = init();
    const first = transact(
      run,
      "planner",
      "phase-started",
      { phase: "implementation" },
      (state) => {
        state.phase = "implementation";
      },
    );
    const second = transact(run, "builder", "work-recorded", { files: 2 }, (state) => {
      state.files_changed = 2;
    });
    const events = eventObjects(run);
    expect(events.map((event) => event.run_id)).toEqual(["run-001", "run-001"]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events.map((event) => event.revision)).toEqual([1, 2]);
    expect(events[0]!.previous_hash).toBeNull();
    expect(events[1]!.previous_hash).toBe(events[0]!.hash);
    for (const event of events) {
      const { hash, ...content } = event;
      expect(hash).toBe(sha256Bytes(canonicalJsonBytes(content)));
      expect("event_head" in (event.projection as JsonObject)).toBeFalse();
    }
    expect(first.event_head).toBe(events[0]!.hash);
    expect(second.event_head).toBe(events[1]!.hash);
    expect(loadRun(run).state).toEqual(second);
    expect(verifyIntegrity(run)).toEqual([]);
  });

  test("test_recovery_rebuilds_stale_state_from_last_complete_event", () => {
    const run = init();
    const expected = transact(run, "worker", "counter", { amount: 1 }, (state) => {
      state.counter = 1;
    });
    writeFileSync(
      join(run, "state.json"),
      canonicalJsonBytes({
        schema: "harness.state",
        version: 1,
        revision: 0,
        event_sequence: 0,
        event_head: null,
      }),
    );
    expect(messages(verifyIntegrity(run))).toMatch(/state/i);
    const recovered = recoverProjection(run, "recovery-agent");
    expect(recovered.counter).toBe(expected.counter);
    expect(recovered.event_sequence).toBe(expected.event_sequence + 1);
    expect(eventObjects(run).at(-1)).toMatchObject({
      actor: "recovery-agent",
      kind: "projection-recovered",
    });
    expect(verifyIntegrity(run)).toEqual([]);
  });

  test("test_corrupt_complete_event_is_rejected_by_verify_and_recovery", () => {
    const run = init();
    transact(run, "worker", "record", { valid: true }, (state) => {
      state.valid = true;
    });
    const event = eventObjects(run)[0]!;
    (event.payload as JsonObject).valid = false;
    writeFileSync(join(run, "events.jsonl"), new Uint8Array([...canonicalJsonBytes(event), 10]));
    expect(messages(verifyIntegrity(run))).toMatch(/hash/i);
    expect(() => recoverProjection(run, "recovery-agent")).toThrow(/integrity/i);
  });

  test("test_projection_shape_rejects_boolean_revision_even_with_valid_hash", () => {
    const run = init();
    transact(run, "worker", "record", {}, (state) => {
      state.valid = true;
    });
    const event = eventObjects(run)[0]!;
    (event.projection as JsonObject).revision = true;
    const { hash: _old, ...content } = event;
    event.hash = sha256Bytes(canonicalJsonBytes(content));
    writeFileSync(join(run, "events.jsonl"), new Uint8Array([...canonicalJsonBytes(event), 10]));
    writeFileSync(
      join(run, "state.json"),
      canonicalJsonBytes({ ...(event.projection as JsonObject), event_head: event.hash }),
    );
    expect(messages(verifyIntegrity(run))).toMatch(/projection revision/i);
    expect(() => recoverProjection(run, "recovery-agent")).toThrow();
  });

  test("test_recovery_quarantines_and_removes_only_a_torn_final_fragment", () => {
    const run = init();
    const expected = transact(run, "worker", "record", {}, (state) => {
      state.complete = true;
    });
    const torn = '{"schema":"harness.event"';
    appendFileSync(join(run, "events.jsonl"), torn);
    expect(messages(verifyIntegrity(run))).toMatch(/torn/i);
    const recovered = recoverProjection(run, "recovery-agent");
    expect(recovered.complete).toBe(expected.complete);
    expect(recovered.event_sequence).toBe(expected.event_sequence + 1);
    expect(readFileSync(join(run, "events.jsonl"), "utf8").endsWith(torn)).toBeFalse();
    expect(verifyIntegrity(run)).toEqual([]);
  });

  test("test_recovery_ignores_valid_final_event_without_newline", () => {
    const run = init();
    const expected = transact(run, "worker", "first", {}, (state) => {
      state.checkpoint = "first";
    });
    transact(run, "worker", "second", {}, (state) => {
      state.checkpoint = "second";
    });
    const path = join(run, "events.jsonl");
    const bytes = readFileSync(path);
    writeFileSync(path, bytes.subarray(0, bytes.length - 1));
    writeFileSync(join(run, "state.json"), '{"corrupt":true}');
    expect(messages(verifyIntegrity(run))).toMatch(/torn/i);
    const recovered = recoverProjection(run, "recovery-agent");
    expect(recovered.checkpoint).toBe(expected.checkpoint);
    expect(eventObjects(run).at(-1)).toMatchObject({ kind: "projection-recovered" });
  });

  test("test_deep_event_json_is_reported_as_integrity_error", () => {
    const run = init();
    writeFileSync(
      join(run, "events.jsonl"),
      `{"nested":${"[".repeat(2000)}0${"]".repeat(2000)}}\n`,
    );
    expect(messages(verifyIntegrity(run, { maxDepth: 128 }))).toMatch(/event line.*depth/i);
    expect(() => loadRun(run, true, { maxDepth: 128 })).toThrow();
  });

  test("test_event_validation_streams_multiple_records_without_read_bytes", () => {
    const run = init();
    for (let index = 0; index < 3; index += 1) {
      transact(run, "worker", "streamed", { sequence: index }, (state) => {
        state.last = index;
      });
    }
    expect(loadRun(run).events).toHaveLength(3);
    expect(verifyIntegrity(run)).toEqual([]);
  });

  test("test_oversized_event_is_bounded_without_path_read_bytes", () => {
    const run = init();
    writeFileSync(join(run, "events.jsonl"), `${"x".repeat(257)}\n`);
    expect(messages(verifyIntegrity(run, { maxEventBytes: 128 }))).toMatch(/size limit/i);
  });

  test("test_empty_event_log_cannot_fabricate_recovery_history", () => {
    expect(() => recoverProjection(init(), "recovery-agent")).toThrow(/no valid event/i);
  });

  test("rejects malformed complete event records instead of treating them as torn", () => {
    const run = init();
    writeFileSync(join(run, "events.jsonl"), "{not-json}\n");
    expect(messages(verifyIntegrity(run))).toMatch(/event line.*JSON/i);
    expect(() => recoverProjection(run, "recovery-agent")).toThrow(/integrity/i);
  });
});
