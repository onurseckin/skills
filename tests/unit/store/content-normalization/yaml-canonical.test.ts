import { describe, expect, test } from "bun:test";
import { canonicalizeYaml } from "../../../../orchestrating-long-tasks/scripts/src/store/content-normalization/yaml-canonical.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function eq(left: string, right: string): void {
  expect(canonicalizeYaml(encode(left))).toEqual(canonicalizeYaml(encode(right)));
  expect(canonicalizeYaml(encode(left))).toBeDefined();
}

function neq(left: string, right: string): void {
  expect(canonicalizeYaml(encode(left))).not.toEqual(canonicalizeYaml(encode(right)));
}

describe("canonicalizeYaml: formatting-only differences compare equal", () => {
  test("reordered mapping keys", () => {
    eq("a: 1\nb: 2\n", "b: 2\na: 1\n");
  });

  test("trailing whitespace and blank lines", () => {
    eq("a: 1  \n\nb: 2\n", "a: 1\nb: 2\n");
  });

  test("a trailing comment", () => {
    eq("a: 1 # note\n", "a: 1\n");
  });

  test("single versus double quoting of the same string value", () => {
    eq("name: 'hi'\n", 'name: "hi"\n');
  });

  test("flow versus block sequence of the same items", () => {
    eq("items: [1, 2, 3]\n", "items:\n  - 1\n  - 2\n  - 3\n");
  });

  test("flow versus block mapping of the same entries", () => {
    eq("point: {x: 1, y: 2}\n", "point:\n  x: 1\n  y: 2\n");
  });

  test("extra spacing inside a flow sequence", () => {
    eq("items: [1,2,3]\n", "items: [ 1, 2, 3 ]\n");
  });
});

describe("canonicalizeYaml: real structural differences compare unequal", () => {
  test("changed indentation that moves a key to a different parent", () => {
    neq("a:\n  b: 1\n  c: 2\n", "a:\n  b: 1\nc: 2\n");
  });

  test("a different scalar value", () => {
    neq("a: 1\n", "a: 2\n");
  });

  test("an unquoted number versus the same text as a quoted string", () => {
    neq("a: 42\n", 'a: "42"\n');
  });

  test("a list item removed", () => {
    neq("items:\n  - 1\n  - 2\n", "items:\n  - 1\n");
  });

  test("nesting depth genuinely differs", () => {
    neq("a:\n  b:\n    c: 1\n", "a:\n  b:\n  c: 1\n");
  });
});

describe("canonicalizeYaml: block sequences of mappings", () => {
  test("aligned inline-mapping sequence items parse and compare equal under reformatting", () => {
    const left = "items:\n  - name: a\n    value: 1\n  - name: b\n    value: 2\n";
    const right = "items:\n  - name: a\n    value: 1\n  - name: b\n    value: 2\n";
    eq(left, right);
  });

  test("changing a nested value inside a sequence-of-mappings is a real difference", () => {
    neq("items:\n  - name: a\n    value: 1\n", "items:\n  - name: a\n    value: 2\n");
  });
});

describe("canonicalizeYaml: scalar type inference", () => {
  test("null spellings are equivalent", () => {
    eq("a: null\n", "a: ~\n");
  });

  test("boolean spellings are equivalent", () => {
    eq("a: true\n", "a: True\n");
  });

  test("a quoted null-looking string is a real string, not null", () => {
    neq("a: null\n", 'a: "null"\n');
  });
});

describe("canonicalizeYaml: falls back to undefined on unsupported input", () => {
  test("block scalars", () => {
    expect(canonicalizeYaml(encode("a: |\n  line one\n  line two\n"))).toBeUndefined();
  });

  test("anchors and aliases", () => {
    expect(canonicalizeYaml(encode("a: &anchor 1\nb: *anchor\n"))).toBeUndefined();
  });

  test("tags", () => {
    expect(canonicalizeYaml(encode("a: !!str 1\n"))).toBeUndefined();
  });

  test("document markers", () => {
    expect(canonicalizeYaml(encode("---\na: 1\n"))).toBeUndefined();
  });

  test("tab indentation", () => {
    expect(canonicalizeYaml(encode("a:\n\tb: 1\n"))).toBeUndefined();
  });

  test("an unterminated quoted scalar", () => {
    expect(canonicalizeYaml(encode('a: "unterminated\n'))).toBeUndefined();
  });

  test("invalid UTF-8", () => {
    expect(canonicalizeYaml(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeUndefined();
  });
});

describe("canonicalizeYaml: empty documents", () => {
  test("an empty document canonicalizes to null", () => {
    expect(canonicalizeYaml(encode(""))).toEqual(canonicalizeYaml(encode("null\n")));
  });

  test("a document with only comments and blank lines canonicalizes to null", () => {
    expect(canonicalizeYaml(encode("# just a comment\n\n"))).toEqual(canonicalizeYaml(encode("")));
  });
});
