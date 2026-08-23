import { describe, expect, test } from "bun:test";
import {
  contentDigest,
  contentEquals,
  normalizeContent,
} from "../../../../olt/scripts/src/engine/store/content-normalization/normalize.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("normalizeContent: format dispatch", () => {
  test("routes .json files through JSON canonicalisation", () => {
    const result = normalizeContent(encode('{"b":2,"a":1}'), "manifest.json");
    expect(result.method).toBe("json-canonical");
  });

  test("routes .jsonl files through JSONL canonicalisation", () => {
    const result = normalizeContent(encode('{"a":1}\n'), "events.jsonl");
    expect(result.method).toBe("jsonl-canonical");
  });

  test("routes .yaml/.yml files through YAML canonicalisation", () => {
    expect(normalizeContent(encode("a: 1\n"), "config.yaml").method).toBe("yaml-canonical");
    expect(normalizeContent(encode("a: 1\n"), "config.yml").method).toBe("yaml-canonical");
  });

  test("routes .ts/.js files through TypeScript whitespace canonicalisation", () => {
    const result = normalizeContent(encode("const a = 1;\n"), "file.ts");
    expect(result.method).toBe("typescript-whitespace");
  });

  test("falls back to byte-identical for markdown and other unknown formats", () => {
    expect(normalizeContent(encode("- one\n- two\n"), "checklist.md").method).toBe(
      "byte-identical",
    );
    expect(normalizeContent(encode("hello"), "prompt.md").method).toBe("byte-identical");
  });

  test("falls back to byte-identical when a declared JSON file does not actually parse", () => {
    const result = normalizeContent(encode("not json"), "broken.json");
    expect(result.method).toBe("byte-identical");
  });

  test("falls back to byte-identical when a declared YAML file uses an unsupported construct", () => {
    const result = normalizeContent(encode("a: &anchor 1\n"), "config.yaml");
    expect(result.method).toBe("byte-identical");
  });

  test("accepts an explicit ContentFormat in place of a filename", () => {
    expect(normalizeContent(encode('{"a":1}'), "json").method).toBe("json-canonical");
    expect(normalizeContent(encode("plain text"), "unknown").method).toBe("byte-identical");
  });
});

describe("contentDigest", () => {
  test("two byte-different but JSON-equivalent files digest identically and report the method", () => {
    const first = contentDigest(encode('{\n  "a": 1,\n  "b": 2\n}\n'), "state.json");
    const second = contentDigest(encode('{"b":2,"a":1}'), "state.json");
    expect(first.sha256).toBe(second.sha256);
    expect(first.method).toBe("json-canonical");
    expect(second.method).toBe("json-canonical");
  });

  test("markdown digests stay byte-exact even when content is JSON-shaped text", () => {
    const first = contentDigest(encode('{"a":1}'), "notes.md");
    const second = contentDigest(encode('{ "a" : 1 }'), "notes.md");
    expect(first.sha256).not.toBe(second.sha256);
    expect(first.method).toBe("byte-identical");
  });
});

describe("contentEquals", () => {
  test("reports equal with the normalisation method both sides used", () => {
    const comparison = contentEquals(
      encode("function f() {\n  return 1;\n}\n"),
      encode("function f() {\n    return 1;\n}\n"),
      "harness.ts",
    );
    expect(comparison.equal).toBe(true);
    expect(comparison.leftMethod).toBe("typescript-whitespace");
    expect(comparison.rightMethod).toBe("typescript-whitespace");
  });

  test("reports not equal for a genuine content change", () => {
    const comparison = contentEquals(encode("const a = 1;\n"), encode("const a = 2;\n"), "a.ts");
    expect(comparison.equal).toBe(false);
  });

  test("surfaces a mismatched method when one side fails to parse as the declared format", () => {
    const comparison = contentEquals(encode('{"a":1}'), encode("not json"), "state.json");
    expect(comparison.equal).toBe(false);
    expect(comparison.leftMethod).toBe("json-canonical");
    expect(comparison.rightMethod).toBe("byte-identical");
  });
});
