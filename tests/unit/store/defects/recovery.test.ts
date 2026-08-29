import { describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../../olt/scripts/src/core/json.ts";
import { initRun } from "../../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/events/transaction.ts";
import { recoverProjection } from "../../../../olt/scripts/src/engine/store/recovery/recovery.ts";
import { TRANSACTION_MARKER_FILE } from "../../../../olt/scripts/src/engine/store/events/event-append.ts";
import { scratchRoot } from "../../../support/scratch-root.ts";

function makeTempDir(label: string): string {
  return scratchRoot(import.meta.path, label);
}

function freshRun(label: string): string {
  const repo = makeTempDir(label);
  return initRun(repo, "recovery-run", new TextEncoder().encode("prompt"), "file", true);
}

describe("recoverProjection", () => {
  test("rejects a blank actor", () => {
    const runRoot = freshRun("blank-actor");
    expect(() => recoverProjection(runRoot, "   ")).toThrow(/actor must be a non-blank string/);
  });

  test("rejects a run_root that is not a real directory", () => {
    const root = makeTempDir("not-a-directory");
    const file = join(root, "not-a-directory");
    writeFileSync(file, "x");
    expect(() => recoverProjection(file, "actor")).toThrow(/run_root must be a real directory/);
  });

  test("throws an integrity error when the manifest itself is broken", () => {
    const runRoot = freshRun("broken-manifest");
    rmSync(join(runRoot, "manifest.json"));
    expect(() => recoverProjection(runRoot, "actor")).toThrow(HarnessError);
  });

  test("throws when the event chain has no valid event to recover from", () => {
    const runRoot = freshRun("empty-events");
    writeFileSync(join(runRoot, "events.jsonl"), "");
    expect(() => recoverProjection(runRoot, "actor")).toThrow(
      /cannot recover state because there is no valid event/,
    );
  });

  test("throws an integrity error when the event chain contains a genuine defect", () => {
    const runRoot = freshRun("invalid-json-events");
    writeFileSync(join(runRoot, "events.jsonl"), "not valid json at all\n");
    expect(() => recoverProjection(runRoot, "actor")).toThrow(HarnessError);
  });

  test("recovers cleanly from a valid, untorn event chain by appending a recovery event", () => {
    const runRoot = freshRun("clean-recovery");
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    const recovered = recoverProjection(runRoot, "recovery-actor");
    expect(recovered.event_sequence).toBe(2);
    expect(existsSync(join(runRoot, "quarantine"))).toBe(false);
  });

  test("quarantines and truncates a torn tail, then appends a recovery event referencing it", () => {
    const runRoot = freshRun("torn-tail");
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    const completeBytes = statSync(join(runRoot, "events.jsonl")).size;
    appendFileSync(join(runRoot, "events.jsonl"), '{"not":"terminated"');
    const recovered = recoverProjection(runRoot, "recovery-actor");
    expect(recovered.event_sequence).toBe(2);
    const quarantineDir = join(runRoot, "quarantine");
    expect(existsSync(quarantineDir)).toBe(true);
    const fragments = readdirSync(quarantineDir).filter((name) =>
      name.startsWith("recovery-torn-"),
    );
    expect(fragments).toHaveLength(1);
    const eventsContent = readFileSync(join(runRoot, "events.jsonl"), "utf-8");
    expect(eventsContent.includes('"not":"terminated"')).toBe(false);
    expect(statSync(join(runRoot, "events.jsonl")).size).toBeGreaterThan(completeBytes);
  });

  test("creates the quarantine directory even when a prior run already left one behind", () => {
    const runRoot = freshRun("existing-quarantine");
    mkdirSync(join(runRoot, "quarantine"), { recursive: true, mode: 0o755 });
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    appendFileSync(join(runRoot, "events.jsonl"), '{"not":"terminated"');
    expect(() => recoverProjection(runRoot, "recovery-actor")).not.toThrow();
  });

  test("does not treat a missing state.json as unrecoverable, only a state.json that is not a regular file", () => {
    const runRoot = freshRun("missing-state-json");
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    rmSync(join(runRoot, "state.json"));
    expect(() => recoverProjection(runRoot, "actor")).not.toThrow();
  });

  test("throws when state.json exists but is not a regular file", () => {
    const runRoot = freshRun("state-json-not-regular-file");
    rmSync(join(runRoot, "state.json"));
    mkdirSync(join(runRoot, "state.json"));
    expect(() => recoverProjection(runRoot, "actor")).toThrow(/state\.json is not a regular file/);
  });

  test("rebuilds state and every derived projection from a committed marker without a duplicate event", () => {
    const runRoot = freshRun("committed-marker-recovery");
    rmSync(join(runRoot, "trace.md"));
    mkdirSync(join(runRoot, "trace.md"));
    expect(() =>
      transact(runRoot, "tester", "task-created", {}, (draft) => {
        (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
      }),
    ).toThrow(/recovery pending/);
    expect(readFileSync(join(runRoot, "events.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
    rmSync(join(runRoot, "trace.md"), { recursive: true });
    const recovered = recoverProjection(runRoot, "recovery-actor");
    expect(recovered.event_sequence).toBe(1);
    expect(existsSync(join(runRoot, TRANSACTION_MARKER_FILE))).toBe(false);
    expect(readFileSync(join(runRoot, "events.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
    expect(readFileSync(join(runRoot, "trace.md"), "utf8")).toContain("task-created");
    expect(existsSync(join(runRoot, "index.json"))).toBe(true);
  });

  test("fails closed when a marker cannot identify the canonical chain head", () => {
    const runRoot = freshRun("ambiguous-marker");
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    const manifest = JSON.parse(readFileSync(join(runRoot, "manifest.json"), "utf8")) as {
      run_id: string;
      capsule_id: string;
    };
    writeFileSync(
      join(runRoot, TRANSACTION_MARKER_FILE),
      canonicalJsonBytes({
        schema: "harness.transaction",
        version: 1,
        run_id: manifest.run_id,
        capsule_id: manifest.capsule_id,
        sequence: 1,
        event_hash: "0".repeat(64),
        phase: "PROJECTIONS_PENDING",
      }),
    );
    expect(() => recoverProjection(runRoot, "recovery-actor")).toThrow(
      /invalid \.transaction\.json schema/,
    );
    expect(existsSync(join(runRoot, TRANSACTION_MARKER_FILE))).toBe(true);
  });

  test("fails closed for a stale or unknown materialized projection marker before changing files", () => {
    const runRoot = freshRun("unknown-projection-marker");
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    const manifest = JSON.parse(readFileSync(join(runRoot, "manifest.json"), "utf8")) as {
      run_id: string;
      capsule_id: string;
    };
    const [event] = readFileSync(join(runRoot, "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { hash: string });
    const stateBefore = readFileSync(join(runRoot, "state.json"));
    writeFileSync(
      join(runRoot, TRANSACTION_MARKER_FILE),
      canonicalJsonBytes({
        schema: "harness.transaction",
        version: 1,
        run_id: manifest.run_id,
        capsule_id: manifest.capsule_id,
        sequence: 1,
        event_hash: event!.hash,
        phase: "PROJECTIONS_PENDING",
        request_key: sha256Bytes(canonicalJsonBytes({})),
        payload_sha256: sha256Bytes(canonicalJsonBytes({})),
        semantic_schema: "",
        semantic_version: 0,
        authority_actor: "tester",
        artifact_sha256: null,
        materialized_projections: [{ path: "unknown.json", sha256: "0".repeat(64) }],
      }),
    );
    expect(() => recoverProjection(runRoot, "recovery")).toThrow(/materialized projections/);
    expect(readFileSync(join(runRoot, "state.json"))).toEqual(stateBefore);
    expect(existsSync(join(runRoot, TRANSACTION_MARKER_FILE))).toBe(true);
  });
});
