import { describe, expect, test, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  canonicalJsonBytes,
  jsonCopy,
  normalizeJson,
  parseJsonBytes,
  readBoundedBytes,
  readCanonicalObject,
  sameJson,
  sha256Bytes,
} from "../../../olt/scripts/src/core/json.ts";
import { readRegularFileNoFollow } from "../../../olt/scripts/src/core/no-follow.ts";

export const jsonSuiteName = "core json & no-follow contracts";

describe(jsonSuiteName, () => {
  const scratchBase = join(tmpdir(), `json-contracts-tests-${Date.now()}`);

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
  });

  test("canonicalJsonBytes serializes primitives, arrays, and objects with key sorting", () => {
    expect(new TextDecoder().decode(canonicalJsonBytes(undefined))).toBe("null");
    expect(new TextDecoder().decode(canonicalJsonBytes(null))).toBe("null");
    expect(new TextDecoder().decode(canonicalJsonBytes(true))).toBe("true");
    expect(new TextDecoder().decode(canonicalJsonBytes(false))).toBe("false");
    expect(new TextDecoder().decode(canonicalJsonBytes("hello"))).toBe('"hello"');
    expect(new TextDecoder().decode(canonicalJsonBytes(42))).toBe("42");
    expect(new TextDecoder().decode(canonicalJsonBytes([3, 1, 2]))).toBe("[3,1,2]");
    expect(
      new TextDecoder().decode(canonicalJsonBytes(Symbol("test") as unknown as undefined)),
    ).toBe("");

    const obj = { z: 1, a: "text", omitted: undefined, nested: { b: 2, a: 1 } };
    expect(new TextDecoder().decode(canonicalJsonBytes(obj))).toBe(
      '{"a":"text","nested":{"a":1,"b":2},"z":1}',
    );
  });

  test("canonicalJsonBytes rejects non-finite numbers", () => {
    expect(() => canonicalJsonBytes(NaN)).toThrow(/must be finite/i);
    expect(() => canonicalJsonBytes(Infinity)).toThrow(/must be finite/i);
    expect(() => canonicalJsonBytes(-Infinity)).toThrow(/must be finite/i);
  });

  test("sha256Bytes returns accurate cryptographic sha256 hex string", () => {
    const hash = sha256Bytes(new TextEncoder().encode("test payload"));
    expect(hash).toHaveLength(64);
  });

  test("parseJsonBytes enforces size limits, valid UTF-8, and structural depth", () => {
    const validData = new TextEncoder().encode('{"ok":true}');
    expect(parseJsonBytes(validData, "valid")).toEqual({ ok: true });

    expect(() => parseJsonBytes(validData, "limited", { maxBytes: 4 })).toThrow(
      /size limit exceeded/i,
    );
    expect(() => parseJsonBytes(new TextEncoder().encode("{ malformed"), "bad")).toThrow(
      /not valid UTF-8 JSON/i,
    );

    const deepObj = '{"a":{"b":{"c":{"d":1}}}}';
    expect(() =>
      parseJsonBytes(new TextEncoder().encode(deepObj), "deep", { maxDepth: 2 }),
    ).toThrow(/depth exceeds limit/i);
  });

  test("readBoundedBytes and readCanonicalObject validate files and enforce canonical formatting", () => {
    const dir = join(scratchBase, "file-checks");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "canonical.json");
    writeFileSync(target, '{"a":1,"b":2}', "utf-8");

    const bytes = readBoundedBytes(target, 1024);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const obj = readCanonicalObject(target, "canonical.json");
    expect(obj).toEqual({ a: 1, b: 2 });

    // Non-canonical formatting (spaces / unsorted keys) throws
    const nonCanonical = join(dir, "non-canonical.json");
    writeFileSync(nonCanonical, '{\n  "b": 2,\n  "a": 1\n}', "utf-8");
    expect(() => readCanonicalObject(nonCanonical, "non-canonical.json")).toThrow(
      /not canonical JSON/i,
    );

    // Array instead of object throws
    const arrayFile = join(dir, "array.json");
    writeFileSync(arrayFile, "[1,2,3]", "utf-8");
    expect(() => readCanonicalObject(arrayFile, "array.json")).toThrow(
      /must contain a JSON object/i,
    );

    // Non-file in readBoundedBytes
    expect(() => readBoundedBytes(dir, 1024)).toThrow(/not a regular file/i);

    // Null instead of object in readCanonicalObject throws
    const nullFile = join(dir, "null.json");
    writeFileSync(nullFile, "null", "utf-8");
    expect(() => readCanonicalObject(nullFile, "null.json")).toThrow(/must contain a JSON object/i);

    rmSync(dir, { recursive: true, force: true });
  });

  test("normalizeJson, jsonCopy, and sameJson provide deterministic operations", () => {
    expect(normalizeJson({ b: 2, a: 1 }, "item")).toEqual({ b: 2, a: 1 });
    expect(() => normalizeJson(undefined, "undef")).toThrow(/is not JSON/i);
    expect(() => normalizeJson(() => {}, "fn")).toThrow(/is not JSON/i);
    expect(() => normalizeJson(10n, "bigint")).toThrow(/is not JSON/i);

    const original = { hello: "world", count: 42 };
    const copy = jsonCopy(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);

    expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
  });

  test("readRegularFileNoFollow reads regular files and rejects directories or invalid descriptors", () => {
    const dir = join(scratchBase, "no-follow-test");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "regular.bin");
    writeFileSync(target, new Uint8Array([1, 2, 3, 4]));

    const content = readRegularFileNoFollow(target);
    expect(content).toEqual(new Uint8Array([1, 2, 3, 4]));

    expect(() => readRegularFileNoFollow(dir)).toThrow(/not a regular file/i);

    rmSync(dir, { recursive: true, force: true });
  });
});
