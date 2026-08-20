import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capturesPath,
  readCaptures,
  recordCaptures,
  type CaptureRecord,
} from "../../../orchestrating-long-tasks/scripts/src/store/captures.ts";
import { verifyCapsuleLayout } from "../../../orchestrating-long-tasks/scripts/src/store/layout-integrity.ts";
import { putBlobFile } from "../../../orchestrating-long-tasks/scripts/src/store/blobs.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "capture-ledger-"));
  roots.push(root);
  return root;
}

const DIGEST = "a".repeat(64);

function capture(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    kind: "screenshot",
    name: "shot.png",
    sha256: DIGEST,
    bytes: 6,
    blob_path: `blobs/aa/${DIGEST}`,
    path: "evidence/screenshots/shot.png",
    storage: "hardlink",
    original_path: "/repo/test-results/shot.png",
    ...overrides,
  };
}

describe("the capture ledger is the one home for capture attribution", () => {
  test("a second sighting of the same content is not a second record", () => {
    const root = runRoot();
    recordCaptures(root, [capture({ command_id: "C-1" })]);
    recordCaptures(root, [capture({ command_id: "C-2", name: "shot-again.png" })]);

    const stored = readCaptures(root);

    expect(stored).toHaveLength(1);
    expect(stored[0]?.command_id).toBe("C-1");
  });

  test("the same content under two kinds is two records, because they are two things", () => {
    const root = runRoot();
    recordCaptures(root, [capture(), capture({ kind: "visual_report", name: "report.json" })]);

    expect(readCaptures(root).map((entry) => entry.kind)).toEqual(["screenshot", "visual_report"]);
  });

  test("an entry that does not name its content or its file is dropped, not repaired", () => {
    const root = runRoot();
    writeFileSync(
      capturesPath(root),
      JSON.stringify({
        schema: "harness.captures",
        version: 1,
        captures: [
          { kind: "screenshot", name: "a.png", sha256: "short", path: "evidence/a.png" },
          { kind: "unknown", name: "b.png", sha256: DIGEST, path: "evidence/b.png" },
          { kind: "screenshot", name: "", sha256: DIGEST, path: "evidence/c.png" },
          { kind: "screenshot", name: "d.png", sha256: DIGEST, path: "" },
          "junk",
          capture(),
        ],
      }),
      "utf-8",
    );

    expect(readCaptures(root).map((entry) => entry.name)).toEqual(["shot.png"]);
  });

  test("an unreadable or malformed ledger reads as empty rather than throwing", () => {
    const root = runRoot();
    expect(readCaptures(root)).toEqual([]);

    writeFileSync(capturesPath(root), "{", "utf-8");
    expect(readCaptures(root)).toEqual([]);

    writeFileSync(capturesPath(root), JSON.stringify({ captures: "no" }), "utf-8");
    expect(readCaptures(root)).toEqual([]);
  });

  test("recording nothing writes nothing", () => {
    const root = runRoot();
    recordCaptures(root, []);

    expect(readCaptures(root)).toEqual([]);
  });

  test("integrity reports a capture whose bytes, name or address no longer hold", () => {
    const root = runRoot();
    mkdirSync(join(root, "source"), { recursive: true });
    writeFileSync(join(root, "source", "shot.png"), "pixels", "utf-8");
    const blob = putBlobFile(root, join(root, "source", "shot.png"));
    mkdirSync(join(root, "evidence", "screenshots"), { recursive: true });
    writeFileSync(join(root, "evidence", "screenshots", "shot.png"), "pixels", "utf-8");

    recordCaptures(root, [
      capture({ sha256: blob.sha256, blob_path: blob.path }),
      capture({
        sha256: "b".repeat(64),
        name: "missing.png",
        blob_path: `blobs/bb/${"b".repeat(64)}`,
        path: "evidence/screenshots/missing.png",
      }),
      capture({
        sha256: "c".repeat(64),
        name: "wrong-address.png",
        blob_path: "blobs/zz/elsewhere",
        path: "evidence/screenshots/shot.png",
      }),
      // Right length, wrong alphabet: it survives the ledger reader and the digest check catches it.
      capture({
        sha256: "Z".repeat(64),
        name: "no-digest.png",
        path: "evidence/screenshots/x.png",
      }),
    ]);

    const codes = verifyCapsuleLayout(root).map((issue) => issue.code);

    expect(codes).toContain("CAPTURE_BLOB_MISSING");
    expect(codes).toContain("CAPTURE_VIEW_MISSING");
    expect(codes).toContain("CAPTURE_BLOB_PATH");
    expect(codes).toContain("CAPTURE_NAME_REUSED");
    expect(codes).toContain("CAPTURE_DIGEST");
  });

  test("integrity reports a blob that is not named, shaped or protected like a blob", () => {
    const root = runRoot();
    mkdirSync(join(root, "blobs", "aa"), { recursive: true });
    writeFileSync(join(root, "blobs", "aa", "not-a-digest"), "x", "utf-8");
    writeFileSync(join(root, "blobs", "aa", "b".repeat(64)), "y", "utf-8");
    writeFileSync(join(root, "blobs", "loose-file"), "z", "utf-8");

    const codes = verifyCapsuleLayout(root).map((issue) => issue.code);

    expect(codes).toContain("BLOB_NAME");
    expect(codes).toContain("BLOB_SHARD");
    expect(codes).toContain("BLOB_MODE");
    expect(codes).toContain("BLOB_LAYOUT");
  });

  test("a capsule with no captures and no blobs raises nothing", () => {
    const root = runRoot();

    expect(verifyCapsuleLayout(root)).toEqual([]);
  });

  test("a well-formed capture and its blob raise nothing", () => {
    const root = runRoot();
    mkdirSync(join(root, "source"), { recursive: true });
    writeFileSync(join(root, "source", "shot.png"), "pixels", "utf-8");
    const blob = putBlobFile(root, join(root, "source", "shot.png"));
    mkdirSync(join(root, "evidence", "screenshots"), { recursive: true });
    writeFileSync(join(root, "evidence", "screenshots", "shot.png"), "pixels", "utf-8");
    chmodSync(join(root, "evidence", "screenshots", "shot.png"), 0o444);
    recordCaptures(root, [capture({ sha256: blob.sha256, blob_path: blob.path })]);

    expect(verifyCapsuleLayout(root)).toEqual([]);
  });
});
