import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonBytes, readCanonicalObject, sha256Bytes } from "../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { safeRepoPath } from "../../orchestrating-long-tasks/scripts/src/core/paths.ts";

describe("canonical JSON", () => {
  test("serializes nested JSON deterministically without a newline", () => {
    const encoded = canonicalJsonBytes({ z: 1, nested: { b: true, a: "é" }, a: null });
    expect(new TextDecoder().decode(encoded)).toBe('{"a":null,"nested":{"a":"é","b":true},"z":1}');
  });

  test("test_safe_repo_path_rejects_absolute_parent_and_symlink_escape", () => {
    const root = mkdtempSync(join(tmpdir(), "harness-paths-"));
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
    ]) {
      expect(() => safeRepoPath(repo, unsafe)).toThrow();
    }
    expect(safeRepoPath(repo, "safe/future/file")).toBe(
      join(realpathSync(repo), "safe/future/file"),
    );
  });

  test("bounded parser rejects excessive structural depth", () => {
    const root = mkdtempSync(join(tmpdir(), "harness-json-"));
    const path = join(root, "state.json");
    writeFileSync(path, `{"nested":${"[".repeat(2000)}0${"]".repeat(2000)}}`);
    expect(() => readCanonicalObject(path, "state.json", { maxDepth: 128 })).toThrow(/depth/i);
  });

  test("bounded parser rejects an oversized descriptor before decoding", () => {
    const root = mkdtempSync(join(tmpdir(), "harness-json-"));
    const path = join(root, "state.json");
    writeFileSync(path, JSON.stringify({ padding: "x".repeat(256) }));
    expect(() => readCanonicalObject(path, "state.json", { maxBytes: 128 })).toThrow(/size limit/i);
  });

  test("test_manifest_and_state_use_bounded_descriptor_reads", () => {
    const root = mkdtempSync(join(tmpdir(), "harness-json-"));
    const path = join(root, "manifest.json");
    writeFileSync(path, '{"a":1}');
    expect(readCanonicalObject(path, "manifest.json", { maxBytes: 8 })).toEqual({ a: 1 });
    expect(sha256Bytes(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
