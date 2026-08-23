import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ingestScreenshots,
  ingestVisualReport,
} from "../../../olt/scripts/src/reporting/screenshot-ingestion.ts";
import { queryScreenshots } from "../../../olt/scripts/src/reporting/screenshot-store.ts";
import { listBlobs } from "../../../olt/scripts/src/store/blobs.ts";
import { readCaptures } from "../../../olt/scripts/src/store/captures.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): { run: string; shots: string } {
  const root = mkdtempSync(join(tmpdir(), "screenshot-ingest-"));
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

describe("ingestScreenshots", () => {
  test("attributes a file written while the command ran", () => {
    const { run, shots } = workspace();
    image(shots, "during.png", "fresh", new Date("2026-08-19T12:00:05.000Z"));

    const [rec] = ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      taskId: "T-1",
      actor: "worker-1",
      searchDirs: [shots],
      startedAt: COMMAND_START,
    });

    expect(rec?.command_id).toBe("C-1");
    expect(rec?.task_id).toBe("T-1");
    expect(rec?.actor).toBe("worker-1");
    expect(rec?.storage).toBe("hardlink");
  });

  test("stores a stale file the command merely scanned but claims it for nobody", () => {
    const { run, shots } = workspace();
    image(shots, "stale.png", "old", new Date("2026-08-01T00:00:00.000Z"));

    const [rec] = ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      taskId: "T-1",
      actor: "worker-1",
      searchDirs: [shots],
      startedAt: COMMAND_START,
    });

    expect(rec?.name).toBe("stale.png");
    expect(rec?.command_id).toBeUndefined();
    expect(queryScreenshots(run, { commandId: "C-1" })).toEqual([]);
  });

  test("a stale file the command printed the path of is claimed anyway", () => {
    const { run, shots } = workspace();
    const path = image(shots, "cited.png", "old", new Date("2026-08-01T00:00:00.000Z"));

    const [rec] = ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      searchDirs: [shots],
      stdout: `wrote ${path}\n`,
      startedAt: COMMAND_START,
    });

    expect(rec?.command_id).toBe("C-1");
  });

  test("a path the caller named explicitly is attributed even predating the command", () => {
    const { run, shots } = workspace();
    const path = image(shots, "named.png", "old", new Date("2026-08-01T00:00:00.000Z"));

    const [rec] = ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      explicitPaths: [path],
      startedAt: COMMAND_START,
    });

    expect(rec?.command_id).toBe("C-1");
  });

  test("with no startedAt at all, a merely-scanned file is stored but claimed by nobody", () => {
    const { run, shots } = workspace();
    image(shots, "no-window.png", "bytes", new Date("2020-01-01T00:00:00.000Z"));

    const [rec] = ingestScreenshots({ runRoot: run, commandId: "C-1", searchDirs: [shots] });

    expect(rec?.name).toBe("no-window.png");
    expect(rec?.command_id).toBeUndefined();
  });

  test("one stale image is ingested once no matter how many commands scan it", () => {
    const { run, shots } = workspace();
    image(shots, "repo-root.png", "one-image", new Date("2026-08-01T00:00:00.000Z"));

    const perCommand = ["C-1", "C-2", "C-3"].map(
      (commandId) =>
        ingestScreenshots({
          runRoot: run,
          commandId,
          searchDirs: [shots],
          startedAt: COMMAND_START,
        }).length,
    );

    expect(perCommand).toEqual([1, 0, 0]);
    expect(readCaptures(run)).toHaveLength(1);
    expect(listBlobs(run)).toHaveLength(1);
  });

  test("two files with identical bytes collapse to one capture under the first name", () => {
    const { run, shots } = workspace();
    const first = image(shots, "a.png", "identical");
    const second = image(shots, "b.png", "identical");

    const ingested = ingestScreenshots({ runRoot: run, explicitPaths: [first, second] });

    expect(ingested).toHaveLength(1);
    expect(ingested[0]?.name).toBe("a.png");
  });

  test("two distinct files sharing a basename get a disambiguated view name", () => {
    const { run, shots } = workspace();
    const nested = join(shots, "nested");
    mkdirSync(nested, { recursive: true });
    const first = image(shots, "shot.png", "content-one");
    const second = join(nested, "shot.png");
    writeFileSync(second, "content-two", "utf-8");

    const ingested = ingestScreenshots({ runRoot: run, explicitPaths: [first, second] });

    expect(ingested).toHaveLength(2);
    const names = ingested.map((entry) => entry.name);
    expect(names).toContain("shot.png");
    expect(names.some((name) => /^shot-[0-9a-f]{8}\.png$/.test(name))).toBe(true);
  });

  test("a filename with unsafe characters is sanitised in the stored view name", () => {
    const { run, shots } = workspace();
    const path = image(shots, "a b#c.png", "bytes");

    const [rec] = ingestScreenshots({ runRoot: run, explicitPaths: [path] });

    expect(rec?.name).toBe("a_b_c.png");
  });

  test("a candidate that cannot be read is skipped rather than recorded", () => {
    const { run, shots } = workspace();
    const unreadable = image(shots, "locked.png", "pixels");
    chmodSync(unreadable, 0o000);

    let ingested: unknown[] = [];
    try {
      ingested = ingestScreenshots({ runRoot: run, searchDirs: [shots] });
    } finally {
      chmodSync(unreadable, 0o644);
    }

    expect(ingested).toEqual([]);
    expect(readCaptures(run)).toEqual([]);
  });

  test("a blob that is stored but cannot be linked into its view is skipped", () => {
    const { run, shots } = workspace();
    const path = image(shots, "shot.png", "some-bytes");
    // Blocks linkBlobIntoView's own mkdirSync(viewDirectory) with an ENOTDIR.
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "evidence"), "not-a-directory", "utf-8");

    const ingested = ingestScreenshots({ runRoot: run, explicitPaths: [path] });

    expect(ingested).toEqual([]);
    // The blob itself was still stored even though the view link failed.
    expect(listBlobs(run)).toHaveLength(1);
  });

  test("an unparseable start time bounds nothing rather than dropping the capture", () => {
    const { run, shots } = workspace();
    image(shots, "whenever.png", "bytes", new Date("2026-08-01T00:00:00.000Z"));

    const [rec] = ingestScreenshots({
      runRoot: run,
      commandId: "C-1",
      searchDirs: [shots],
      startedAt: "not-a-timestamp",
    });

    expect(rec?.command_id).toBe("C-1");
  });

  test("a scan that names no command records what it finds without claiming it", () => {
    const { run, shots } = workspace();
    image(shots, "found.png", "bytes", new Date("2020-01-01T00:00:00.000Z"));

    const [rec] = ingestScreenshots({
      runRoot: run,
      taskId: "T-1",
      actor: "val-1",
      searchDirs: [shots],
    });

    expect(rec?.name).toBe("found.png");
    expect(rec?.task_id).toBeUndefined();
    expect(rec?.actor).toBeUndefined();
  });

  test("nothing to ingest records nothing and writes no ledger", () => {
    const { run, shots } = workspace();

    expect(ingestScreenshots({ runRoot: run, searchDirs: [shots] })).toEqual([]);
    expect(readCaptures(run)).toEqual([]);
    expect(listBlobs(run)).toEqual([]);
  });

  test("captures the file's own mtime rather than the moment ingestion ran", () => {
    const { run, shots } = workspace();
    const captured = new Date("2026-08-15T19:00:00.000Z");
    image(shots, "timed.png", "bytes", captured);

    const [rec] = ingestScreenshots({ runRoot: run, searchDirs: [shots] });

    expect(rec?.timestamp).toBe(captured.toISOString());
  });

  test("a malformed, non-array explicitPaths cannot crash ingestion; it just finds nothing", () => {
    const { run, shots } = workspace();
    // Bridges a value the type system forbids in through the one seam that accepts it, the way a
    // caller deserializing untrusted input at a boundary might. discoverScreenshotCandidates has
    // no try/catch of its own around this loop, so a non-iterable here must be caught by the
    // outer ingestScreenshots try/catch instead of propagating.
    const explicitPaths = {} as unknown as string[];

    expect(ingestScreenshots({ runRoot: run, searchDirs: [shots], explicitPaths })).toEqual([]);
  });
});

