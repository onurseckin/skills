import { beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { ingestBrowserRun } from "../../../olt/scripts/src/reporting/browser-run-ingestion.ts";
import { readBrowserRunReport } from "../../../olt/scripts/src/reporting/browser-run-report.ts";
import { buildNodeBrowserTests } from "../../../olt/scripts/src/summary/formatters/index.ts";
import { buildNodeScripts } from "../../../olt/scripts/src/summary/markdown/index.ts";
import { makeCommand } from "../reporters/dag/graph-fixtures.ts";
import { setupVirtualSummaryFS } from "../fixture.ts";

let rootCounter = 0;

beforeEach(() => {
  setupVirtualSummaryFS();
});

function tempRoot(name: string): string {
  rootCounter += 1;
  const root = `/virtual/${name}-${rootCounter}`;
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function writeReport(dir: string, body: unknown): string {
  const path = join(dir, "report.json");
  fs.writeFileSync(path, JSON.stringify(body));
  return path;
}

describe("a recorded command carries what the caller declared it was", () => {
  test("the category, the tool and the extras reach the graph labelled as reported", () => {
    const [script] = buildNodeScripts([
      makeCommand("C-1", {
        tool_category: "test-runner",
        tool: "the-suite",
        tool_extras: { shard: "2/4" },
      }),
    ]);

    expect(script?.category).toBe("test-runner");
    expect(script?.tool).toBe("the-suite");
    expect(script?.extras).toEqual({ shard: "2/4" });
    expect(script?.evidence_class).toBe("harness_observed");
    expect(script?.evidence).toEqual({
      category: "agent_reported",
      tool: "agent_reported",
      extras: "agent_reported",
    });
  });

  test("a command nobody described carries no category and no tool at all", () => {
    const [script] = buildNodeScripts([makeCommand("C-2", { argv: ["some-runner", "test"] })]);

    expect(script?.category).toBeUndefined();
    expect(script?.tool).toBeUndefined();
    expect(script?.extras).toBeUndefined();
    expect(script?.evidence).toBeUndefined();
  });

  test("a category declared without a tool is still recorded, and only it is labelled", () => {
    const [script] = buildNodeScripts([makeCommand("C-3", { tool_category: "type-checker" })]);

    expect(script?.category).toBe("type-checker");
    expect(script?.tool).toBeUndefined();
    expect(script?.evidence).toEqual({ category: "agent_reported" });
  });
});

describe("a browser run is one instance of a generic category", () => {
  test("the category follows from how the report was read, so it is derived", () => {
    const root = tempRoot("browser-category");
    const repo = tempRoot("browser-category-repo");
    writeReport(join(repo, "test-results"), {
      runner: "some-runner",
      suites: [{ file: "tests/browser/login.spec.ts" }],
    });

    const record = ingestBrowserRun({
      runRoot: root,
      commandId: "C-1",
      searchDirs: [repo],
      startedAt: new Date(Date.now() - 1000).toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0,
    });

    expect(record?.category).toBe("browser-automation");
    expect(record?.evidence_classes.category).toBe("derived");
    expect(record?.runner).toBe("some-runner");
  });

  test("what the report said beyond the generic fields is kept under its own names", () => {
    const root = tempRoot("browser-extras");
    const repo = tempRoot("browser-extras-repo");
    writeReport(join(repo, "test-results"), {
      runner: "some-runner",
      traceFormat: "zip",
      shard: 2,
      retried: false,
      suites: [{ file: "tests/browser/login.spec.ts" }],
    });

    const record = ingestBrowserRun({
      runRoot: root,
      commandId: "C-1",
      searchDirs: [repo],
      startedAt: new Date(Date.now() - 1000).toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0,
    });

    expect(record?.extras).toEqual({ traceFormat: "zip", shard: 2, retried: false });
    expect(record?.evidence_classes.extras).toBe("agent_reported");

    const [graphRun] = buildNodeBrowserTests([makeCommand("C-1")], root);
    expect(graphRun?.category).toBe("browser-automation");
    expect(graphRun?.extras).toEqual({ traceFormat: "zip", shard: 2, retried: false });
    expect(graphRun?.evidence.category).toBe("derived");
  });

  test("a nested value is not flattened into an extra nobody reported", () => {
    const repo = tempRoot("browser-extras-nested");
    const path = writeReport(repo, {
      runner: "some-runner",
      shardInfo: { current: 2, total: 4 },
      suites: [{ file: "tests/browser/a.spec.ts" }],
    });

    expect(readBrowserRunReport(path)?.extras).toBeUndefined();
  });

  test("a report with nothing beyond the generic fields carries no extras bag", () => {
    const repo = tempRoot("browser-extras-none");
    const path = writeReport(repo, {
      runner: "some-runner",
      suites: [{ file: "tests/browser/a.spec.ts" }],
    });

    expect(readBrowserRunReport(path)?.extras).toBeUndefined();
  });

  test("an extras bag alone is not evidence that a run happened", () => {
    const repo = tempRoot("browser-extras-only");
    const path = writeReport(repo, { traceFormat: "zip", suites: [] });

    expect(readBrowserRunReport(path)).toBeUndefined();
  });
});
