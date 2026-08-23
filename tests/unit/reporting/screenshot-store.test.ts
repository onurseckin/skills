import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getVisualReport,
  queryScreenshots,
} from "../../../olt/scripts/src/reporting/screenshot-store.ts";
import { recordCaptures } from "../../../olt/scripts/src/store/captures.ts";
import type { CaptureRecord } from "../../../olt/scripts/src/store/captures.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "screenshot-store-"));
  roots.push(root);
  return root;
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
    original_path: "/tmp/shot.png",
    ...overrides,
  };
}

describe("queryScreenshots", () => {
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
});

describe("getVisualReport", () => {
  test("returns null when no visual report has been captured", () => {
    expect(getVisualReport(runRoot())).toBeNull();
  });

  test("reads and normalizes the most recently captured visual report", () => {
    const root = runRoot();
    const blobPath = "blobs/report.json";
    mkdirSync(join(root, "blobs"), { recursive: true });
    writeFileSync(
      join(root, blobPath),
      JSON.stringify({ viewports: { desktop: { width: 800, height: 600 } } }),
      "utf-8",
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
        original_path: "/tmp/visual-report.json",
        timestamp: "2026-08-19T00:00:00.000Z",
      },
    ]);

    const report = getVisualReport(root);
    expect(report?.viewports).toEqual({ desktop: { width: 800, height: 600 } });
  });

  test("filters visual reports by taskId when provided", () => {
    const root = runRoot();
    mkdirSync(join(root, "blobs"), { recursive: true });
    writeFileSync(join(root, "blobs", "report.json"), JSON.stringify({ viewports: {} }), "utf-8");
    recordCaptures(root, [
      {
        kind: "visual_report",
        name: "visual-report.json",
        sha256: "d".repeat(64),
        bytes: 5,
        blob_path: "blobs/report.json",
        path: "evidence/visual-report.json",
        storage: "hardlink",
        original_path: "/tmp/visual-report.json",
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
        original_path: "/tmp/visual-report.json",
      },
    ]);

    expect(getVisualReport(root)).toBeNull();
  });

  test("returns null when the recorded blob is not valid JSON", () => {
    const root = runRoot();
    mkdirSync(join(root, "blobs"), { recursive: true });
    writeFileSync(join(root, "blobs", "bad.json"), "{not json", "utf-8");
    recordCaptures(root, [
      {
        kind: "visual_report",
        name: "visual-report.json",
        sha256: "f".repeat(64),
        bytes: 5,
        blob_path: "blobs/bad.json",
        path: "evidence/visual-report.json",
        storage: "hardlink",
        original_path: "/tmp/visual-report.json",
      },
    ]);

    expect(getVisualReport(root)).toBeNull();
  });
});
