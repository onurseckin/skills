import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { browserRunPath } from "../../../orchestrating-long-tasks/scripts/src/reporting/browser-run-store.ts";
import {
  browserRunHarness,
  cleanupTempDirs,
  runnerReport,
  tempDir,
  writeReport,
} from "./browser-run-fixture.ts";

afterEach(cleanupTempDirs);

/**
 * A runner leaves its report where the next runner would leave one, so the file alone proves
 * nothing about who wrote it. Only a report modified inside the window the harness watched the
 * command run belongs to that command; everything else is somebody else's run.
 *
 * Coverage gap, deliberate: the freshness check's stat failure branch stays unexercised. Both
 * scanners confirm a candidate is a readable file before they hand it over, so the only way to
 * reach that branch is a report deleted between discovery and the mtime read — a filesystem race no
 * single-threaded test can stage. The branch refuses rather than throwing, which is the safe side.
 */
describe("browser run freshness", () => {
  test("refuses a report an earlier suite left behind, whoever finds it later", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    const path = writeReport(join(repo, "test-results"), "report.json", runnerReport());
    harness.stampBeforeStart(path, 10 * 60 * 1000);

    expect(harness.ingest(runRoot, repo)).toBeNull();
    expect(existsSync(browserRunPath(runRoot, "C-1"))).toBe(false);
  });

  test("refuses a stale report even when the command printed its path", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    const path = writeReport(join(repo, "artifacts"), "results.json", runnerReport());
    harness.stampBeforeStart(path, 10 * 60 * 1000);

    expect(harness.ingest(runRoot, repo, { stdout: "wrote artifacts/results.json" })).toBeNull();
  });

  test("refuses a stale report handed to it explicitly", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    const path = writeReport(join(repo, "elsewhere"), "report.json", runnerReport());
    harness.stampBeforeStart(path, 10 * 60 * 1000);

    expect(harness.ingest(runRoot, repo, { searchDirs: [], explicitPaths: [path] })).toBeNull();
  });

  test("accepts a report written a moment before the recorded start", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    const path = writeReport(join(repo, "test-results"), "report.json", runnerReport());
    harness.stampBeforeStart(path, 500);

    expect(harness.ingest(runRoot, repo)?.browser).toBe("chromium");
  });

  test("refuses a report stamped after the command was already over", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    const path = writeReport(join(repo, "test-results"), "report.json", runnerReport());
    harness.stampAfterFinish(path, 10 * 60 * 1000);

    expect(harness.ingest(runRoot, repo)).toBeNull();
  });

  test("refuses every report when the harness has no start time to compare against", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", runnerReport());

    expect(harness.ingest(runRoot, repo, { startedAt: null })).toBeNull();
    expect(harness.ingest(runRoot, repo, { startedAt: "not a time" })).toBeNull();
  });
});
