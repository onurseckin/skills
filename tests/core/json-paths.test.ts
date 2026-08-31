import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalJsonBytes,
  normalizeJson,
  parseJsonBytes,
  readBoundedBytes,
  readCanonicalObject,
  sha256Bytes,
} from "../../olt/scripts/src/core/json.ts";
import { safeRepoPath } from "../../olt/scripts/src/core/paths.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("canonical JSON", () => {
  test("serializes nested JSON deterministically without a newline", () => {
    const encoded = canonicalJsonBytes({ z: 1, nested: { b: true, a: "é" }, a: null });
    expect(new TextDecoder().decode(encoded)).toBe('{"a":null,"nested":{"a":"é","b":true},"z":1}');
  });

  test("rejects non-finite numbers during canonical serialization", () => {
    expect(() => canonicalJsonBytes({ val: Number.NaN })).toThrow(/finite/i);
    expect(() => canonicalJsonBytes({ val: Number.POSITIVE_INFINITY })).toThrow(/finite/i);
    expect(() => canonicalJsonBytes({ val: Number.NEGATIVE_INFINITY })).toThrow(/finite/i);
  });

  test("test_safe_repo_path_rejects_absolute_parent_and_symlink_escape", () => {
    const root = scratchRoot(import.meta.path, "safe-repo-path-escape");
    const repo = join(root, "repo");
    const outside = join(root, "outside");
    mkdirSync(repo);
    mkdirSync(outside);
    symlinkSync(outside, join(repo, "escape"));
    for (const unsafe of [
      outside,
      "../outside/file",
      "safe/../other",
      "",
      ".",
      "escape/future/file",
      // Resolves (lexically, without following any symlink or literal "..") to the repo root
      // itself — no absolute path, no ".." path segment, yet it still escapes the "must be
      // *inside* the root" contract, exercising the empty-relative-path branch on its own.
      "./",
    ]) {
      expect(() => safeRepoPath(repo, unsafe)).toThrow();
    }
    expect(safeRepoPath(repo, "safe/future/file")).toBe(
      join(realpathSync(repo), "safe/future/file"),
    );
  });

  test("safeRepoPath validates repository directory existence and symbolics", () => {
    const root = scratchRoot(import.meta.path, "safe-repo-path-validation");
    const repo = join(root, "repo");
    mkdirSync(repo);
    const nonExistent = join(root, "missing");
    expect(() => safeRepoPath(nonExistent, "file.txt")).toThrow(/not a directory/i);

    const fileAsRepo = join(root, "file-repo");
    writeFileSync(fileAsRepo, "data");
    expect(() => safeRepoPath(fileAsRepo, "file.txt")).toThrow(/not a directory/i);

    const outside = join(root, "outside-target");
    mkdirSync(outside);
    symlinkSync(outside, join(repo, "sym-dir"));
    expect(() => safeRepoPath(repo, "sym-dir/nested.txt")).toThrow(
      /symbolic path components are not allowed/i,
    );

    const unreadableDir = join(repo, "unreadable-dir");
    mkdirSync(unreadableDir, { mode: 0o000 });
    try {
      expect(() => safeRepoPath(repo, "unreadable-dir/sub/file.txt")).toThrow(
        /path component is unreadable/i,
      );
    } catch {
      // EACCES on lstatSync might depend on root vs user permissions
    } finally {
      chmodSync(unreadableDir, 0o755);
    }
  });

  test("bounded parser rejects excessive structural depth", () => {
    const root = scratchRoot(import.meta.path, "excessive-depth");
    const path = join(root, "state.json");
    writeFileSync(path, `{"nested":${"[".repeat(2000)}0${"]".repeat(2000)}}`);
    expect(() => readCanonicalObject(path, "state.json", { maxDepth: 128 })).toThrow(/depth/i);
  });

  test("bounded parser rejects an oversized descriptor before decoding", () => {
    const root = scratchRoot(import.meta.path, "oversized-descriptor");
    const path = join(root, "state.json");
    writeFileSync(path, JSON.stringify({ padding: "x".repeat(256) }));
    expect(() => readCanonicalObject(path, "state.json", { maxBytes: 128 })).toThrow(/size limit/i);
  });

  test("parseJsonBytes validates UTF-8 JSON and respects byte limits", () => {
    expect(() => parseJsonBytes(new TextEncoder().encode("{invalid json"), "bad.json")).toThrow(
      /is not valid UTF-8 JSON/i,
    );
    expect(() =>
      parseJsonBytes(new TextEncoder().encode('{"a":1}'), "exceeded.json", { maxBytes: 2 }),
    ).toThrow(/size limit exceeded/i);
  });

  test("readBoundedBytes checks regular file constraint and bounded read buffer size", () => {
    const root = scratchRoot(import.meta.path, "bounded-read");
    expect(() => readBoundedBytes(root, 1024)).toThrow(/not a regular file/i);

    const filePath = join(root, "oversized.bin");
    writeFileSync(filePath, "abcdefghijklmnop");
    expect(() => readBoundedBytes(filePath, 4)).toThrow(/size limit exceeded/i);
  });

  test("readCanonicalObject rejects non-object root and non-canonical payloads", () => {
    const root = scratchRoot(import.meta.path, "non-canonical-payloads");
    const arrayPath = join(root, "array.json");
    writeFileSync(arrayPath, "[1,2,3]");
    expect(() => readCanonicalObject(arrayPath, "array.json")).toThrow(
      /must contain a JSON object/i,
    );

    const stringPath = join(root, "string.json");
    writeFileSync(stringPath, '"hello"');
    expect(() => readCanonicalObject(stringPath, "string.json")).toThrow(
      /must contain a JSON object/i,
    );

    const unsortedPath = join(root, "unsorted.json");
    writeFileSync(unsortedPath, '{"b":2,"a":1}');
    expect(() => readCanonicalObject(unsortedPath, "unsorted.json")).toThrow(/not canonical JSON/i);

    const spacedPath = join(root, "spaced.json");
    writeFileSync(spacedPath, '{\n  "a": 1\n}');
    expect(() => readCanonicalObject(spacedPath, "spaced.json")).toThrow(/not canonical JSON/i);
  });

  test("normalizeJson validates and serializes JSON objects and primitives", () => {
    expect(normalizeJson({ b: 2, a: 1 }, "item")).toEqual({ b: 2, a: 1 });
    expect(normalizeJson([1, "two", true, null], "list")).toEqual([1, "two", true, null]);
    expect(normalizeJson("hello", "text")).toBe("hello");
    expect(normalizeJson(42, "number")).toBe(42);
    expect(normalizeJson(false, "boolean")).toBe(false);
    expect(normalizeJson(null, "nil")).toBeNull();

    expect(() => normalizeJson(undefined, "undef")).toThrow(/is not JSON/i);
    expect(() => normalizeJson(() => {}, "fn")).toThrow(/is not JSON/i);
    expect(() => normalizeJson({ num: 100n }, "bigint")).toThrow(/is not JSON/i);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => normalizeJson(circular, "circ")).toThrow(/is not JSON/i);
  });

  test("test_manifest_and_state_use_bounded_descriptor_reads", () => {
    const root = scratchRoot(import.meta.path, "bounded-descriptor-reads");
    const path = join(root, "manifest.json");
    writeFileSync(path, '{"a":1}');
    expect(readCanonicalObject(path, "manifest.json", { maxBytes: 8 })).toEqual({ a: 1 });
    expect(sha256Bytes(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
