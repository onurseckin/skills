import { describe, expect, it } from "bun:test";
import {
  isIdentStart,
  isIdentPart,
  isDigit,
  scanQuotedString,
  scanLineComment,
  scanBlockComment,
  scanTemplateLiteral,
  scanTemplateExpression,
  scanRegexLiteral,
  scanNumberLiteral,
  UnsupportedSyntax,
} from "../../../../olt/scripts/src/engine/store/content-normalization/ecmascript-scanner.ts";
import { canonicalizeEcmaScriptWhitespace } from "../../../../olt/scripts/src/engine/store/content-normalization/ecmascript-whitespace.ts";
import { detectContentFormat } from "../../../../olt/scripts/src/engine/store/content-normalization/format.ts";
import { canonicalizeJson, canonicalizeJsonl } from "../../../../olt/scripts/src/engine/store/content-normalization/json-canonical.ts";
import {
  normalizeContent,
  contentDigest,
  contentEquals,
} from "../../../../olt/scripts/src/engine/store/content-normalization/normalize.ts";
import { canonicalizeYaml } from "../../../../olt/scripts/src/engine/store/content-normalization/yaml-canonical.ts";
import {
  parseScalarOrFlow,
  parseKeyScalar,
  findDoubleQuotedEnd,
  findSingleQuotedEnd,
  parseDoubleQuoted,
  parseSingleQuoted,
} from "../../../../olt/scripts/src/engine/store/content-normalization/yaml-flow.ts";
import { parsePlainScalar } from "../../../../olt/scripts/src/engine/store/content-normalization/yaml-scalars.ts";

describe("engine/store/content-normalization/ecmascript-scanner.ts", () => {
  it("validates identifier and digit helpers", () => {
    expect(isIdentStart("a")).toBe(true);
    expect(isIdentStart("$")).toBe(true);
    expect(isIdentStart("_")).toBe(true);
    expect(isIdentStart("1")).toBe(false);

    expect(isIdentPart("1")).toBe(true);
    expect(isIdentPart("z")).toBe(true);
    expect(isIdentPart("-")).toBe(false);

    expect(isDigit("5")).toBe(true);
    expect(isDigit("x")).toBe(false);
  });

  it("scans quoted strings and handles escape / multiline errors", () => {
    const text = '"hello \\"world\\"" rest';
    expect(scanQuotedString(text, 0, '"')).toBe(17);
    expect(() => scanQuotedString('"unterminated', 0, '"')).toThrow(UnsupportedSyntax);
    expect(() => scanQuotedString('"spans\nline"', 0, '"')).toThrow(UnsupportedSyntax);
  });

  it("scans comments correctly", () => {
    const lineText = "// comment line\nnext";
    expect(scanLineComment(lineText, 0)).toBe(15);

    const blockText = "/* block comment */rest";
    expect(scanBlockComment(blockText, 0)).toBe(19);
    expect(() => scanBlockComment("/* unclosed", 0)).toThrow(UnsupportedSyntax);
  });

  it("scans template literals and nested expressions", () => {
    const tpl = "`simple template`rest";
    expect(scanTemplateLiteral(tpl, 0)).toBe(17);
    expect(() => scanTemplateLiteral("`unterminated", 0)).toThrow(UnsupportedSyntax);

    const nestedTpl = "`hello ${name + 1} world`rest";
    expect(scanTemplateLiteral(nestedTpl, 0)).toBe(25);
  });

  it("scans regex literals and number literals", () => {
    const regexText = "/[a-z]+/gi rest";
    expect(scanRegexLiteral(regexText, 0)).toBe(10);
    expect(() => scanRegexLiteral("/unterminated", 0)).toThrow(UnsupportedSyntax);

    const numText = "123.456 rest";
    expect(scanNumberLiteral(numText, 0)).toBe(7);
  });
});

describe("engine/store/content-normalization/ecmascript-whitespace.ts", () => {
  it("canonicalizes whitespace in js/ts code", () => {
    const raw = "const  x  =  10 ;\n\nconst  y = 20 ;  ";
    const canon = canonicalizeEcmaScriptWhitespace(raw);
    expect(canon).toBeDefined();
    expect(canon).toContain("const x = 10 ;");
  });
});

describe("engine/store/content-normalization/yaml", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  it("canonicalizes YAML mappings and sequences", () => {
    const yaml = encoder.encode("foo: bar\nbaz:\n  - 1\n  - 2\n");
    const canon = canonicalizeYaml(yaml);
    expect(canon).toBeDefined();
    const json = JSON.parse(decoder.decode(canon!));
    expect(json.foo).toBe("bar");
    expect(json.baz).toEqual([1, 2]);
  });

  it("parses YAML scalars: null, booleans, numbers, strings", () => {
    expect(parsePlainScalar("true")).toBe(true);
    expect(parsePlainScalar("false")).toBe(false);
    expect(parsePlainScalar("null")).toBe(null);
    expect(parsePlainScalar("~")).toBe(null);
    expect(parsePlainScalar("42")).toBe(42);
    expect(parsePlainScalar("3.14")).toBe(3.14);
    expect(parsePlainScalar("hello world")).toBe("hello world");
  });

  it("parses flow mappings and sequences using parseScalarOrFlow", () => {
    expect(parseScalarOrFlow("[1, 2, 3]")).toEqual([1, 2, 3]);
    expect(parseScalarOrFlow('{"a": 1, "b": 2}')).toEqual({ a: 1, b: 2 });
    expect(parseScalarOrFlow('"quoted string"')).toBe("quoted string");
    expect(parseScalarOrFlow("'single quoted'")).toBe("single quoted");
    expect(parseScalarOrFlow("")).toBe(null);
    expect(parseKeyScalar("my_key")).toBe("my_key");
    expect(parseKeyScalar('"quoted_key"')).toBe("quoted_key");
  });
});

describe("engine/store/content-normalization/normalize.ts & format.ts", () => {
  const encoder = new TextEncoder();

  it("detects formats and normalizes content across all formats", () => {
    expect(detectContentFormat("data.json")).toBe("json");
    expect(detectContentFormat("data.jsonl")).toBe("jsonl");
    expect(detectContentFormat("data.yaml")).toBe("yaml");
    expect(detectContentFormat("code.ts")).toBe("typescript");
    expect(detectContentFormat("code.js")).toBe("typescript");

    const jsonBytes = encoder.encode('{"b": 2, "a": 1}');
    const norm = normalizeContent(jsonBytes, "data.json");
    expect(norm.method).toBe("json-canonical");
    expect(norm.normalized).toBeDefined();

    const jsonlBytes = encoder.encode('{"b": 2}\n{"a": 1}\n');
    const normJsonl = normalizeContent(jsonlBytes, "data.jsonl");
    expect(normJsonl.method).toBe("jsonl-canonical");

    const yamlBytes = encoder.encode("a: 1\n");
    const normYaml = normalizeContent(yamlBytes, "data.yaml");
    expect(normYaml.method).toBe("yaml-canonical");

    const tsBytes = encoder.encode("const  x = 10 ;\n");
    const normTs = normalizeContent(tsBytes, "code.ts");
    expect(normTs.method).toBe("typescript-whitespace");

    const digest = contentDigest(jsonBytes, "data.json");
    expect(digest.sha256).toBeDefined();

    const jsonBytes2 = encoder.encode('{\n  "a": 1,\n  "b": 2\n}');
    const eq = contentEquals(jsonBytes, jsonBytes2, "data.json");
    expect(eq.equal).toBe(true);
    expect(eq.leftMethod).toBe("json-canonical");
  });
});
