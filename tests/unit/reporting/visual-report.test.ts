import { describe, expect, test } from "bun:test";
import { normalizeVisualReport } from "../../../orchestrating-long-tasks/scripts/src/reporting/visual-report.ts";

describe("normalizeVisualReport", () => {
  test("returns null for anything that is not a plain object", () => {
    expect(normalizeVisualReport(null, "2026-08-19T00:00:00.000Z")).toBeNull();
    expect(normalizeVisualReport("string", undefined)).toBeNull();
    expect(normalizeVisualReport([1, 2], undefined)).toBeNull();
    expect(normalizeVisualReport(42, undefined)).toBeNull();
  });

  test("falls back to the supplied timestamp when the report carries none", () => {
    const report = normalizeVisualReport({}, "2026-08-19T00:00:00.000Z");
    expect(report?.timestamp).toBe("2026-08-19T00:00:00.000Z");
  });

  test("prefers the report's own timestamp over the fallback", () => {
    const report = normalizeVisualReport(
      { timestamp: "2020-01-01T00:00:00.000Z" },
      "2026-08-19T00:00:00.000Z",
    );
    expect(report?.timestamp).toBe("2020-01-01T00:00:00.000Z");
  });

  test("omits timestamp entirely when neither the report nor the fallback has one", () => {
    const report = normalizeVisualReport({}, undefined);
    expect(report).not.toHaveProperty("timestamp");
  });

  test("defaults every array field to empty and viewports to an empty record when absent", () => {
    const report = normalizeVisualReport({}, undefined);
    expect(report?.viewports).toEqual({});
    expect(report?.layoutOverflows).toEqual([]);
    expect(report?.textClippings).toEqual([]);
    expect(report?.collisions).toEqual([]);
    expect(report).not.toHaveProperty("metadata");
  });

  test("ignores a viewports field that is not a plain object", () => {
    const report = normalizeVisualReport({ viewports: ["not", "a", "record"] }, undefined);
    expect(report?.viewports).toEqual({});
  });

  test("ignores array fields that are present but not arrays", () => {
    const report = normalizeVisualReport(
      { layoutOverflows: "nope", textClippings: 5, collisions: null },
      undefined,
    );
    expect(report?.layoutOverflows).toEqual([]);
    expect(report?.textClippings).toEqual([]);
    expect(report?.collisions).toEqual([]);
  });

  test("carries through every populated field, including metadata", () => {
    const report = normalizeVisualReport(
      {
        timestamp: "2026-08-19T00:00:00.000Z",
        viewports: { desktop: { width: 1440, height: 900 } },
        layoutOverflows: [{ element: "div", scrollWidth: 100, clientWidth: 80, delta: 20 }],
        textClippings: [{ element: "span", scrollWidth: 50, clientWidth: 40 }],
        collisions: [{ elements: ["a", "b"] }],
        metadata: { runner: "playwright" },
      },
      undefined,
    );
    expect(report).toEqual({
      timestamp: "2026-08-19T00:00:00.000Z",
      viewports: { desktop: { width: 1440, height: 900 } },
      layoutOverflows: [{ element: "div", scrollWidth: 100, clientWidth: 80, delta: 20 }],
      textClippings: [{ element: "span", scrollWidth: 50, clientWidth: 40 }],
      collisions: [{ elements: ["a", "b"] }],
      metadata: { runner: "playwright" },
    });
  });

  test("ignores a metadata field that is not a plain object", () => {
    const report = normalizeVisualReport({ metadata: [1, 2] }, undefined);
    expect(report).not.toHaveProperty("metadata");
  });
});
