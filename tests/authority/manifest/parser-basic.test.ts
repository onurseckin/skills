import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseYaml } from "../../../olt/scripts/src/authority/manifest/index.ts";
import {
  cleanupVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

describe("Authority Manifest Parser - Basic YAML Parsing", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });

  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });
  test("parses plain scalars, booleans, numbers, and nulls correctly", () => {
    const yaml = `
string_val: hello world
quoted_val: "escaped \\"quotes\\" and \\nnewlines"
single_quoted: 'single ''quotes'''
int_val: 42
float_val: 3.1415
bool_true: true
bool_yes: yes
bool_on: on
bool_false: false
bool_no: no
bool_off: off
null_val: null
tilde_null: ~
`;
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.string_val).toBe("hello world");
    expect(parsed.quoted_val).toBe('escaped "quotes" and \nnewlines');
    expect(parsed.single_quoted).toBe("single 'quotes'");
    expect(parsed.int_val).toBe(42);
    expect(parsed.float_val).toBe(3.1415);
    expect(parsed.bool_true).toBe(true);
    expect(parsed.bool_yes).toBe(true);
    expect(parsed.bool_on).toBe(true);
    expect(parsed.bool_false).toBe(false);
    expect(parsed.bool_no).toBe(false);
    expect(parsed.bool_off).toBe(false);
    expect(parsed.null_val).toBeNull();
    expect(parsed.tilde_null).toBeNull();
  });

  test("handles single scalar values and JSON fallbacks", () => {
    expect(parseYaml("hello")).toBe("hello");
    expect(parseYaml("12345")).toBe(12345);
    expect(parseYaml('{"foo": "bar"}')).toEqual({ foo: "bar" });
    expect(parseYaml("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  test("handles inline comments and empty documents", () => {
    const yaml = `
# Header comment
key1: value1 # Inline comment 1
key2: 100 # Inline comment 2
`;
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.key1).toBe("value1");
    expect(parsed.key2).toBe(100);

    expect(parseYaml("")).toEqual({});
    expect(parseYaml("   \n\t \n")).toEqual({});
  });

  test("parses multi-line scalars, nested structures, and values containing colons", () => {
    const yaml = `
api_endpoint: "https://localhost:8080/v1"
special_key: "val:1:2"
unquoted_url: https://example.com/api
nested:
  child:
    name: deep_node
    count: 10
literal_text: |
  First line
  Second line
folded_text: >
  Folded line one
  folded line two
`;
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.api_endpoint).toBe("https://localhost:8080/v1");
    expect(parsed.special_key).toBe("val:1:2");
    expect(parsed.unquoted_url).toBe("https://example.com/api");

    const nested = parsed.nested as Record<string, unknown>;
    const child = nested.child as Record<string, unknown>;
    expect(child.name).toBe("deep_node");
    expect(child.count).toBe(10);

    expect(typeof parsed.literal_text).toBe("string");
    expect(parsed.literal_text as string).toContain("First line\nSecond line");

    expect(typeof parsed.folded_text).toBe("string");
    expect(parsed.folded_text as string).toContain("Folded line one folded line two");
  });
});
