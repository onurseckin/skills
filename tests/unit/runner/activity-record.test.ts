import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityRecord } from "../../../olt/scripts/src/engine/runner/activity-record.ts";

const roots: string[] = [];

function scratchDir(): string {
  const root = mkdtempSync(join(tmpdir(), "activity-record-"));
  roots.push(root);
  return root;
}

function readRecord(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("ActivityRecord", () => {
  test("persists an initial running record on construction", () => {
    const directory = scratchDir();
    const startedAt = "2026-08-19T00:00:00.000Z";
    const record = new ActivityRecord(directory, "C-1", 1, startedAt, 1_000);
    expect(record.path).toBe(join(directory, "activity.json"));
    const persisted = readRecord(record.path);
    expect(persisted).toEqual({
      schema: "harness.command-activity",
      version: 1,
      command_id: "C-1",
      attempt: 1,
      status: "running",
      started_at: startedAt,
      heartbeat_at: startedAt,
      last_output_at: null,
      stdout_bytes: 0,
      stderr_bytes: 0,
    });
  });

  test("heartbeat within the interval does not rewrite the persisted heartbeat time", () => {
    const directory = scratchDir();
    const startedAt = "2026-08-19T00:00:00.000Z";
    const record = new ActivityRecord(directory, "C-1", 1, startedAt, 1_000);
    record.heartbeat(new Date("2026-08-19T00:00:00.500Z"));
    expect(readRecord(record.path).heartbeat_at).toBe(startedAt);
  });

  test("heartbeat after the interval elapses advances the persisted heartbeat time", () => {
    const directory = scratchDir();
    const startedAt = "2026-08-19T00:00:00.000Z";
    const record = new ActivityRecord(directory, "C-1", 1, startedAt, 1_000);
    const later = new Date("2026-08-19T00:00:02.000Z");
    record.heartbeat(later);
    expect(readRecord(record.path).heartbeat_at).toBe(later.toISOString());
  });

  test("output tracks per-channel byte totals and the last output timestamp", () => {
    const directory = scratchDir();
    const startedAt = "2026-08-19T00:00:00.000Z";
    const record = new ActivityRecord(directory, "C-1", 1, startedAt, 0);
    const first = new Date("2026-08-19T00:00:01.000Z");
    record.output("stdout", 10, first);
    const second = new Date("2026-08-19T00:00:02.000Z");
    record.output("stderr", 5, second);
    const persisted = readRecord(record.path);
    expect(persisted.stdout_bytes).toBe(10);
    expect(persisted.stderr_bytes).toBe(5);
    expect(persisted.last_output_at).toBe(second.toISOString());
  });

  test("complete persists a terminal status with a finished_at timestamp", () => {
    const directory = scratchDir();
    const startedAt = "2026-08-19T00:00:00.000Z";
    const record = new ActivityRecord(directory, "C-1", 1, startedAt, 1_000);
    const finishedAt = new Date("2026-08-19T00:00:05.000Z");
    record.complete("failed", finishedAt);
    const persisted = readRecord(record.path);
    expect(persisted.status).toBe("failed");
    expect(persisted.finished_at).toBe(finishedAt.toISOString());
    expect(persisted.heartbeat_at).toBe(finishedAt.toISOString());
  });

  test("complete defaults to a completed status", () => {
    const directory = scratchDir();
    const record = new ActivityRecord(directory, "C-1", 1, "2026-08-19T00:00:00.000Z", 1_000);
    record.complete(undefined, new Date("2026-08-19T00:00:01.000Z"));
    expect(readRecord(record.path).status).toBe("completed");
  });
});
