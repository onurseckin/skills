import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { chmodSync, linkSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import { putBlobFile } from "../../../olt/scripts/src/engine/store/layout/blobs.ts";
import {
  verifyBlobContents,
  verifyCapsuleDeep,
  verifyCapsuleLayout,
} from "../../../olt/scripts/src/engine/store/integrity/layout-integrity.ts";
import { scratchRoot as makeScratchRoot, setupVirtualStoreFS } from "../store-fixture.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

function captureFixture(overrides: Record<string, unknown> = {}) {
  return {
    kind: "screenshot",
    name: "shot.png",
    sha256: "e".repeat(64),
    bytes: 5,
    blob_path: `blobs/ee/${"e".repeat(64)}`,
    path: "evidence/shot.png",
    storage: "hardlink",
    original_path: "/tmp/shot.png",
    ...overrides,
  };
}

function writeCaptures(root: string, captures: unknown[]): void {
  writeFileSync(join(root, "captures.json"), JSON.stringify({ captures }));
}

describe("capture references (via verifyCapsuleLayout)", () => {
  test("returns no issues when captures.json does not exist", () => {
    const root = scratchRoot("returns-no-issues-when-captures-json-does-not-exis");
    expect(verifyCapsuleLayout(root)).toEqual([]);
  });

  test("reports CAPTURE_DIGEST when the capture's sha256 is 64 characters but not valid lowercase hex", () => {
    const root = scratchRoot("reports-capture-digest-when-the-capture-s-sha256-i");
    writeCaptures(root, [captureFixture({ sha256: "g".repeat(64) })]);
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "CAPTURE_DIGEST" })]);
  });

  test("reports CAPTURE_BLOB_PATH when blob_path does not match the sha256's own content address", () => {
    const root = scratchRoot("reports-capture-blob-path-when-blob-path-does-not-");
    writeCaptures(root, [captureFixture({ blob_path: "blobs/00/wrong" })]);
    const found = verifyCapsuleLayout(root);
    expect(found.some((i) => i.code === "CAPTURE_BLOB_PATH")).toBe(true);
  });

  test("reports CAPTURE_BLOB_MISSING and CAPTURE_VIEW_MISSING when neither file exists", () => {
    const root = scratchRoot("reports-capture-blob-missing-and-capture-view-miss");
    writeCaptures(root, [captureFixture()]);
    const found = verifyCapsuleLayout(root);
    expect(found.map((i) => i.code).sort()).toEqual([
      "CAPTURE_BLOB_MISSING",
      "CAPTURE_VIEW_MISSING",
    ]);
  });

  test("reports no divergence issue for a hardlinked capture whose view still shares the blob's inode", () => {
    const root = scratchRoot("reports-no-divergence-issue-for-a-hardlinked-captu");
    const digest = "e".repeat(64);
    const blobDir = join(root, "blobs", "ee");
    mkdirSync(blobDir, { recursive: true });
    const blobPath = join(blobDir, digest);
    writeFileSync(blobPath, "hello", { mode: 0o444 });
    mkdirSync(join(root, "evidence"), { recursive: true });
    const viewPath = join(root, "evidence", "shot.png");
    linkSync(blobPath, viewPath);
    writeCaptures(root, [captureFixture({ sha256: digest, blob_path: `blobs/ee/${digest}` })]);
    expect(verifyCapsuleLayout(root)).toEqual([]);
  });

  test("reports CAPTURE_VIEW_DIVERGED for a hardlinked capture whose view is no longer the same inode", () => {
    const root = scratchRoot("reports-capture-view-diverged-for-a-hardlinked-cap");
    const digest = "e".repeat(64);
    const blobDir = join(root, "blobs", "ee");
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, digest), "hello", { mode: 0o444 });
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, "evidence", "shot.png"), "hello");
    writeCaptures(root, [captureFixture({ sha256: digest, blob_path: `blobs/ee/${digest}` })]);
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "CAPTURE_VIEW_DIVERGED" })]);
  });

  test("reports CAPTURE_VIEW_DIVERGED when stat throws in sameInode check", () => {
    const root = scratchRoot("reports-capture-view-diverged-when-stat-throws");
    const digest = "e".repeat(64);
    const blobDir = join(root, "blobs", "ee");
    mkdirSync(blobDir, { recursive: true });
    const blobPath = join(blobDir, digest);
    writeFileSync(blobPath, "hello", { mode: 0o444 });
    mkdirSync(join(root, "evidence"), { recursive: true });
    const viewPath = join(root, "evidence", "shot.png");
    writeFileSync(viewPath, "hello");
    writeCaptures(root, [captureFixture({ sha256: digest, blob_path: `blobs/ee/${digest}` })]);

    spyOn(fs, "statSync").mockImplementation(() => {
      throw new Error("stat error");
    });
    try {
      const found = verifyCapsuleLayout(root);
      expect(found.some((i) => i.code === "CAPTURE_VIEW_DIVERGED")).toBe(true);
    } finally {
      setupVirtualStoreFS();
    }
  });

  test("accepts a copy-storage capture whose view content still hashes to the recorded digest", () => {
    const root = scratchRoot("accepts-a-copy-storage-capture-whose-view-content-");
    const digest = sha256Bytes(new TextEncoder().encode("copied bytes"));
    const blobDir = join(root, "blobs", digest.slice(0, 2));
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, digest), "copied bytes", { mode: 0o444 });
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, "evidence", "shot.png"), "copied bytes");
    writeCaptures(root, [
      captureFixture({
        sha256: digest,
        blob_path: `blobs/${digest.slice(0, 2)}/${digest}`,
        storage: "copy",
      }),
    ]);
    expect(verifyCapsuleLayout(root)).toEqual([]);
  });

  test("reports CAPTURE_VIEW_DIVERGED for a copy-storage capture whose view content has since changed", () => {
    const root = scratchRoot("reports-capture-view-diverged-for-a-copy-storage-c");
    const digest = sha256Bytes(new TextEncoder().encode("original bytes"));
    const blobDir = join(root, "blobs", digest.slice(0, 2));
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, digest), "original bytes", { mode: 0o444 });
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, "evidence", "shot.png"), "tampered bytes");
    writeCaptures(root, [
      captureFixture({
        sha256: digest,
        blob_path: `blobs/${digest.slice(0, 2)}/${digest}`,
        storage: "copy",
      }),
    ]);
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "CAPTURE_VIEW_DIVERGED" })]);
  });

  test("reports CAPTURE_UNREADABLE for a copy-storage capture whose view file cannot be read", () => {
    const root = scratchRoot("reports-capture-unreadable-for-a-copy-storage-capt");
    const digest = "e".repeat(64);
    const blobDir = join(root, "blobs", "ee");
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, digest), "hello", { mode: 0o444 });
    mkdirSync(join(root, "evidence", "shot.png"), { recursive: true });
    writeCaptures(root, [
      captureFixture({ sha256: digest, blob_path: `blobs/ee/${digest}`, storage: "copy" }),
    ]);
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "CAPTURE_UNREADABLE" })]);
  });

  test("reports CAPTURE_STORAGE for an unrecognized storage mode when both files are present", () => {
    const root = scratchRoot("reports-capture-storage-for-an-unrecognized-storag");
    const digest = "e".repeat(64);
    const blobDir = join(root, "blobs", "ee");
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, digest), "hello", { mode: 0o444 });
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, "evidence", "shot.png"), "hello");
    writeCaptures(root, [
      captureFixture({ sha256: digest, blob_path: `blobs/ee/${digest}`, storage: "teleport" }),
    ]);
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "CAPTURE_STORAGE" })]);
  });

  test("reports CAPTURE_NAME_REUSED when two captures claim the same view path", () => {
    const root = scratchRoot("reports-capture-name-reused-when-two-captures-clai");
    writeCaptures(root, [
      captureFixture({ sha256: "1".repeat(64) }),
      captureFixture({ sha256: "2".repeat(64) }),
    ]);
    const found = verifyCapsuleLayout(root);
    expect(found.some((i) => i.code === "CAPTURE_NAME_REUSED")).toBe(true);
  });
});

