import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBrowserRunReport } from "../../../../olt/scripts/src/reporting/browser-run-report.ts";
import { cleanupTempDirs, tempDir } from "./browser-run-fixture.ts";

afterEach(cleanupTempDirs);

describe("readBrowserRunReport", () => {
  test("refuses a file above the byte ceiling rather than parsing it", () => {
    const dir = tempDir("oversize");
    const path = join(dir, "huge.json");
    // One byte past MAX_BROWSER_REPORT_BYTES (8 MiB); content does not matter, only size.
    writeFileSync(path, Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));

    expect(readBrowserRunReport(path)).toBeUndefined();
  });

  test("refuses malformed JSON", () => {
    const dir = tempDir("malformed");
    const path = join(dir, "report.json");
    writeFileSync(path, "{not json", "utf-8");

    expect(readBrowserRunReport(path)).toBeUndefined();
  });

  test("refuses a JSON value that is not an object", () => {
    const dir = tempDir("array-json");
    const path = join(dir, "report.json");
    writeFileSync(path, "[1, 2, 3]", "utf-8");

    expect(readBrowserRunReport(path)).toBeUndefined();
  });

  test("refuses a document that is neither a runner report nor a visual report", () => {
    const dir = tempDir("neither");
    const path = join(dir, "report.json");
    writeFileSync(path, JSON.stringify({ unrelated: true }), "utf-8");

    expect(readBrowserRunReport(path)).toBeUndefined();
  });

  test("refuses a document that carries only unmapped extras and no real fact", () => {
    const dir = tempDir("extras-only");
    const path = join(dir, "report.json");
    writeFileSync(path, JSON.stringify({ suites: [], custom_field: "value" }), "utf-8");

    // Extras alone (without any of browser/status/testFile/etc.) is not a fact worth recording.
    expect(readBrowserRunReport(path)).toBeUndefined();
  });

  test("refuses a path that does not exist", () => {
    const dir = tempDir("missing-report");
    expect(readBrowserRunReport(join(dir, "absent.json"))).toBeUndefined();
  });

  test("collects unmapped top-level fields as extras, capped at 32 entries", () => {
    const dir = tempDir("many-extras");
    const path = join(dir, "report.json");
    const extraFields: Record<string, number> = {};
    for (let index = 0; index < 40; index += 1) extraFields[`custom_${index}`] = index;
    writeFileSync(
      path,
      JSON.stringify({ suites: [{ file: "tests/a.spec.ts" }], ...extraFields }),
      "utf-8",
    );

    const facts = readBrowserRunReport(path);

    expect(facts?.testFile).toBe("tests/a.spec.ts");
    expect(Object.keys(facts?.extras ?? {})).toHaveLength(32);
  });

  test("a project without a viewport contributes no viewport entry", () => {
    const dir = tempDir("no-viewport");
    const path = join(dir, "report.json");
    writeFileSync(
      path,
      JSON.stringify({
        config: { projects: [{ name: "chromium", use: { browserName: "chromium" } }] },
        suites: [{ file: "tests/a.spec.ts" }],
      }),
      "utf-8",
    );

    const facts = readBrowserRunReport(path);

    expect(facts?.browser).toBe("chromium");
    expect(facts?.viewport).toBeUndefined();
    expect(facts?.viewports).toBeUndefined();
  });

  test("a config that is not an object contributes no browser or viewport facts", () => {
    const dir = tempDir("bad-config");
    const path = join(dir, "report.json");
    writeFileSync(
      path,
      JSON.stringify({ config: "not-an-object", suites: [{ file: "tests/a.spec.ts" }] }),
      "utf-8",
    );

    const facts = readBrowserRunReport(path);

    expect(facts?.testFile).toBe("tests/a.spec.ts");
    expect(facts?.browser).toBeUndefined();
    expect(facts?.viewport).toBeUndefined();
  });

  test("a visual report with viewports but no metadata still reports a source path", () => {
    const dir = tempDir("bare-visual");
    const path = join(dir, "visual-report.json");
    writeFileSync(
      path,
      JSON.stringify({ viewports: { desktop: { width: 1024, height: 768 } }, extra_metric: 7 }),
      "utf-8",
    );

    const facts = readBrowserRunReport(path);

    expect(facts?.sourcePath).toBe(path);
    expect(facts?.viewport).toEqual({ width: 1024, height: 768 });
    expect(facts?.runner).toBeUndefined();
    expect(facts?.extras).toEqual({ extra_metric: 7 });
  });

  test("a visual report with neither viewport data nor other facts is not a fact worth recording", () => {
    const dir = tempDir("empty-visual");
    const path = join(dir, "visual-report.json");
    writeFileSync(path, JSON.stringify({ viewports: {} }), "utf-8");

    expect(readBrowserRunReport(path)).toBeUndefined();
  });

  test("attachments outside the recognised trace/video names are ignored", () => {
    const dir = tempDir("other-attachment");
    const path = join(dir, "report.json");
    writeFileSync(
      path,
      JSON.stringify({
        suites: [
          {
            file: "tests/a.spec.ts",
            specs: [
              { tests: [{ results: [{ attachments: [{ name: "screenshot", path: "/x.png" }] }] }] },
            ],
          },
        ],
      }),
      "utf-8",
    );

    const facts = readBrowserRunReport(path);

    expect(facts?.traces).toBeUndefined();
    expect(facts?.videos).toBeUndefined();
  });

  test("does not walk past twelve levels of nested suites", () => {
    const dir = tempDir("deep-nesting");
    const path = join(dir, "report.json");
    let node: Record<string, unknown> = {
      attachments: [{ name: "trace", path: "/deepest.zip" }],
    };
    for (let depth = 0; depth < 14; depth += 1) node = { suites: [node] };
    writeFileSync(path, JSON.stringify({ suites: node.suites as unknown[] }), "utf-8");

    // The attachment sits deeper than the recursion cap; it must not surface, and reading must
    // not throw or hang on a report this deeply nested.
    const facts = readBrowserRunReport(path);
    expect(facts?.traces).toBeUndefined();
  });
});
