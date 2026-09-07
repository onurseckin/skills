import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  getVisualReport,
  queryScreenshots,
} from "../../../olt/scripts/src/reporting/screenshot-store.ts";
import {
  recordCaptures,
  type CaptureRecord,
} from "../../../olt/scripts/src/engine/store/capsule/captures.ts";
import { cleanupVirtualBrowserFS, setupVirtualBrowserFS, tempDir } from "./browser-run-fixture.ts";

function runRoot(): string {
  return tempDir("screenshot-store");
}

function screenshot(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    kind: "screenshot",
    name: "shot.png",
    sha256: "a".repeat(64),
    bytes: 10,
    blob_path: "blobs/aa/shot",
    path: "evidence/screenshots/shot.png",
    storage: "hardlink",
    original_path: "/virtual/tmp/shot.png",
    ...overrides,
  };
}

export const screenshotStoreSuiteName = "queryScreenshots & screenshot store";

describe(screenshotStoreSuiteName, () => {
  let vfs: ReturnType<typeof setupVirtualBrowserFS>;

  beforeEach(() => {
    vfs = setupVirtualBrowserFS();
  });

  afterEach(() => {
    cleanupVirtualBrowserFS();
  });

  test("only returns captures of kind screenshot", () => {
    const root = runRoot();
    recordCaptures(root, [
      screenshot({ sha256: "a".repeat(64) }),
      { ...screenshot({ sha256: "b".repeat(64) }), kind: "visual_report" },
    ]);

    const found = queryScreenshots(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("screenshot");
  });

  test("filters by taskId, commandId, and actor", () => {
    const root = runRoot();
    recordCaptures(root, [
      screenshot({ sha256: "a".repeat(64), task_id: "T-1", command_id: "C-1", actor: "worker-1" }),
      screenshot({ sha256: "b".repeat(64), task_id: "T-2", command_id: "C-2", actor: "worker-2" }),
    ]);

    expect(queryScreenshots(root, { taskId: "T-1" }).map((r) => r.sha256)).toEqual([
      "a".repeat(64),
    ]);
    expect(queryScreenshots(root, { commandId: "C-2" }).map((r) => r.sha256)).toEqual([
      "b".repeat(64),
    ]);
    expect(queryScreenshots(root, { actor: "worker-1" }).map((r) => r.sha256)).toEqual([
      "a".repeat(64),
    ]);
  });

  test("an empty capsule has no screenshots", () => {
    expect(queryScreenshots(runRoot())).toEqual([]);
  });

  test("returns empty array when captures.json is empty or malformed", () => {
    const root = runRoot();
    vfs.writeFileSync(join(root, "captures.json"), "");
    expect(queryScreenshots(root)).toEqual([]);

    vfs.writeFileSync(join(root, "captures.json"), "{bad json");
    expect(queryScreenshots(root)).toEqual([]);
  });
});

describe("getVisualReport", () => {
  let vfs: ReturnType<typeof setupVirtualBrowserFS>;

  beforeEach(() => {
    vfs = setupVirtualBrowserFS();
  });

  afterEach(() => {
    cleanupVirtualBrowserFS();
  });

  test("returns null when no visual report has been captured", () => {
    expect(getVisualReport(runRoot())).toBeNull();
  });

  test("reads and normalizes the most recently captured visual report", () => {
    const root = runRoot();
    const blobPath = "blobs/report.json";
    vfs.mkdirSync(join(root, "blobs"), { recursive: true });
    vfs.writeFileSync(
      join(root, blobPath),
      JSON.stringify({ viewports: { desktop: { width: 800, height: 600 } } }),
    );
    recordCaptures(root, [
      {
        kind: "visual_report",
        name: "visual-report.json",
        sha256: "c".repeat(64),
        bytes: 5,
        blob_path: blobPath,
        path: "evidence/visual-report.json",
        storage: "hardlink",
        original_path: "/virtual/tmp/visual-report.json",
        timestamp: "2026-08-19T00:00:00.000Z",
      },
    ]);

    const report = getVisualReport(root);
    expect(report?.viewports).toEqual({ desktop: { width: 800, height: 600 } });
  });

  test("filters visual reports by taskId when provided", () => {
    const root = runRoot();
    vfs.mkdirSync(join(root, "blobs"), { recursive: true });
    vfs.writeFileSync(join(root, "blobs", "report.json"), JSON.stringify({ viewports: {} }));
    recordCaptures(root, [
      {
        kind: "visual_report",
        name: "visual-report.json",
        sha256: "d".repeat(64),
        bytes: 5,
        blob_path: "blobs/report.json",
        path: "evidence/visual-report.json",
        storage: "hardlink",
        original_path: "/virtual/tmp/visual-report.json",
        task_id: "T-1",
      },
    ]);

    expect(getVisualReport(root, "T-2")).toBeNull();
    expect(getVisualReport(root, "T-1")).not.toBeNull();
  });

  test("returns null when the recorded blob cannot be read", () => {
    const root = runRoot();
    recordCaptures(root, [
      {
        kind: "visual_report",
        name: "visual-report.json",
        sha256: "e".repeat(64),
        bytes: 5,
        blob_path: "blobs/missing.json",
        path: "evidence/visual-report.json",
        storage: "hardlink",
        original_path: "/virtual/tmp/visual-report.json",
      },
    ]);

    expect(getVisualReport(root)).toBeNull();
  });

  test("returns null when the recorded blob is not valid JSON", () => {
    const root = runRoot();
    vfs.mkdirSync(join(root, "blobs"), { recursive: true });
    vfs.writeFileSync(join(root, "blobs", "bad.json"), "{not json");
    recordCaptures(root, [
      {
        kind: "visual_report",
        name: "visual-report.json",
        sha256: "f".repeat(64),
        bytes: 5,
        blob_path: "blobs/bad.json",
        path: "evidence/visual-report.json",
        storage: "hardlink",
        original_path: "/virtual/tmp/visual-report.json",
      },
    ]);

    expect(getVisualReport(root)).toBeNull();
  });

  test("returns latest visual report when multiple exist", () => {
    const root = runRoot();
    vfs.mkdirSync(join(root, "blobs"), { recursive: true });
    vfs.writeFileSync(
      join(root, "blobs", "r1.json"),
      JSON.stringify({ viewports: { mobile: { width: 375, height: 667 } } }),
    );
    vfs.writeFileSync(
      join(root, "blobs", "r2.json"),
      JSON.stringify({ viewports: { desktop: { width: 1920, height: 1080 } } }),
    );
    recordCaptures(root, [
      {
        kind: "visual_report",
        name: "r1.json",
        sha256: "1".repeat(64),
        bytes: 10,
        blob_path: "blobs/r1.json",
        path: "evidence/r1.json",
        storage: "hardlink",
        original_path: "/virtual/tmp/r1.json",
        timestamp: "2026-08-19T00:00:00.000Z",
      },
      {
        kind: "visual_report",
        name: "r2.json",
        sha256: "2".repeat(64),
        bytes: 10,
        blob_path: "blobs/r2.json",
        path: "evidence/r2.json",
        storage: "hardlink",
        original_path: "/virtual/tmp/r2.json",
        timestamp: "2026-08-19T01:00:00.000Z",
      },
    ]);

    const report = getVisualReport(root);
    expect(report?.viewports).toEqual({ desktop: { width: 1920, height: 1080 } });
  });

  test("returns null when recorded blob is empty string", () => {
    const root = runRoot();
    vfs.mkdirSync(join(root, "blobs"), { recursive: true });
    vfs.writeFileSync(join(root, "blobs", "empty.json"), "");
    recordCaptures(root, [
      {
        kind: "visual_report",
        name: "visual-report.json",
        sha256: "0".repeat(64),
        bytes: 0,
        blob_path: "blobs/empty.json",
        path: "evidence/visual-report.json",
        storage: "hardlink",
        original_path: "/virtual/tmp/visual-report.json",
      },
    ]);

    expect(getVisualReport(root)).toBeNull();
  });
});
