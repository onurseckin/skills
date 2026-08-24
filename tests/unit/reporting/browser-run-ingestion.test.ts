import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  browserRunPath,
  readBrowserRun,
} from "../../../olt/scripts/src/reporting/browser-run-store.ts";
import {
  browserRunHarness,
  cleanupTempDirs,
  runnerReport,
  tempDir,
  writeReport,
} from "./browser-run-fixture.ts";

afterEach(cleanupTempDirs);

describe("browser run ingestion", () => {
  test("records what the runner reported and what the harness measured, each labelled", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", runnerReport());

    const rec = harness.ingest(runRoot, repo);

    expect(rec?.browser).toBe("chromium");
    expect(rec?.viewport).toEqual({ width: 1440, height: 900 });
    expect(rec?.test_file).toBe("tests/e2e/login.spec.ts");
    expect(rec?.traces).toEqual(["/artifacts/trace.zip"]);
    expect(rec?.videos).toEqual(["/artifacts/session.webm"]);
    expect(rec?.duration_ms).toBe(1500);
    expect(rec?.status).toBe("passed");
    expect(rec?.category).toBe("browser-automation");
    expect(rec?.evidence_classes).toEqual({
      category: "derived",
      browser: "agent_reported",
      viewport: "agent_reported",
      test_file: "agent_reported",
      traces: "agent_reported",
      videos: "agent_reported",
      duration_ms: "harness_observed",
      status: "harness_observed",
    });
    // Written to disk under the store's own path convention.
    expect(readBrowserRun(runRoot, "C-1")?.browser).toBe("chromium");
  });

  test("a command with no exit code and no reported status has no status at all", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", runnerReport());

    const rec = harness.ingest(runRoot, repo, { exitCode: null, finishedAt: null });

    expect(rec?.status).toBeUndefined();
    expect(rec?.duration_ms).toBeUndefined();
    expect(rec?.evidence_classes.status).toBeUndefined();
  });

  test("the runner's own verdict outranks the exit code and is labelled as reported", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", runnerReport({ status: "timedOut" }));

    const rec = harness.ingest(runRoot, repo, { exitCode: 0 });

    expect(rec?.status).toBe("timedOut");
    expect(rec?.evidence_classes.status).toBe("agent_reported");
  });

  test("a failing exit status is recorded as the harness's own observation", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", runnerReport());

    const rec = harness.ingest(runRoot, repo, { exitCode: 1 });

    expect(rec?.status).toBe("failed");
    expect(rec?.evidence_classes.status).toBe("harness_observed");
  });

  test("a clock that ran backwards is not a duration", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", runnerReport());

    const rec = harness.ingest(runRoot, repo, {
      finishedAt: new Date(harness.startedMs - 60_000).toISOString(),
    });

    expect(rec?.browser).toBe("chromium");
    expect(rec?.duration_ms).toBeUndefined();
  });

  test("a run across several viewports names them all rather than picking one", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "playwright-report"), "report.json", {
      config: {
        projects: [
          { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
          { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
        ],
      },
      suites: [{ file: "tests/e2e/layout.spec.ts" }],
    });

    const rec = harness.ingest(runRoot, repo);

    expect(rec?.viewport).toBeUndefined();
    expect(rec?.viewports).toEqual([
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ]);
    expect(rec?.evidence_classes.viewports).toBe("agent_reported");
  });

  test("two projects on one viewport still record that single viewport", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", {
      config: {
        projects: [
          {
            name: "chromium",
            use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
          },
          {
            name: "firefox",
            use: { browserName: "firefox", viewport: { width: 1280, height: 800 } },
          },
        ],
      },
      suites: [{ file: "tests/e2e/cross.spec.ts" }],
    });

    const rec = harness.ingest(runRoot, repo);

    expect(rec?.viewport).toEqual({ width: 1280, height: 800 });
    expect(rec?.browser).toBeUndefined();
  });

  test("suites spread across files leave the test file unknown", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", {
      suites: [{ file: "tests/a.spec.ts" }, { file: "tests/b.spec.ts" }],
    });

    expect(harness.ingest(runRoot, repo)?.test_file).toBeUndefined();
  });

  test("the visual metrics report supplies viewports and whatever it named itself", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "visual-report.json", {
      viewports: { desktop: { width: 1512, height: 982, devicePixelRatio: 2 } },
      metadata: { runner: "gvui-visual-suite", browser: "chromium", testFile: "visual/home.ts" },
      layoutOverflows: [],
    });

    const rec = harness.ingest(runRoot, repo);

    expect(rec?.runner).toBe("gvui-visual-suite");
    expect(rec?.browser).toBe("chromium");
    expect(rec?.test_file).toBe("visual/home.ts");
    expect(rec?.viewport).toEqual({ width: 1512, height: 982 });
    expect(rec?.evidence_classes.runner).toBe("agent_reported");
  });

  test("refuses to record a run when the command left no report behind", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");

    expect(harness.ingest(runRoot, repo)).toBeNull();
    expect(existsSync(browserRunPath(runRoot, "C-1"))).toBe(false);
  });

  test("refuses to treat a command line that merely mentions a browser as a browser run", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");

    const rec = harness.ingest(runRoot, repo, {
      stdout: "running playwright chromium tests at 1280x720",
    });

    expect(rec).toBeNull();
  });

  test("reads a report the command printed the path of", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "artifacts"), "results.json", runnerReport());

    const rec = harness.ingest(runRoot, repo, { stdout: "wrote artifacts/results.json" });

    expect(rec?.browser).toBe("chromium");
  });

  test("reads a report handed to it explicitly, ignoring a blank entry in the same list", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    const path = writeReport(join(repo, "elsewhere"), "report.json", runnerReport());

    const rec = harness.ingest(runRoot, repo, { searchDirs: [], explicitPaths: [path, ""] });

    expect(rec?.report_path).toBe(path);
  });

  test("an explicit path that does not exist cannot be attributed to the command", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    const missing = join(repo, "nowhere", "report.json");

    const rec = harness.ingest(runRoot, repo, { searchDirs: [], explicitPaths: [missing] });

    expect(rec).toBeNull();
  });
});

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

  test("handles stdout candidate pointing to non-existent file during writtenByCommand check", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");

    const rec = harness.ingest(runRoot, repo, {
      stdout: "Report saved to /nonexistent/path/to/report.json",
      startedAt: new Date().toISOString(),
    });

    expect(rec).toBeNull();
  });
});
