import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestScreenshots } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-ingestion.ts";
import { queryScreenshots } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-store.ts";
import { readCaptures } from "../../../orchestrating-long-tasks/scripts/src/store/captures.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "screenshot-timestamp-"));
  roots.push(root);
  return root;
}

describe("a screenshot record never wears the harness's own clock", () => {
  test("an ingested file carries its mtime, not the moment the ingestion ran", () => {
    const root = runRoot();
    const source = join(root, "source");
    mkdirSync(source, { recursive: true });
    const file = join(source, "unrecorded.png");
    writeFileSync(file, "png-bytes", "utf-8");
    // A capture that happened well before this run.
    const captured = new Date("2026-08-15T19:00:00.000Z");
    utimesSync(file, captured, captured);

    ingestScreenshots({ runRoot: root, explicitPaths: [file] });
    const [record] = queryScreenshots(root, {});

    expect(record?.timestamp).toBe(statSync(file).mtime.toISOString());
    expect(record?.timestamp).toBe(captured.toISOString());
  });

  test("a capture whose stored bytes were deleted still reports only what was recorded", () => {
    const root = runRoot();
    const source = join(root, "source");
    mkdirSync(source, { recursive: true });
    const file = join(source, "vanishes.png");
    writeFileSync(file, "png-bytes", "utf-8");
    ingestScreenshots({ runRoot: root, explicitPaths: [file] });

    rmSync(join(root, "blobs"), { recursive: true, force: true });
    rmSync(join(root, "evidence"), { recursive: true, force: true });

    const [record] = queryScreenshots(root, {});

    expect(record?.name).toBe("vanishes.png");
    expect(record?.timestamp).toBe(readCaptures(root)[0]?.timestamp);
    expect(record?.command_id).toBeUndefined();
    expect(record?.task_id).toBeUndefined();
  });
});
