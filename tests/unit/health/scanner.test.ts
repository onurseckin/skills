import { afterAll, describe, expect, test } from "bun:test";
import {
  lineOf,
  scanSource,
} from "../../../orchestrating-long-tasks/scripts/src/health/scanner.ts";
import { cleanupTempRoots } from "./fixture.ts";

afterAll(cleanupTempRoots);

describe("the lexical scan separates code from what only looks like code", () => {
  test("a comment is removed from both views and kept as a record", () => {
    const scanned = scanSource(
      ["const a = 1; // trailing note", "/* block */ const b = 2;"].join("\n"),
    );
    expect(scanned.code).not.toContain("trailing note");
    expect(scanned.identifiers).not.toContain("block");
    expect(scanned.comments.map((entry) => entry.block)).toEqual([false, true]);
    expect(scanned.comments[0]?.line).toBe(1);
    expect(scanned.comments[1]?.line).toBe(2);
  });

  test("every view keeps the original offsets, so a match still names its line", () => {
    const text = ["// note", "const value = 1;", "/* two", "   lines */", "const other = 2;"].join(
      "\n",
    );
    const scanned = scanSource(text);
    expect(scanned.code).toHaveLength(text.length);
    expect(scanned.identifiers).toHaveLength(text.length);
    expect(lineOf(scanned.code, scanned.code.indexOf("other"))).toBe(5);
  });

  test("a literal survives in the code view and is blanked in the identifier view", () => {
    const scanned = scanSource('const label = "playwright";');
    expect(scanned.code).toContain('"playwright"');
    expect(scanned.identifiers).not.toContain("playwright");
  });

  test("an escaped quote does not end the literal", () => {
    const scanned = scanSource('const quoted = "a \\" b"; const after = 1;');
    expect(scanned.identifiers).toContain("after");
    expect(scanned.identifiers).not.toContain("b");
  });

  test("a regular expression containing a slash pair is not read as a comment", () => {
    const scanned = scanSource("const pattern = /\\/\\//u; const after = 2;");
    expect(scanned.code).toContain("after");
    expect(scanned.comments).toHaveLength(0);
  });

  test("division is still division", () => {
    const scanned = scanSource("const half = total / 2; const after = 3;");
    expect(scanned.code).toContain("after");
  });

  test("a template interpolation is code, and its text is not", () => {
    const scanned = scanSource("const line = `run ${command} now`;");
    expect(scanned.identifiers).toContain("command");
    expect(scanned.identifiers).not.toContain("run");
    expect(scanned.code).toContain("run");
  });

  test("a nested template inside an interpolation closes at the right place", () => {
    const scanned = scanSource("const s = `a${`b${inner}c`}d`; const after = 4;");
    expect(scanned.identifiers).toContain("inner");
    expect(scanned.identifiers).toContain("after");
    expect(scanned.identifiers).not.toContain("d`");
  });

  test("a block inside an interpolation closes at its own brace, not the template's", () => {
    const scanned = scanSource("const s = `${ { inner: 1 }.inner }`; const after = 6;");
    expect(scanned.identifiers).toContain("inner");
    expect(scanned.identifiers).toContain("after");
  });

  test("an unterminated literal ends at the end of the file rather than looping", () => {
    expect(scanSource('const broken = "unclosed').code).toContain("broken");
    expect(scanSource("const broken = `unclosed").code).toContain("broken");
    expect(scanSource("const broken = /unclosed").code).toContain("broken");
  });

  test("a character class may hold the delimiter without ending the pattern", () => {
    const scanned = scanSource("const pattern = /[/]/u; const after = 5;");
    expect(scanned.code).toContain("after");
  });

  test("lineOf clamps to the text it was given", () => {
    expect(lineOf("a\nb", 999)).toBe(2);
    expect(lineOf("", 0)).toBe(1);
  });
});
