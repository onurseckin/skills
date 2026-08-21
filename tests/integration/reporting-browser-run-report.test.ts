import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_BROWSER_REPORT_BYTES,
  readBrowserRunReport,
} from "../../orchestrating-long-tasks/scripts/src/reporting/browser-run-report.ts";
import {
  extractBrowserReportsFromText,
  findBrowserReportCandidates,
} from "../../orchestrating-long-tasks/scripts/src/reporting/browser-run-scanner.ts";
import {
  browserRunPath,
  queryBrowserRuns,
  readBrowserRun,
  writeBrowserRunRecord,
} from "../../orchestrating-long-tasks/scripts/src/reporting/browser-run-store.ts";
import type { BrowserRunRecord } from "../../orchestrating-long-tasks/scripts/src/reporting/browser-run-types.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `browser-report-${name}-`));
  roots.push(dir);
  return dir;
}

function writeReport(dir: string, name: string, body: unknown): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(body), "utf-8");
  return path;
}

function runnerReport(): Record<string, unknown> {
  return {
    config: {
      projects: [
        {
          name: "chromium",
          use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
        },
      ],
    },
    suites: [{ file: "tests/e2e/login.spec.ts" }],
  };
}

describe("browser report reading", () => {
  test("ignores JSON that is not a shape it understands", () => {
    const dir = tempDir("shape");
    const path = writeReport(dir, "report.json", { totallyDifferent: true });

    expect(readBrowserRunReport(path)).toBeUndefined();
  });

  test("ignores a report that parses but carries no fact", () => {
    const dir = tempDir("empty");
    const path = writeReport(dir, "report.json", { suites: [] });

    expect(readBrowserRunReport(path)).toBeUndefined();
  });

  test("ignores a file that is not JSON, and one that is not there", () => {
    const dir = tempDir("broken");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "report.json");
    writeFileSync(path, "not json at all", "utf-8");

    expect(readBrowserRunReport(path)).toBeUndefined();
    expect(readBrowserRunReport(join(dir, "missing.json"))).toBeUndefined();
  });

  test("ignores a JSON document that is an array rather than a report", () => {
    const dir = tempDir("array");
    const path = writeReport(dir, "report.json", [{ suites: [] }]);

    expect(readBrowserRunReport(path)).toBeUndefined();
  });

  test("refuses to read a report larger than the cap rather than parsing a fragment", () => {
    const dir = tempDir("huge");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "report.json");
    writeFileSync(path, `{"padding":"${"x".repeat(MAX_BROWSER_REPORT_BYTES)}"}`, "utf-8");

    expect(readBrowserRunReport(path)).toBeUndefined();
  });

  test("skips malformed viewports and attachments instead of inventing values", () => {
    const dir = tempDir("partial");
    const path = writeReport(dir, "report.json", {
      config: {
        projects: [
          { name: "broken", use: { viewport: { width: "wide", height: 900 } } },
          "not-a-project",
        ],
      },
      suites: [
        {
          file: "tests/e2e/a.spec.ts",
          specs: [{ tests: [{ results: [{ attachments: [{ name: "trace" }, "junk"] }] }] }],
        },
      ],
    });

    const facts = readBrowserRunReport(path);

    expect(facts?.viewport).toBeUndefined();
    expect(facts?.traces).toBeUndefined();
    expect(facts?.testFile).toBe("tests/e2e/a.spec.ts");
  });
});

