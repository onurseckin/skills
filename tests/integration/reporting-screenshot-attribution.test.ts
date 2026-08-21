import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestScreenshots } from "../../orchestrating-long-tasks/scripts/src/reporting/screenshot-ingestion.ts";
import { queryScreenshots } from "../../orchestrating-long-tasks/scripts/src/reporting/screenshot-store.ts";
import { readCaptures } from "../../orchestrating-long-tasks/scripts/src/store/captures.ts";
import { listBlobs } from "../../orchestrating-long-tasks/scripts/src/store/blobs.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): { run: string; shots: string } {
  const root = mkdtempSync(join(tmpdir(), "screenshot-attribution-"));
  roots.push(root);
  const run = join(root, "run");
  const shots = join(root, "repo", "test-results");
  mkdirSync(run, { recursive: true });
  mkdirSync(shots, { recursive: true });
  return { run, shots };
}

function image(shots: string, name: string, body: string, mtime?: Date): string {
  const path = join(shots, name);
  writeFileSync(path, body, "utf-8");
  if (mtime) utimesSync(path, mtime, mtime);
  return path;
}

const COMMAND_START = "2026-08-19T12:00:00.000Z";

describe("a command may only claim the captures there is evidence it produced", () => {
  test("a file written while the command ran belongs to it", () => {
    const { run, shots } = workspace();
    image(shots, "during.png", "fresh", new Date("2026-08-19T12:00:05.000Z"));

    const [record] = ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      taskId: "T-1",
      actor: "worker-1",
      searchDirs: [shots],
      startedAt: COMMAND_START,
    });

    expect(record?.command_id).toBe("C-1");
    expect(record?.task_id).toBe("T-1");
    expect(record?.actor).toBe("worker-1");
  });

  test("a stale file the command merely happened to scan is stored but claimed by nobody", () => {
    const { run, shots } = workspace();
    image(shots, "stale.png", "old", new Date("2026-08-01T00:00:00.000Z"));

    const [record] = ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      taskId: "T-1",
      actor: "worker-1",
      searchDirs: [shots],
      startedAt: COMMAND_START,
    });

    expect(record?.name).toBe("stale.png");
    expect(record?.command_id).toBeUndefined();
    expect(record?.task_id).toBeUndefined();
    expect(record?.actor).toBeUndefined();
    expect(queryScreenshots(run, { commandId: "C-1" })).toEqual([]);
    expect(queryScreenshots(run, { taskId: "T-1" })).toEqual([]);
  });

  test("a stale file the command printed the path of is the command's own claim", () => {
    const { run, shots } = workspace();
    const path = image(shots, "cited.png", "old", new Date("2026-08-01T00:00:00.000Z"));

    const [record] = ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      searchDirs: [shots],
      stdout: `wrote ${path}\n`,
      startedAt: COMMAND_START,
    });

    expect(record?.command_id).toBe("C-1");
  });

  test("a path the caller named is attributed even when the file predates the command", () => {
    const { run, shots } = workspace();
    const path = image(shots, "named.png", "old", new Date("2026-08-01T00:00:00.000Z"));

    const [record] = ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      explicitPaths: [path],
      startedAt: COMMAND_START,
    });

    expect(record?.command_id).toBe("C-1");
  });

  test("one stale image is not re-ingested once per command, however many commands scan it", () => {
    const { run, shots } = workspace();
    image(shots, "repo-root.png", "one-image", new Date("2026-08-01T00:00:00.000Z"));

    const perCommand = ["C-1", "C-2", "C-3", "C-4"].map(
      (commandId) =>
        ingestScreenshots({
          runRoot: run,
          commandId,
          searchDirs: [shots],
          startedAt: COMMAND_START,
        }).length,
    );

    // Recorded once by the first scan; every later scan of the same bytes adds nothing.
    expect(perCommand).toEqual([1, 0, 0, 0]);
    expect(readCaptures(run)).toHaveLength(1);
    expect(listBlobs(run)).toHaveLength(1);
  });

  test("two files holding identical bytes are one capture, under one name", () => {
    const { run, shots } = workspace();
    const first = image(shots, "a.png", "identical");
    const second = image(shots, "b.png", "identical");

    const ingested = ingestScreenshots({ runRoot: run, explicitPaths: [first, second] });

    expect(ingested).toHaveLength(1);
    expect(ingested[0]?.name).toBe("a.png");
    expect(listBlobs(run)).toHaveLength(1);
  });

  test("a candidate that cannot be read is skipped rather than recorded as an empty capture", () => {
    const { run, shots } = workspace();
    mkdirSync(join(shots, "notafile.png"));
    const unreadable = image(shots, "locked.png", "pixels");
    chmodSync(unreadable, 0o000);

    const ingested = ingestScreenshots({ runRoot: run, searchDirs: [shots] });
    chmodSync(unreadable, 0o644);

    expect(ingested).toEqual([]);
    expect(readCaptures(run)).toEqual([]);
  });

  test("an unparseable start time bounds nothing rather than dropping every capture", () => {
    const { run, shots } = workspace();
    image(shots, "whenever.png", "bytes", new Date("2026-08-01T00:00:00.000Z"));

    const [record] = ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      searchDirs: [shots],
      startedAt: "not-a-timestamp",
    });

    // The harness could not read its own clock here; refusing to record the capture would lose
    // evidence, and inventing a window would be worse than having none.
    expect(record?.command_id).toBe("C-1");
  });

  test("a candidate whose mtime cannot be read is not attributed to the command", () => {
    const { run, shots } = workspace();
    const missing = join(shots, "vanished.png");

    const ingested = ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      explicitPaths: [missing],
      startedAt: COMMAND_START,
    });

    expect(ingested).toEqual([]);
  });

  test("a scan that ran no command records what it finds without claiming it", () => {
    const { run, shots } = workspace();
    image(shots, "found.png", "bytes", new Date("2020-01-01T00:00:00.000Z"));

    // What a task-level sweep of the repository looks like: an owner named, no window, no path
    // named, nothing printed. Finding a file is not evidence of having produced it.
    const [record] = ingestScreenshots({
      runRoot: run,
      taskId: "T-1",
      actor: "val-1",
      searchDirs: [shots],
    });

    expect(record?.name).toBe("found.png");
    expect(record?.task_id).toBeUndefined();
    expect(record?.actor).toBeUndefined();
    expect(queryScreenshots(run, { taskId: "T-1" })).toEqual([]);
  });

  test("nothing to ingest records nothing and writes no ledger", () => {
    const { run, shots } = workspace();

    expect(ingestScreenshots({ runRoot: run, searchDirs: [shots] })).toEqual([]);
    expect(readCaptures(run)).toEqual([]);
    expect(listBlobs(run)).toEqual([]);
  });
});
