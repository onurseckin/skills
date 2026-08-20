import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/load.ts";
import {
  CAPSULE_LAYOUT,
  isDeclaredCapsuleEntry,
} from "../../../orchestrating-long-tasks/scripts/src/store/layout.ts";
import { undeclaredEntries } from "../../../orchestrating-long-tasks/scripts/src/store/layout-integrity.ts";
import { ingestScreenshots } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-ingestion.ts";
import { readCaptures } from "../../../orchestrating-long-tasks/scripts/src/store/captures.ts";
import { listBlobs } from "../../../orchestrating-long-tasks/scripts/src/store/blobs.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "capsule-layout-"));
  roots.push(root);
  const path = join(root, "repo");
  mkdirSync(path);
  return path;
}

function capsule(runId = "run-layout"): string {
  return initRun(repo(), runId, new TextEncoder().encode("prompt\n"), "file", true);
}

function everyFile(root: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...everyFile(path, `${prefix}${entry.name}/`));
    else if (entry.isFile()) found.push(`${prefix}${entry.name}`);
  }
  return found;
}

function image(repoRoot: string, name: string, body: string): string {
  const directory = join(repoRoot, "test-results");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, body, "utf-8");
  return path;
}

describe("the capsule holds each thing exactly once, and says where each thing lives", () => {
  test("every declared entry carries a one-line responsibility, and the README states it", () => {
    const run = capsule();
    const readme = readFileSync(join(run, "README.md"), "utf-8");

    for (const entry of CAPSULE_LAYOUT) {
      expect(entry.responsibility.length).toBeGreaterThan(0);
      // One line, in prose a reader who has never opened the source can act on.
      expect(entry.responsibility).not.toContain("\n");
      expect(entry.responsibility.endsWith(".")).toBeTrue();
      expect(readme).toContain(entry.name);
      expect(readme).toContain(entry.responsibility);
    }
  });

  test("a fresh capsule declares everything it contains, and contains nothing undeclared", () => {
    const run = capsule();

    for (const name of readdirSync(run)) expect(isDeclaredCapsuleEntry(name)).toBeTrue();
    expect(undeclaredEntries(run)).toEqual([]);
    // The directories the old layout created and nothing ever filled are gone.
    expect(isDeclaredCapsuleEntry("findings")).toBeFalse();
    expect(isDeclaredCapsuleEntry(".lock")).toBeFalse();
  });

  test("no captured byte is stored twice, however many times it is rediscovered", () => {
    const run = capsule("run-dedupe");
    const repoRoot = join(run, "..", "..");
    const shot = image(repoRoot, "panel.png", "the-same-pixels");
    const copy = image(repoRoot, "panel-copy.png", "the-same-pixels");

    // The rescan every command performs, several commands over.
    for (const commandId of ["C-1", "C-2", "C-3"]) {
      ingestScreenshots({ runRoot: run, commandId, explicitPaths: [shot, copy] });
    }

    const blobs = listBlobs(run);
    expect(blobs).toHaveLength(1);
    expect(readCaptures(run)).toHaveLength(1);

    // Nothing under the capsule holds those bytes a second time. A hardlinked name shares an inode
    // with the blob, so a second name is not a second copy.
    const blobStat = statSync(join(run, blobs[0]!.path));
    const holdingThoseBytes = everyFile(run).filter(
      (path) => readFileSync(join(run, path), "utf-8") === "the-same-pixels",
    );
    expect(holdingThoseBytes.length).toBeGreaterThanOrEqual(2);
    for (const path of holdingThoseBytes) {
      const metadata = statSync(join(run, path));
      expect(metadata.ino).toBe(blobStat.ino);
      expect(metadata.dev).toBe(blobStat.dev);
    }
  });

  test("a capture record names one blob, and the blob is the only place the bytes live", () => {
    const run = capsule("run-one-home");
    const repoRoot = join(run, "..", "..");
    ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      explicitPaths: [image(repoRoot, "one.png", "one"), image(repoRoot, "two.png", "two")],
    });

    const captures = readCaptures(run);
    expect(captures).toHaveLength(2);
    for (const capture of captures) {
      expect(capture.blob_path).toBe(`blobs/${capture.sha256.slice(0, 2)}/${capture.sha256}`);
      // Records carry capsule-relative paths, so a capsule stays readable after it is moved.
      expect(relative(run, join(run, capture.path))).toBe(capture.path);
      expect(capture.path.startsWith("evidence/")).toBeTrue();
    }
    expect(listBlobs(run)).toHaveLength(2);
  });

  test("the step trace gains one row per recorded event and reads in order", () => {
    const run = capsule("run-trace");
    transact(run, "coordinator", "plan-compiled", { task_id: "T-1" }, (state) => {
      state.value = 1;
    });
    transact(
      run,
      "validator-1",
      "review-recorded",
      { task_id: "T-1", verdict: "pass" },
      (state) => {
        state.value = 2;
      },
    );

    const rows = readFileSync(join(run, "trace.md"), "utf-8")
      .split("\n")
      .filter((line) => /^\| \d+ \|/u.test(line));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("| 1 |");
    expect(rows[0]).toContain("plan-compiled");
    expect(rows[0]).toContain("T-1");
    expect(rows[1]).toContain("review-recorded");
    expect(rows[1]).toContain("pass");
  });

  test("a step whose payload names no subject and no outcome says unknown, not nothing", () => {
    const run = capsule("run-trace-unknown");
    transact(run, "coordinator", "run-opened", {}, (state) => {
      state.value = 1;
    });

    const row = readFileSync(join(run, "trace.md"), "utf-8")
      .split("\n")
      .find((line) => line.startsWith("| 1 |"));

    expect(row).toContain("| unknown | unknown |");
  });

  test("the projection is still the authority the load path verifies", () => {
    const run = capsule("run-authority");
    transact(run, "coordinator", "plan-compiled", { task_id: "T-1" }, (state) => {
      state.value = 1;
    });

    expect(loadRun(run).state.value).toBe(1);
  });
});
