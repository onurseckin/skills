import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  browserRunPath,
  queryBrowserRuns,
  readBrowserRun,
  writeBrowserRunRecord,
} from "../../../olt/scripts/src/reporting/browser-run-store.ts";
import {
  extractBrowserReportsFromText,
  findBrowserReportCandidates,
} from "../../../olt/scripts/src/reporting/browser-run-scanner.ts";
import type { BrowserRunRecord } from "../../../olt/scripts/src/reporting/browser-run-types.ts";
import { cleanupTempDirs, tempDir } from "./browser-run-fixture.ts";

afterEach(cleanupTempDirs);

function record(overrides: Partial<BrowserRunRecord> = {}): BrowserRunRecord {
  return { command_id: "C-1", evidence_classes: {}, ...overrides };
}

export const browserRunScannerStoreSuiteName = "browser run scanner";

describe(browserRunScannerStoreSuiteName, () => {
  test("finds a report nested under a recognised results directory, skipping node_modules", () => {
    const dir = tempDir("scanner-nested");
    mkdirSync(join(dir, "cypress", "results", "nested"), { recursive: true });
    writeFileSync(join(dir, "cypress", "results", "nested", "report.json"), "{}");
    mkdirSync(join(dir, "cypress", "results", "node_modules"), { recursive: true });
    writeFileSync(join(dir, "cypress", "results", "node_modules", "report.json"), "{}");

    const found = findBrowserReportCandidates([dir]);

    expect(found).toHaveLength(1);
    expect(found[0]).toContain(join("nested", "report.json"));
  });

  test("matches report file names case-insensitively at the top of a search dir", () => {
    const dir = tempDir("scanner-top");
    writeFileSync(join(dir, "REPORT.JSON"), "{}");
    writeFileSync(join(dir, "unrelated.json"), "{}");

    const found = findBrowserReportCandidates([dir]);

    expect(found).toHaveLength(1);
  });

  test("extracts a report path mentioned in free text and resolves it against a base dir", () => {
    const dir = tempDir("scanner-text");
    writeFileSync(join(dir, "results.json"), "{}");

    const found = extractBrowserReportsFromText("wrote results.json to disk", dir);

    expect(found).toEqual([join(dir, "results.json")]);
  });

  test("ignores text that names no report file", () => {
    expect(extractBrowserReportsFromText("", "/tmp")).toEqual([]);
    expect(extractBrowserReportsFromText("nothing relevant here")).toEqual([]);
  });

  test("a search dir that does not exist contributes no candidates", () => {
    expect(findBrowserReportCandidates(["/nonexistent/path/for/sure"])).toEqual([]);
  });

  test("finds a report mentioned in stderr as well as stdout", () => {
    const dir = tempDir("scanner-stderr");
    writeFileSync(join(dir, "results.json"), "{}");

    const found = findBrowserReportCandidates([dir], undefined, "wrote results.json");

    expect(found).toEqual([join(dir, "results.json")]);
  });
});

describe("browser run store", () => {
  test("round-trips a record written by the store", () => {
    const runRoot = tempDir("store-roundtrip");
    writeBrowserRunRecord(runRoot, record({ command_id: "C-9", browser: "chromium" }));

    const loaded = readBrowserRun(runRoot, "C-9");
    expect(loaded?.browser).toBe("chromium");
  });

  test("returns undefined for a command with no stored run", () => {
    const runRoot = tempDir("store-missing");
    expect(readBrowserRun(runRoot, "nope")).toBeUndefined();
  });

  test("returns undefined for a corrupted record", () => {
    const runRoot = tempDir("store-corrupt");
    const path = browserRunPath(runRoot, "C-1");
    mkdirSync(join(runRoot, "commands", "C-1"), { recursive: true });
    writeFileSync(path, "{not json", "utf-8");

    expect(readBrowserRun(runRoot, "C-1")).toBeUndefined();
  });

  test("returns undefined for a record that is not an object, or that lacks a command_id", () => {
    const runRoot = tempDir("store-shape");
    const path = browserRunPath(runRoot, "C-1");
    mkdirSync(join(runRoot, "commands", "C-1"), { recursive: true });

    writeFileSync(path, JSON.stringify([1, 2, 3]), "utf-8");
    expect(readBrowserRun(runRoot, "C-1")).toBeUndefined();

    writeFileSync(path, JSON.stringify({ evidence_classes: {} }), "utf-8");
    expect(readBrowserRun(runRoot, "C-1")).toBeUndefined();

    writeFileSync(path, JSON.stringify({ command_id: "" }), "utf-8");
    expect(readBrowserRun(runRoot, "C-1")).toBeUndefined();
  });

  test("defaults evidence_classes to an empty object when the stored value is not a record", () => {
    const runRoot = tempDir("store-classes-default");
    const path = browserRunPath(runRoot, "C-1");
    mkdirSync(join(runRoot, "commands", "C-1"), { recursive: true });
    writeFileSync(path, JSON.stringify({ command_id: "C-1", evidence_classes: "nope" }), "utf-8");

    expect(readBrowserRun(runRoot, "C-1")?.evidence_classes).toEqual({});
  });

  test("a write failure is swallowed rather than thrown", () => {
    const runRoot = tempDir("store-write-fail");
    // A file where the commands directory needs to be blocks mkdirSync.
    writeFileSync(join(runRoot, "commands"), "blocker", "utf-8");

    expect(() => writeBrowserRunRecord(runRoot, record())).not.toThrow();
    expect(readBrowserRun(runRoot, "C-1")).toBeUndefined();
  });

  test("queryBrowserRuns without a commandId lists every stored run, filtered by task", () => {
    const runRoot = tempDir("store-query");
    writeBrowserRunRecord(runRoot, record({ command_id: "C-1", task_id: "T-1" }));
    writeBrowserRunRecord(runRoot, record({ command_id: "C-2", task_id: "T-2" }));

    expect(
      queryBrowserRuns(runRoot)
        .map((run) => run.command_id)
        .sort(),
    ).toEqual(["C-1", "C-2"]);
    expect(queryBrowserRuns(runRoot, { taskId: "T-1" }).map((run) => run.command_id)).toEqual([
      "C-1",
    ]);
  });

  test("queryBrowserRuns with a commandId looks up exactly that run", () => {
    const runRoot = tempDir("store-query-one");
    writeBrowserRunRecord(runRoot, record({ command_id: "C-1" }));
    writeBrowserRunRecord(runRoot, record({ command_id: "C-2" }));

    expect(queryBrowserRuns(runRoot, { commandId: "C-2" }).map((run) => run.command_id)).toEqual([
      "C-2",
    ]);
  });

  test("listing command ids for a run with no commands directory yields none", () => {
    const runRoot = tempDir("store-no-commands-dir");
    expect(queryBrowserRuns(runRoot)).toEqual([]);
  });
});
