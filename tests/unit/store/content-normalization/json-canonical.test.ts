import { describe, expect, test } from "bun:test";
import {
  canonicalizeJson,
  canonicalizeJsonl,
} from "../../../../orchestrating-long-tasks/scripts/src/store/content-normalization/json-canonical.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("canonicalizeJson", () => {
  test("treats reordered keys and different indentation as the same canonical form", () => {
    const pretty = encode('{\n  "b": 2,\n  "a": 1\n}\n');
    const compact = encode('{"a":1,"b":2}');
    expect(canonicalizeJson(pretty)).toEqual(canonicalizeJson(compact));
  });

  test("treats a genuinely different value as a different canonical form", () => {
    const original = encode('{"a":1}');
    const changed = encode('{"a":2}');
    expect(canonicalizeJson(original)).not.toEqual(canonicalizeJson(changed));
  });

  test("returns undefined for bytes that are not valid JSON", () => {
    expect(canonicalizeJson(encode("not json"))).toBeUndefined();
  });

  test("returns undefined for invalid UTF-8", () => {
    expect(canonicalizeJson(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeUndefined();
  });
});

describe("canonicalizeJsonl", () => {
  test("tolerates whitespace differences between equivalent lines", () => {
    const loose = encode('{"a": 1, "b": 2}\n{"c":3}\n');
    const tight = encode('{"b":2,"a":1}\n{"c":3}\n');
    expect(canonicalizeJsonl(loose)).toEqual(canonicalizeJsonl(tight));
  });

  test("ignores blank lines between records", () => {
    const withBlanks = encode('{"a":1}\n\n\n{"b":2}\n');
    const withoutBlanks = encode('{"a":1}\n{"b":2}\n');
    expect(canonicalizeJsonl(withBlanks)).toEqual(canonicalizeJsonl(withoutBlanks));
  });

  test("tolerates a missing trailing newline", () => {
    const withNewline = encode('{"a":1}\n');
    const withoutNewline = encode('{"a":1}');
    expect(canonicalizeJsonl(withNewline)).toEqual(canonicalizeJsonl(withoutNewline));
  });

  test("detects a real content change in one line among several", () => {
    const original = encode('{"a":1}\n{"b":2}\n');
    const changed = encode('{"a":1}\n{"b":3}\n');
    expect(canonicalizeJsonl(original)).not.toEqual(canonicalizeJsonl(changed));
  });

  test("returns undefined when any line fails to parse", () => {
    expect(canonicalizeJsonl(encode('{"a":1}\nnot json\n'))).toBeUndefined();
  });

  test("produces an empty canonical form for a file with no records", () => {
    const result = canonicalizeJsonl(encode("\n\n"));
    expect(result).toBeDefined();
    expect(decode(result!)).toBe("");
  });
});