describe("verifyCapsuleDeep", () => {
  test("combines undeclared entries and blob content verification", () => {
    const root = scratchRoot("combines-undeclared-entries-and-blob-content-verif");
    writeFileSync(join(root, "mystery.txt"), "x");
    const found = verifyCapsuleDeep(root);
    expect(found.some((i) => i.code === "LAYOUT_UNDECLARED")).toBe(true);
  });
});

describe("verifyBlobContents", () => {
  test("returns no issues when there are no blobs", () => {
    const root = scratchRoot("returns-no-issues-when-there-are-no-blobs");
    expect(verifyBlobContents(root)).toEqual([]);
  });

  test("returns no issues when every stored blob's content still hashes to its own name", () => {
    const root = scratchRoot("returns-no-issues-when-every-stored-blob-s-content");
    const source = join(root, "source.txt");
    writeFileSync(source, "authentic bytes");
    putBlobFile(root, source);
    expect(verifyBlobContents(root)).toEqual([]);
  });

  test("reports BLOB_CONTENT when a stored blob's bytes no longer match its own digest name", () => {
    const root = scratchRoot("reports-blob-content-when-a-stored-blob-s-bytes-no");
    const source = join(root, "source.txt");
    writeFileSync(source, "authentic bytes");
    const put = putBlobFile(root, source);
    chmodSync(join(root, put.path), 0o644);
    writeFileSync(join(root, put.path), "tampered bytes");
    const found = verifyBlobContents(root);
    expect(found).toEqual([expect.objectContaining({ code: "BLOB_CONTENT" })]);
  });

  test("reports BLOB_UNREADABLE when a listed blob cannot actually be opened", () => {
    const root = scratchRoot("reports-blob-unreadable-when-a-listed-blob-cannot-");
    const digest = "f".repeat(64);
    const shardDir = join(root, "blobs", "ff");
    mkdirSync(shardDir, { recursive: true });
    mkdirSync(join(shardDir, digest));
    const found = verifyBlobContents(root);
    expect(found).toEqual([expect.objectContaining({ code: "BLOB_UNREADABLE" })]);
  });
});
