import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  capturesPath,
  readCaptures,
  recordCaptures,
  type CaptureRecord,
} from "../../../olt/scripts/src/engine/store/capsule/captures.ts";
import { scratchRoot as makeScratchRoot } from "../store-fixture.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

function capture(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    kind: "screenshot",
    name: "before.png",
    sha256: "a".repeat(64),
    bytes: 10,
    blob_path: `blobs/aa/${"a".repeat(64)}`,
    path: "evidence/before.png",
    storage: "hardlink",
    original_path: "/tmp/before.png",
    ...overrides,
  };
}

describe("capturesPath", () => {
  test("joins the run root with captures.json", () => {
    expect(capturesPath("/run/root")).toBe(join("/run/root", "captures.json"));
  });
});

describe("readCaptures", () => {
  test("returns an empty array when captures.json does not exist", () => {
    const root = scratchRoot("returns-an-empty-array-when-captures-json-does-not");
    expect(readCaptures(root)).toEqual([]);
  });

  test("returns an empty array when captures.json is not valid JSON", () => {
    const root = scratchRoot("returns-an-empty-array-when-captures-json-is-not-v");
    writeFileSync(capturesPath(root), "not json");
    expect(readCaptures(root)).toEqual([]);
  });

  test("returns an empty array when the parsed JSON is not an object with a captures array", () => {
    const root = scratchRoot("returns-an-empty-array-when-the-parsed-json-is-not");
    writeFileSync(capturesPath(root), JSON.stringify([1, 2, 3]));
    expect(readCaptures(root)).toEqual([]);
    writeFileSync(capturesPath(root), JSON.stringify({ captures: "not-an-array" }));
    expect(readCaptures(root)).toEqual([]);
  });

  test("filters out malformed capture entries and keeps the well-formed ones", () => {
    const root = scratchRoot("filters-out-malformed-capture-entries-and-keeps-th");
    const good = capture();
    writeFileSync(
      capturesPath(root),
      JSON.stringify({
        captures: [
          good,
          { kind: "not-a-kind" },
          { kind: "screenshot", name: "", sha256: "a".repeat(64), path: "x" },
          { kind: "screenshot", name: "n", sha256: "short", path: "x" },
          { kind: "screenshot", name: "n", sha256: "a".repeat(64), path: "" },
          "not-an-object",
        ],
      }),
    );
    expect(readCaptures(root)).toEqual([good]);
  });
});

describe("recordCaptures", () => {
  test("returns false and writes nothing for an empty addition list", () => {
    const root = scratchRoot("returns-false-and-writes-nothing-for-an-empty-addi");
    expect(recordCaptures(root, [])).toBe(false);
    expect(readCaptures(root)).toEqual([]);
  });

  test("writes a new ledger and returns true when additions are genuinely new", () => {
    const root = scratchRoot("writes-a-new-ledger-and-returns-true-when-addition");
    const first = capture();
    expect(recordCaptures(root, [first])).toBe(true);
    const stored = JSON.parse(readFileSync(capturesPath(root), "utf-8")) as {
      schema: string;
      version: number;
      captures: CaptureRecord[];
    };
    expect(stored.schema).toBe("harness.captures");
    expect(stored.version).toBe(1);
    expect(stored.captures).toEqual([first]);
  });

  test("deduplicates by kind+sha256 and returns false when nothing new was added", () => {
    const root = scratchRoot("deduplicates-by-kind-sha256-and-returns-false-when");
    const first = capture();
    recordCaptures(root, [first]);
    const duplicate = capture({ name: "different-name.png" });
    expect(recordCaptures(root, [duplicate])).toBe(false);
    expect(readCaptures(root)).toEqual([first]);
  });

  test("appends genuinely new captures alongside existing ones", () => {
    const root = scratchRoot("appends-genuinely-new-captures-alongside-existing-");
    const first = capture();
    recordCaptures(root, [first]);
    const second = capture({ sha256: "b".repeat(64), name: "after.png" });
    expect(recordCaptures(root, [second])).toBe(true);
    expect(readCaptures(root)).toEqual([first, second]);
  });

  test("deduplicates within a single batch of additions sharing the same kind+sha256", () => {
    const root = scratchRoot("deduplicates-within-a-single-batch-of-additions-sh");
    const first = capture();
    const duplicateWithinBatch = capture({ name: "other.png" });
    expect(recordCaptures(root, [first, duplicateWithinBatch])).toBe(true);
    expect(readCaptures(root)).toEqual([first]);
  });
});