describe("ingestVisualReport", () => {
  function report(shots: string, name: string, body: unknown): string {
    const path = join(shots, name);
    writeFileSync(path, JSON.stringify(body), "utf-8");
    return path;
  }

  test("ingests the first attributable, well-formed report it finds", () => {
    const { run, shots } = workspace();
    report(shots, "visual-report.json", {
      viewports: { desktop: { width: 1440, height: 900 } },
      metadata: { runner: "gvui" },
    });

    const result = ingestVisualReport({
      runRoot: run,
      commandId: "C-1",
      searchDirs: [shots],
      startedAt: COMMAND_START,
    });

    expect(result?.viewports).toEqual({ desktop: { width: 1440, height: 900 } });
    const [stored] = readCaptures(run);
    expect(stored?.kind).toBe("visual_report");
    expect(stored?.command_id).toBe("C-1");
  });

  test("attributes an explicitly named report even when it predates the command", () => {
    const { run, shots } = workspace();
    const path = report(shots, "visual-report.json", {
      viewports: {},
      layoutOverflows: [{ element: "div", scrollWidth: 1, clientWidth: 1, delta: 0 }],
    });

    const result = ingestVisualReport({
      runRoot: run,
      commandId: "C-1",
      explicitPaths: [path],
      startedAt: COMMAND_START,
    });

    expect(result).not.toBeNull();
    expect(readCaptures(run)[0]?.command_id).toBe("C-1");
  });

  test("a report cited in stdout is attributed to the command", () => {
    const { run, shots } = workspace();
    const path = report(shots, "visual-report.json", {
      viewports: {},
      collisions: [{ elements: ["a"] }],
    });

    const result = ingestVisualReport({
      runRoot: run,
      commandId: "C-1",
      searchDirs: [shots],
      stdout: `wrote ${path}`,
      startedAt: COMMAND_START,
    });

    expect(result).not.toBeNull();
    expect(readCaptures(run)[0]?.command_id).toBe("C-1");
  });

  test("returns null when no candidate report exists", () => {
    const { run, shots } = workspace();
    expect(ingestVisualReport({ runRoot: run, searchDirs: [shots] })).toBeNull();
  });

  test("skips a candidate with unparseable JSON and tries the next one", () => {
    const { run, shots } = workspace();
    writeFileSync(join(shots, "visual-report.json"), "{not json", "utf-8");
    report(shots, "second-visual-report.json", { viewports: { d: { width: 1, height: 1 } } });

    const result = ingestVisualReport({ runRoot: run, searchDirs: [shots] });

    expect(result?.viewports).toEqual({ d: { width: 1, height: 1 } });
  });

  test("skips a candidate that parses to something normalizeVisualReport rejects", () => {
    const { run, shots } = workspace();
    writeFileSync(join(shots, "visual-report.json"), "[1,2,3]", "utf-8");
    report(shots, "second-visual-report.json", { viewports: { d: { width: 1, height: 1 } } });

    const result = ingestVisualReport({ runRoot: run, searchDirs: [shots] });

    expect(result?.viewports).toEqual({ d: { width: 1, height: 1 } });
  });

  test("still returns the parsed report even when persisting the capture fails", () => {
    const { run, shots } = workspace();
    report(shots, "visual-report.json", { viewports: { d: { width: 1, height: 1 } } });
    // Blocks putBlobFile's own mkdirSync(blobs staging dir) with an ENOTDIR.
    writeFileSync(join(run, "blobs"), "not-a-directory", "utf-8");

    const result = ingestVisualReport({ runRoot: run, searchDirs: [shots] });

    expect(result?.viewports).toEqual({ d: { width: 1, height: 1 } });
    expect(readCaptures(run)).toEqual([]);
  });

  test("a report with no startedAt and no citation is stored but claimed by nobody", () => {
    const { run, shots } = workspace();
    report(shots, "visual-report.json", { viewports: { d: { width: 1, height: 1 } } });

    const result = ingestVisualReport({ runRoot: run, commandId: "C-1", searchDirs: [shots] });

    expect(result).not.toBeNull();
    expect(readCaptures(run)[0]?.command_id).toBeUndefined();
  });

  test("a second, distinct visual report gets a disambiguated view name rather than colliding", () => {
    const { run, shots } = workspace();
    report(shots, "visual-report.json", { viewports: { d: { width: 1, height: 1 } } });
    ingestVisualReport({
      runRoot: run,
      commandId: "C-1",
      explicitPaths: [join(shots, "visual-report.json")],
    });

    const second = join(shots, "second");
    mkdirSync(second, { recursive: true });
    report(second, "visual-report.json", { viewports: { e: { width: 2, height: 2 } } });
    ingestVisualReport({
      runRoot: run,
      commandId: "C-2",
      explicitPaths: [join(second, "visual-report.json")],
    });

    const names = readCaptures(run).map((entry) => entry.name);
    expect(names).toHaveLength(2);
    expect(names).toContain("visual-report.json");
    expect(names.some((name) => name !== "visual-report.json" && name.endsWith(".json"))).toBe(
      true,
    );
  });

  test("when every candidate is unusable, the search is exhausted and null is returned", () => {
    const { run, shots } = workspace();
    writeFileSync(join(shots, "visual-report.json"), "{not json", "utf-8");

    expect(ingestVisualReport({ runRoot: run, searchDirs: [shots] })).toBeNull();
  });

  test("a malformed, non-array explicitPaths cannot crash the search; it just finds nothing", () => {
    const { run, shots } = workspace();
    // Same bridged-value technique as the ingestScreenshots case above: findVisualReportCandidates
    // has no try/catch of its own around this loop, so the outer ingestVisualReport try/catch must
    // absorb the throw instead of letting it propagate.
    const explicitPaths = {} as unknown as string[];

    expect(ingestVisualReport({ runRoot: run, searchDirs: [shots], explicitPaths })).toBeNull();
  });
});
