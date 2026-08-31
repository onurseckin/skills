import { describe, expect, test } from "bun:test";
import { canonicalizeEcmaScriptWhitespace } from "../../../olt/scripts/src/engine/store/content-normalization/ecmascript-whitespace.ts";

function eq(left: string, right: string): void {
  expect(canonicalizeEcmaScriptWhitespace(left)).toBe(canonicalizeEcmaScriptWhitespace(right));
}

function neq(left: string, right: string): void {
  expect(canonicalizeEcmaScriptWhitespace(left)).not.toBe(canonicalizeEcmaScriptWhitespace(right));
}

describe("canonicalizeEcmaScriptWhitespace: formatter-only differences compare equal", () => {
  test("reindentation", () => {
    eq("function f() {\n  return 1;\n}\n", "function f() {\n    return 1;\n}\n");
  });

  test("tabs versus spaces for indentation", () => {
    eq("if (x) {\n\treturn 1;\n}\n", "if (x) {\n  return 1;\n}\n");
  });

  test("extra blank lines collapse to the same form", () => {
    eq("const a = 1;\n\nconst b = 2;\n", "const a = 1;\n\n\n\nconst b = 2;\n");
  });

  test("trailing whitespace is insignificant", () => {
    eq("const a = 1;   \nconst b = 2;\n", "const a = 1;\nconst b = 2;\n");
  });

  test("extra horizontal spacing around operators", () => {
    eq("const a = 1 + 2;\n", "const a  =  1  +  2;\n");
  });

  test("leading blank lines are insignificant", () => {
    eq("\n\nconst a = 1;\n", "const a = 1;\n");
  });

  test("no trailing newline versus a trailing newline", () => {
    eq("const a = 1;", "const a = 1;\n");
  });
});

describe("canonicalizeEcmaScriptWhitespace: string and template content is preserved verbatim", () => {
  test("whitespace inside a single-quoted string is data, not formatting", () => {
    neq("const a = 'x  y';\n", "const a = 'x y';\n");
  });

  test("whitespace inside a double-quoted string is data", () => {
    neq('const a = "x  y";\n', 'const a = "x y";\n');
  });

  test("whitespace inside a template literal is data", () => {
    neq("const a = `x  y`;\n", "const a = `x y`;\n");
  });

  test("a template literal with an interpolation survives round-trip and is compared verbatim", () => {
    eq(
      "const a = `Hello ${name}, you are ${age} years old`;\n",
      "const a = `Hello ${name}, you are ${age} years old`;\n",
    );
    neq("const a = `Hello ${ name }`;\n", "const a = `Hello ${name}`;\n");
  });

  test("a nested template literal inside an interpolation is handled", () => {
    const source = "const a = `outer ${`inner ${x}`} end`;\n";
    expect(canonicalizeEcmaScriptWhitespace(source)).toBeDefined();
    eq(source, source);
  });

  test("reformatting code outside a string still normalizes even though the string is protected", () => {
    eq("const a = 'keep  me';\n", "const   a   =   'keep  me';\n");
  });

  test("escaped quotes inside strings do not end the string early", () => {
    eq("const a = 'it\\'s here';\n  const b = 1;\n", "const a = 'it\\'s here';\nconst b = 1;\n");
  });
});

describe("canonicalizeEcmaScriptWhitespace: comments", () => {
  test("indentation around a line comment is still insignificant", () => {
    eq("// a comment\nconst a = 1;\n", "  // a comment\n  const   a   =   1;\n");
  });

  test("block comments spanning multiple lines are preserved", () => {
    const source = "/* line one\n   line two */\nconst a = 1;\n";
    expect(canonicalizeEcmaScriptWhitespace(source)).toBeDefined();
  });
});

