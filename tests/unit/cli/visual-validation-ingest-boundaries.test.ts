import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./file-persistence-fixture.ts";
import { createMockScreenshot } from "./visual-validation-fixture.ts";
import { getVisualReport } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-store.ts";
import {
  ingestScreenshots,
  ingestVisualReport,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-ingestion.ts";
import { listBlobs } from "../../../orchestrating-long-tasks/scripts/src/store/blobs.ts";
import { readCaptures } from "../../../orchestrating-long-tasks/scripts/src/store/captures.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Automated Visual Validation - Ingestion & Report Boundaries", () => {
  test("boundary: a report that is not an object is not recorded, and reads back as absent", async () => {
    const { repo, run } = await setupCompiledRun("visual-fallback-schemas", roots);
    const source = join(repo, "test-results", "visual-report.json");

    createMockScreenshot(join(repo, "test-results"), "visual-report.json", '["invalid","array"]');
    expect(ingestVisualReport({ runRoot: run, explicitPaths: [source] })).toBeNull();
    expect(getVisualReport(run)).toBeNull();

    writeFileSync(source, '"string-primitive"', "utf-8");
    expect(ingestVisualReport({ runRoot: run, explicitPaths: [source] })).toBeNull();
    expect(getVisualReport(run)).toBeNull();

    writeFileSync(source, "{}", "utf-8");
    expect(ingestVisualReport({ runRoot: run, explicitPaths: [source] })).not.toBeNull();
    const normalized = getVisualReport(run);
    expect(normalized).not.toBeNull();
    expect(normalized?.layoutOverflows).toEqual([]);
    expect(normalized?.textClippings).toEqual([]);
    expect(normalized?.collisions).toEqual([]);
    expect(typeof normalized?.viewports).toBe("object");
  });

  test("boundary: duplicate explicitPaths do not cause redundant filesystem writes", async () => {
    const { repo, run } = await setupCompiledRun("visual-dup-explicit", roots);
    const imgPath = createMockScreenshot(join(repo, "test-results"), "dup-test.png", "raw-bytes");

    const ingested = ingestScreenshots({
      runRoot: run,
      commandId: "cmd-dup",
      explicitPaths: [imgPath, imgPath, join(repo, "test-results", "dup-test.png")],
    });
    expect(ingested.length).toBe(1);

    expect(readCaptures(run).filter((s) => s.name === "dup-test.png")).toHaveLength(1);
    expect(listBlobs(run)).toHaveLength(1);
  });

  test("boundary: re-scanning unchanged bytes records nothing; changed bytes are a new capture", async () => {
    const { repo, run } = await setupCompiledRun("visual-rescan", roots);
    const source = join(repo, "test-results");
    createMockScreenshot(source, "static.png", "initial-data");

    expect(ingestScreenshots({ runRoot: run, searchDirs: [source] })).toHaveLength(1);
    // The rescan every command performs must not re-ingest what is already stored.
    expect(ingestScreenshots({ runRoot: run, searchDirs: [source] })).toHaveLength(0);
    expect(listBlobs(run)).toHaveLength(1);

    writeFileSync(join(source, "static.png"), "modified-data", "utf-8");
    expect(ingestScreenshots({ runRoot: run, searchDirs: [source] })).toHaveLength(1);
    expect(listBlobs(run)).toHaveLength(2);
    expect(readCaptures(run)).toHaveLength(2);
  });

  test("boundary: getVisualReport returns null when the run recorded no visual report", async () => {
    const { run } = await setupCompiledRun("visual-no-report", roots);
    expect(getVisualReport(run)).toBeNull();
  });
});
