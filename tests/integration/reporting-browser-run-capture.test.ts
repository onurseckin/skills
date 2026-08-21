import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { browserRunPath } from "../../orchestrating-long-tasks/scripts/src/reporting/browser-run-store.ts";
import {
  browserRunHarness,
  cleanupTempDirs,
  runnerReport,
  tempDir,
  writeReport,
} from "../unit/reporting/browser-run-fixture.ts";

afterEach(cleanupTempDirs);

describe("browser run capture", () => {
  test("records what the runner reported and what the harness measured, each labelled", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", runnerReport());

    const record = harness.ingest(runRoot, repo);

    expect(record?.browser).toBe("chromium");
    expect(record?.viewport).toEqual({ width: 1440, height: 900 });
    expect(record?.test_file).toBe("tests/e2e/login.spec.ts");
    expect(record?.traces).toEqual(["/artifacts/trace.zip"]);
    expect(record?.videos).toEqual(["/artifacts/session.webm"]);
    expect(record?.duration_ms).toBe(1500);
    expect(record?.status).toBe("passed");
    expect(record?.task_id).toBe("T-1");
    expect(record?.actor).toBe("validator-1");
    expect(record?.category).toBe("browser-automation");
    expect(record?.evidence_classes).toEqual({
      category: "derived",
      browser: "agent_reported",
      viewport: "agent_reported",
      test_file: "agent_reported",
      traces: "agent_reported",
      videos: "agent_reported",
      duration_ms: "harness_observed",
      status: "harness_observed",
    });
  });

  test("screenshots stay out of the run record; evidence has one home", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", runnerReport());

    const record = harness.ingest(runRoot, repo);

    expect(JSON.stringify(record)).not.toContain("shot.png");
  });

  test("a field no report carried stays absent instead of taking a default viewport", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", {
      suites: [{ file: "tests/e2e/smoke.spec.ts" }],
    });

    const record = harness.ingest(runRoot, repo);

    expect(record?.test_file).toBe("tests/e2e/smoke.spec.ts");
    expect(record?.viewport).toBeUndefined();
    expect(record?.viewports).toBeUndefined();
    expect(record?.browser).toBeUndefined();
    expect(record?.runner).toBeUndefined();
    expect(record?.traces).toBeUndefined();
    expect(record?.videos).toBeUndefined();
    expect(record?.evidence_classes.viewport).toBeUndefined();
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

    const record = harness.ingest(runRoot, repo);

    expect(record?.viewport).toBeUndefined();
    expect(record?.viewports).toEqual([
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ]);
    expect(record?.evidence_classes.viewports).toBe("agent_reported");
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

    const record = harness.ingest(runRoot, repo);

    expect(record?.viewport).toEqual({ width: 1280, height: 800 });
    // Two browsers ran; naming either one would misreport the other.
    expect(record?.browser).toBeUndefined();
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

  test("the runner's own verdict outranks the exit code and is labelled as reported", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", runnerReport({ status: "timedOut" }));

    const record = harness.ingest(runRoot, repo, { exitCode: 0 });

    expect(record?.status).toBe("timedOut");
    expect(record?.evidence_classes.status).toBe("agent_reported");
  });

  test("a failing exit status is recorded as the harness's own observation", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", runnerReport());

    const record = harness.ingest(runRoot, repo, { exitCode: 1 });

    expect(record?.status).toBe("failed");
    expect(record?.evidence_classes.status).toBe("harness_observed");
  });

  test("a command with no exit code and no reported status has no status at all", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", runnerReport());

    const record = harness.ingest(runRoot, repo, { exitCode: null, finishedAt: null });

    expect(record?.status).toBeUndefined();
    expect(record?.duration_ms).toBeUndefined();
    expect(record?.evidence_classes.status).toBeUndefined();
    expect(record?.evidence_classes.duration_ms).toBeUndefined();
  });

  test("a clock that ran backwards is not a duration", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "test-results"), "report.json", runnerReport());

    const record = harness.ingest(runRoot, repo, {
      finishedAt: new Date(harness.startedMs - 60_000).toISOString(),
    });

    // The run is still recorded; only the impossible measurement is withheld.
    expect(record?.browser).toBe("chromium");
    expect(record?.duration_ms).toBeUndefined();
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

    const record = harness.ingest(runRoot, repo);

    expect(record?.runner).toBe("gvui-visual-suite");
    expect(record?.browser).toBe("chromium");
    expect(record?.test_file).toBe("visual/home.ts");
    expect(record?.viewport).toEqual({ width: 1512, height: 982 });
    expect(record?.evidence_classes.runner).toBe("agent_reported");
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

    const record = harness.ingest(runRoot, repo, {
      stdout: "running playwright chromium tests at 1280x720",
    });

    expect(record).toBeNull();
  });

  test("reads a report the command printed the path of", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    writeReport(join(repo, "artifacts"), "results.json", runnerReport());

    const record = harness.ingest(runRoot, repo, { stdout: "wrote artifacts/results.json" });

    expect(record?.browser).toBe("chromium");
  });

  test("reads a report handed to it explicitly", () => {
    const harness = browserRunHarness();
    const runRoot = tempDir("run");
    const repo = tempDir("repo");
    const path = writeReport(join(repo, "elsewhere"), "report.json", runnerReport());

    const record = harness.ingest(runRoot, repo, { searchDirs: [], explicitPaths: [path, ""] });

    expect(record?.report_path).toBe(path);
  });
});