describe("canonicalizeEcmaScriptWhitespace: regex versus division", () => {
  test("division after an identifier is not mistaken for a regex", () => {
    eq("const a = total / 2;\n", "const a = total  /  2;\n");
  });

  test("division after a number is not mistaken for a regex", () => {
    eq("const a = 10 / 2;\n", "const a = 10  /  2;\n");
  });

  test("a regex literal after return is recognized and its content preserved", () => {
    neq("function f() { return /a  b/; }\n", "function f() { return /a b/; }\n");
  });

  test("a regex literal after an assignment is recognized", () => {
    neq("const pattern = /x  y/g;\n", "const pattern = /x y/g;\n");
  });
});

describe("canonicalizeEcmaScriptWhitespace: genuine content changes compare unequal", () => {
  test("a renamed identifier is a real difference", () => {
    neq("const a = 1;\n", "const b = 1;\n");
  });

  test("an added statement is a real difference", () => {
    neq("const a = 1;\n", "const a = 1;\nconst b = 2;\n");
  });

  test("a changed numeric literal is a real difference", () => {
    neq("const a = 1;\n", "const a = 2;\n");
  });

  test("removing an entire blank-line-separated statement is a real difference, not just a spacing change", () => {
    neq("const a = 1;\n\nconst b = 2;\n", "const a = 1;\n");
  });
});

describe("canonicalizeEcmaScriptWhitespace: numbers, regex, and template expressions", () => {
  test("handles decimal numbers correctly", () => {
    eq("const a = 123.456;\n", "const a = 123.456;");
    eq("const a = 0.5 + .25;\n", "const a = 0.5 + .25;\n");
  });

  test("handles regex with escapes, classes, and flags", () => {
    eq("const r = /foo\\/bar[a-z\\]]/gi;\n", "const r = /foo\\/bar[a-z\\]]/gi;\n");
  });

  test("handles complex template expressions with objects, strings, comments, and regexes", () => {
    const complex =
      "const a = `${ { a: 'hello', b: \"world\" } } ${ `nested ${ /regex/i.test(s) }` } ${ // line comment\n /* block */ 123 } ${ (x) / 2 } ${ arr[0] / 2 }`;\n";
    expect(canonicalizeEcmaScriptWhitespace(complex)).toBeDefined();
  });

  test("handles CRLF and CR linebreaks", () => {
    eq("const a = 1;\r\nconst b = 2;\r\n", "const a = 1;\nconst b = 2;\n");
    eq("const a = 1;\rconst b = 2;\r", "const a = 1;\nconst b = 2;\n");
  });

  test("handles escaped backslashes in template literals", () => {
    const escaped = "const a = `\\` ${x} \\``;\n";
    expect(canonicalizeEcmaScriptWhitespace(escaped)).toBeDefined();
  });
});

describe("canonicalizeEcmaScriptWhitespace: falls back to undefined on unsupported input", () => {
  test("an unterminated string literal", () => {
    expect(canonicalizeEcmaScriptWhitespace("const a = 'unterminated;\n")).toBeUndefined();
    expect(canonicalizeEcmaScriptWhitespace("const a = 'unterminated")).toBeUndefined();
  });

  test("an unterminated template literal", () => {
    expect(canonicalizeEcmaScriptWhitespace("const a = `unterminated;\n")).toBeUndefined();
    expect(canonicalizeEcmaScriptWhitespace("const a = `unterminated")).toBeUndefined();
  });

  test("an unterminated template expression", () => {
    expect(canonicalizeEcmaScriptWhitespace("const a = `${unterminated;\n")).toBeUndefined();
  });

  test("an unterminated block comment", () => {
    expect(canonicalizeEcmaScriptWhitespace("/* unterminated\nconst a = 1;\n")).toBeUndefined();
    expect(canonicalizeEcmaScriptWhitespace("/* unterminated")).toBeUndefined();
  });

  test("a regex literal that never closes before a line break", () => {
    expect(canonicalizeEcmaScriptWhitespace("const a = /unterminated\n;\n")).toBeUndefined();
    expect(canonicalizeEcmaScriptWhitespace("const a = /unterminated")).toBeUndefined();
  });

  test("division following an identifier inside a template expression", () => {
    const code = "const msg = `${total / count + val / 2}`;";
    expect(canonicalizeEcmaScriptWhitespace(code)).toBe(code);
  });
});
