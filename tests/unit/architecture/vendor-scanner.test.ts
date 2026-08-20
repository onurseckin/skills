import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  identifierWords,
  scanSourceForVendorIdentifiers,
  scanTreeForVendorIdentifiers,
  staleExemptions,
  stripCommentsAndStrings,
} from "../../../orchestrating-long-tasks/scripts/src/health/vendor-identifiers.ts";

const roots: string[] = [];

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "vendor-scan-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("blanking literals before the scan", () => {
  test("keeps line numbers so a finding points at the line it is on", () => {
    const stripped = stripCommentsAndStrings('const a = 1;\n// playwright\nconst b = "x";\n');
    expect(stripped.split("\n").length).toBe(4);
    expect(stripped.split("\n")[1]).not.toContain("playwright");
  });

  test("a product name inside a string or a comment is a value, not a name", () => {
    const findings = scanSourceForVendorIdentifiers(
      ['const runner = "playwright";', "// cypress is a runner too", "/* and vitest */"].join("\n"),
      "sample.ts",
    );
    expect(findings).toEqual([]);
  });

  test("an escaped quote does not end the string early", () => {
    expect(
      scanSourceForVendorIdentifiers('const a = "he said \\"jest\\" loudly";', "s.ts"),
    ).toEqual([]);
  });

  test("a template's text is a literal but its interpolation is code again", () => {
    const findings = scanSourceForVendorIdentifiers(
      "const message = `ran vitest with ${cypressRunner} and ${`${nested}`}`;",
      "s.ts",
    );
    expect(findings.map((finding) => finding.identifier)).toEqual(["cypressRunner"]);
  });

  test("a string inside an interpolation is a literal again", () => {
    expect(
      scanSourceForVendorIdentifiers('const a = `${speaks("mysql") ? "x" : "y"}`;', "s.ts"),
    ).toEqual([]);
  });

  test("a regular expression body is a literal, quotes inside it included", () => {
    const findings = scanSourceForVendorIdentifiers(
      ["const pattern = /playwright|'/u;", "const jestValue = 1;"].join("\n"),
      "s.ts",
    );
    expect(findings.map((finding) => finding.identifier)).toEqual(["jestValue"]);
    expect(findings[0]?.line).toBe(2);
  });

  test("a division is not the start of a regular expression", () => {
    const findings = scanSourceForVendorIdentifiers(
      "const half = total / 2;\nconst jestRun = 1;",
      "s.ts",
    );
    expect(findings.map((finding) => finding.identifier)).toEqual(["jestRun"]);
  });

  test("an escape inside a regular expression does not close it", () => {
    expect(scanSourceForVendorIdentifiers("const pattern = /a\\/playwright/u;", "s.ts")).toEqual(
      [],
    );
  });

  test("an unterminated block comment swallows the rest of the file", () => {
    expect(scanSourceForVendorIdentifiers("const a = 1;\n/* playwright", "s.ts")).toEqual([]);
  });
});

describe("splitting an identifier into the words it is made of", () => {
  test("reads snake case, camel case and screaming case alike", () => {
    expect(identifierWords("bun_version")).toEqual(["bun", "version"]);
    expect(identifierWords("BunSpawnApi")).toEqual(["bun", "spawn", "api"]);
    expect(identifierWords("PLAYWRIGHT_REPORT_PATH")).toEqual(["playwright", "report", "path"]);
    expect(identifierWords("readXMLReport")).toEqual(["read", "xml", "report"]);
  });

  test("a product name buried in a longer word is not a match", () => {
    expect(scanSourceForVendorIdentifiers("const invited = 1;", "s.ts")).toEqual([]);
  });
});

describe("scanning a tree", () => {
  test("finds the identifier, the line and the product it names", () => {
    const root = tree({ "src/a.ts": "const x = 1;\nexport interface PlaywrightMetadata {}\n" });
    expect(scanTreeForVendorIdentifiers(root)).toEqual([
      {
        file: "src/a.ts",
        line: 2,
        position: "identifier",
        identifier: "PlaywrightMetadata",
        vendor: "playwright",
      },
    ]);
  });

  test("a module named after a product is itself a finding", () => {
    const root = tree({ "src/cypressHarness.ts": "export const value = 1;\n" });
    expect(scanTreeForVendorIdentifiers(root)).toEqual([
      {
        file: "src/cypressHarness.ts",
        line: 0,
        position: "path",
        identifier: "cypressHarness.ts",
        vendor: "cypress",
      },
    ]);
  });

  test("a directory named after a product is a finding too", () => {
    const root = tree({ "src/vitest/runner.ts": "export const value = 1;\n" });
    expect(scanTreeForVendorIdentifiers(root).map((finding) => finding.identifier)).toEqual([
      "vitest",
    ]);
  });

  test("an exempt path is skipped, and only that path", () => {
    const root = tree({
      "src/grammar.ts": "const JEST_FLAGS = 1;\n",
      "src/other.ts": "const MOCHA_FLAGS = 1;\n",
    });
    const findings = scanTreeForVendorIdentifiers(root, { exempt: ["src/grammar.ts"] });
    expect(findings.map((finding) => finding.vendor)).toEqual(["mocha"]);
  });

  test("an exempt directory covers what is below it", () => {
    const root = tree({ "src/vendors/a.ts": "const ESLINT_FLAGS = 1;\n" });
    expect(scanTreeForVendorIdentifiers(root, { exempt: ["src/vendors"] })).toEqual([]);
  });

  test("files the scan does not cover are left alone", () => {
    const root = tree({ "src/a.md": "PlaywrightMetadata\n", "src/b.tsx": "const yarnLock = 1;\n" });
    expect(scanTreeForVendorIdentifiers(root).map((finding) => finding.vendor)).toEqual(["yarn"]);
  });

  test("hidden directories and installed packages are not this repository's code", () => {
    const root = tree({
      "node_modules/pkg/index.ts": "const PlaywrightThing = 1;\n",
      ".cache/x.ts": "const CypressThing = 1;\n",
      "src/keep.ts": "export const value = 1;\n",
    });
    expect(scanTreeForVendorIdentifiers(root)).toEqual([]);
  });

  test("a root that is a file, not a directory, yields nothing", () => {
    const root = tree({ "src/a.ts": "const PlaywrightThing = 1;\n" });
    expect(scanTreeForVendorIdentifiers(join(root, "src/a.ts"))).toEqual([]);
  });

  test("an exemption for a path that is gone is reported so it can be removed", () => {
    const root = tree({ "src/a.ts": "export const value = 1;\n" });
    expect(staleExemptions(root, ["src/a.ts", "src/retired.ts"])).toEqual(["src/retired.ts"]);
  });
});