describe("browser report discovery", () => {
  test("only known report file names count as candidates", () => {
    const repo = tempDir("discovery");
    writeReport(join(repo, "test-results"), "report.json", runnerReport());
    writeReport(join(repo, "test-results"), "coverage.json", { anything: true });

    const candidates = findBrowserReportCandidates([repo, join(repo, "missing")]);

    expect(candidates.some((path) => path.endsWith("report.json"))).toBe(true);
    expect(candidates.some((path) => path.endsWith("coverage.json"))).toBe(false);
  });

  test("a report nested under the results directory is found; skipped directories are not", () => {
    const repo = tempDir("nested");
    writeReport(join(repo, "test-results", "login-chromium"), "report.json", runnerReport());
    writeReport(join(repo, "test-results", "node_modules"), "report.json", runnerReport());
    writeReport(join(repo, "test-results", ".cache"), "report.json", runnerReport());

    const candidates = findBrowserReportCandidates([repo]);

    expect(candidates.some((path) => path.includes("login-chromium"))).toBe(true);
    expect(candidates.some((path) => path.includes("node_modules"))).toBe(false);
    expect(candidates.some((path) => path.includes(".cache"))).toBe(false);
  });

  test("a report at the search root itself is found", () => {
    const repo = tempDir("root-report");
    writeReport(repo, "results.json", runnerReport());

    expect(findBrowserReportCandidates([repo]).some((p) => p.endsWith("results.json"))).toBe(true);
  });

  test("a search root that is not a directory yields nothing rather than throwing", () => {
    const repo = tempDir("not-a-dir");
    mkdirSync(repo, { recursive: true });
    const filePath = join(repo, "test-results");
    writeFileSync(filePath, "this is a file, not a results directory", "utf-8");

    expect(findBrowserReportCandidates([repo, filePath])).toEqual([]);
  });

  test("a report path printed on stderr counts too", () => {
    const repo = tempDir("stderr");
    writeReport(join(repo, "artifacts"), "results.json", runnerReport());

    const candidates = findBrowserReportCandidates(
      [repo],
      undefined,
      "runner wrote artifacts/results.json",
    );

    expect(candidates.some((path) => path.endsWith("artifacts/results.json"))).toBe(true);
  });

  test("a printed path that names no existing file is not a candidate", () => {
    const repo = tempDir("phantom");

    expect(extractBrowserReportsFromText("see test-results/report.json", repo)).toEqual([]);
    expect(extractBrowserReportsFromText("")).toEqual([]);
  });
});

describe("browser run records", () => {
  function record(overrides: Partial<BrowserRunRecord> = {}): BrowserRunRecord {
    return {
      command_id: "C-1",
      task_id: "T-1",
      status: "passed",
      evidence_classes: { status: "harness_observed" },
      ...overrides,
    };
  }

  test("re-running a command replaces its run rather than stacking a second one", () => {
    const runRoot = tempDir("manifest");
    writeBrowserRunRecord(runRoot, record());
    writeBrowserRunRecord(runRoot, record({ status: "failed" }));

    expect(queryBrowserRuns(runRoot)).toHaveLength(1);
    expect(readBrowserRun(runRoot, "C-1")?.status).toBe("failed");
  });

  test("queries match on the recorded ids only", () => {
    const runRoot = tempDir("query");
    writeBrowserRunRecord(runRoot, record());
    writeBrowserRunRecord(runRoot, record({ command_id: "C-2", task_id: "T-2" }));

    expect(queryBrowserRuns(runRoot, { commandId: "C-2" })).toHaveLength(1);
    expect(queryBrowserRuns(runRoot, { taskId: "T-1" })).toHaveLength(1);
    expect(queryBrowserRuns(runRoot, { taskId: "T-9" })).toHaveLength(0);
    expect(queryBrowserRuns(runRoot)).toHaveLength(2);
  });

  test("an unreadable or malformed record yields no run rather than throwing", () => {
    const runRoot = tempDir("malformed");
    expect(readBrowserRun(runRoot, "C-1")).toBeUndefined();

    mkdirSync(join(runRoot, "commands", "C-1"), { recursive: true });
    writeFileSync(browserRunPath(runRoot, "C-1"), "{", "utf-8");
    expect(readBrowserRun(runRoot, "C-1")).toBeUndefined();
    expect(queryBrowserRuns(runRoot)).toEqual([]);
  });

  test("an entry that names no command is dropped, and one with no classes still loads", () => {
    const runRoot = tempDir("entries");
    mkdirSync(join(runRoot, "commands", "C-2"), { recursive: true });
    writeFileSync(browserRunPath(runRoot, "C-2"), JSON.stringify({ status: "passed" }), "utf-8");
    mkdirSync(join(runRoot, "commands", "C-3"), { recursive: true });
    writeFileSync(
      browserRunPath(runRoot, "C-3"),
      JSON.stringify({ command_id: "C-3", status: "passed" }),
      "utf-8",
    );

    const runs = queryBrowserRuns(runRoot);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.command_id).toBe("C-3");
    expect(runs[0]?.evidence_classes).toEqual({});
  });
});
