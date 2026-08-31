import { describe, expect, test } from "bun:test";
import {
  adaptIngestedVisualReport,
  adaptScreenshotRecords,
} from "../../olt/scripts/src/validation/reporters/index.ts";
import type {
  ClippingViolation,
  OverflowViolation,
  StackingViolation,
  VisualMetricsReport,
} from "../../olt/scripts/src/reporting/screenshot-types.ts";
import type { CaptureRecord } from "../../olt/scripts/src/engine/store/capsule/captures.ts";

function baseReport(overrides: Partial<VisualMetricsReport> = {}): VisualMetricsReport {
  return {
    viewports: {},
    layoutOverflows: [],
    textClippings: [],
    collisions: [],
    ...overrides,
  };
}

function captureRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    kind: "screenshot",
    name: "mobile.png",
    sha256: "0".repeat(64),
    bytes: 1024,
    blob_path: "blobs/0000",
    path: "screens/mobile.png",
    storage: "hardlink",
    original_path: "/tmp/mobile.png",
    ...overrides,
  };
}

describe("adaptIngestedVisualReport", () => {
  test("passes null through unchanged", () => {
    expect(adaptIngestedVisualReport(null)).toBeNull();
  });

  test("falls back to a single 'unspecified' bucket when nothing names a viewport", () => {
    const adapted = adaptIngestedVisualReport(baseReport());
    expect(adapted?.viewports).toEqual([
      {
        viewport: "unspecified",
        overflowViolations: [],
        clippingViolations: [],
        stackingViolations: [],
      },
    ]);
  });

  test("carries the report timestamp through only when present", () => {
    expect(adaptIngestedVisualReport(baseReport())?.timestamp).toBeUndefined();
    expect(
      adaptIngestedVisualReport(baseReport({ timestamp: "2026-08-19T00:00:00.000Z" }))?.timestamp,
    ).toBe("2026-08-19T00:00:00.000Z");
  });

  test("groups violations under a known viewport and carries its width/height", () => {
    const overflow: OverflowViolation = {
      element: "div#a",
      selector: ".panel",
      scrollWidth: 500,
      clientWidth: 400,
      delta: 100,
      viewport: "mobile",
    };
    const adapted = adaptIngestedVisualReport(
      baseReport({
        viewports: { mobile: { width: 375, height: 667 } },
        layoutOverflows: [overflow],
      }),
    );
    expect(adapted?.viewports).toHaveLength(1);
    const vp = adapted!.viewports[0]!;
    expect(vp.viewport).toBe("mobile");
    expect(vp.width).toBe(375);
    expect(vp.height).toBe(667);
    expect(vp.overflowViolations).toEqual([
      {
        elementId: "div#a",
        selector: ".panel",
        viewport: "mobile",
        scrollWidth: 500,
        clientWidth: 400,
        overflowX: 100,
        message:
          "Horizontal layout overflow on '.panel': scrollWidth (500px) > clientWidth (400px), delta 100px.",
      },
    ]);
  });

  test("buckets a violation naming an unknown viewport under 'unspecified' instead of inventing it", () => {
    const overflow: OverflowViolation = {
      element: "div#a",
      scrollWidth: 500,
      clientWidth: 400,
      delta: 100,
      viewport: "phablet",
    };
    const adapted = adaptIngestedVisualReport(
      baseReport({
        viewports: { mobile: { width: 375, height: 667 } },
        layoutOverflows: [overflow],
      }),
    );
    const names = adapted!.viewports.map((v) => v.viewport);
    expect(names).toContain("mobile");
    expect(names).toContain("unspecified");
    const unspecified = adapted!.viewports.find((v) => v.viewport === "unspecified")!;
    expect(unspecified.width).toBeUndefined();
    expect(unspecified.overflowViolations[0]?.viewport).toBe("unspecified");
  });

  test("falls back from selector to element, and omits textContent when absent", () => {
    const clipping: ClippingViolation = {
      element: "div#caption",
      scrollWidth: 60,
      clientWidth: 40,
      viewport: "mobile",
    };
    const adapted = adaptIngestedVisualReport(
      baseReport({ viewports: { mobile: { width: 1, height: 1 } }, textClippings: [clipping] }),
    );
    const vp = adapted!.viewports.find((v) => v.viewport === "mobile")!;
    expect(vp.clippingViolations).toEqual([
      {
        elementId: "div#caption",
        selector: "div#caption",
        viewport: "mobile",
        scrollHeight: 60,
        clientHeight: 40,
        message: "Text clipping on 'div#caption': content size (60px) exceeds visible size (40px).",
      },
    ]);
    expect(vp.clippingViolations[0]).not.toHaveProperty("textContent");
  });

  test("carries clipping textContent through when the ingested violation has one", () => {
    const clipping: ClippingViolation = {
      element: "div#caption",
      text: "Hello world",
      scrollWidth: 60,
      clientWidth: 40,
      viewport: "mobile",
    };
    const adapted = adaptIngestedVisualReport(
      baseReport({ viewports: { mobile: { width: 1, height: 1 } }, textClippings: [clipping] }),
    );
    const vp = adapted!.viewports.find((v) => v.viewport === "mobile")!;
    expect(vp.clippingViolations[0]?.textContent).toBe("Hello world");
  });

  test("prefers explicit selectors over elements for a stacking collision", () => {
    const stacking: StackingViolation = {
      elements: ["div#top-el", "div#bottom-el"],
      selectors: [".top", ".bottom"],
      overlapArea: 42,
      viewport: "desktop",
    };
    const adapted = adaptIngestedVisualReport(
      baseReport({ viewports: { desktop: { width: 1280, height: 800 } }, collisions: [stacking] }),
    );
    const vp = adapted!.viewports.find((v) => v.viewport === "desktop")!;
    expect(vp.stackingViolations).toEqual([
      {
        topElementSelector: ".top",
        bottomElementSelector: ".bottom",
        viewport: "desktop",
        collisionArea: 42,
        message: "Z-index stacking collision between '.top' and '.bottom'.",
      },
    ]);
  });

  test("falls back to elements when fewer than two selectors are given", () => {
    const stacking: StackingViolation = {
      elements: ["div#top-el", "div#bottom-el"],
      selectors: [".only-one"],
      viewport: "desktop",
    };
    const adapted = adaptIngestedVisualReport(
      baseReport({ viewports: { desktop: { width: 1280, height: 800 } }, collisions: [stacking] }),
    );
    const vp = adapted!.viewports.find((v) => v.viewport === "desktop")!;
    expect(vp.stackingViolations[0]).toMatchObject({
      topElementSelector: "div#top-el",
      bottomElementSelector: "div#bottom-el",
    });
    expect(vp.stackingViolations[0]).not.toHaveProperty("collisionArea");
  });

  test("falls back to 'unknown element' when even the elements list is short", () => {
    const stacking: StackingViolation = {
      elements: ["div#only-el"],
      viewport: "desktop",
    };
    const adapted = adaptIngestedVisualReport(
      baseReport({ viewports: { desktop: { width: 1280, height: 800 } }, collisions: [stacking] }),
    );
    const vp = adapted!.viewports.find((v) => v.viewport === "desktop")!;
    expect(vp.stackingViolations[0]).toMatchObject({
      topElementSelector: "div#only-el",
      bottomElementSelector: "unknown element",
    });
  });

  test("falls back to 'unknown element' on both sides when there is nothing to name at all", () => {
    const stacking: StackingViolation = { elements: [], viewport: "desktop" };
    const adapted = adaptIngestedVisualReport(
      baseReport({ viewports: { desktop: { width: 1280, height: 800 } }, collisions: [stacking] }),
    );
    const vp = adapted!.viewports.find((v) => v.viewport === "desktop")!;
    expect(vp.stackingViolations[0]).toMatchObject({
      topElementSelector: "unknown element",
      bottomElementSelector: "unknown element",
    });
  });
});

describe("adaptScreenshotRecords", () => {
  test("maps the required capture fields and omits the optional ones when absent", () => {
    const adapted = adaptScreenshotRecords([captureRecord()]);
    expect(adapted).toEqual([{ name: "mobile.png", path: "screens/mobile.png", sizeBytes: 1024 }]);
  });

  test("carries timestamp, commandId and taskId through only when the capture has them", () => {
    const adapted = adaptScreenshotRecords([
      captureRecord({ timestamp: "2026-08-19T00:00:00.000Z", command_id: "C-1", task_id: "T-1" }),
    ]);
    expect(adapted).toEqual([
      {
        name: "mobile.png",
        path: "screens/mobile.png",
        sizeBytes: 1024,
        timestamp: "2026-08-19T00:00:00.000Z",
        commandId: "C-1",
        taskId: "T-1",
      },
    ]);
  });

  test("maps an empty list to an empty list", () => {
    expect(adaptScreenshotRecords([])).toEqual([]);
  });
});
