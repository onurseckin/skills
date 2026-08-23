import { describe, expect, test } from "bun:test";
import { detectContentFormat } from "../../../../olt/scripts/src/store/content-normalization/format.ts";

describe("detectContentFormat", () => {
  test("recognizes JSON by extension", () => {
    expect(detectContentFormat("manifest.json")).toBe("json");
    expect(detectContentFormat("MANIFEST.JSON")).toBe("json");
  });

  test("recognizes JSONL and NDJSON by extension", () => {
    expect(detectContentFormat("events.jsonl")).toBe("jsonl");
    expect(detectContentFormat("events.ndjson")).toBe("jsonl");
  });

  test("recognizes YAML by either extension spelling", () => {
    expect(detectContentFormat("config.yaml")).toBe("yaml");
    expect(detectContentFormat("config.yml")).toBe("yaml");
  });

  test("recognizes TypeScript and JavaScript source extensions", () => {
    for (const extension of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(detectContentFormat(`file${extension}`)).toBe("typescript");
    }
  });

  test("falls back to unknown for markdown, unrecognized, and extensionless names", () => {
    expect(detectContentFormat("checklist.md")).toBe("unknown");
    expect(detectContentFormat("README")).toBe("unknown");
    expect(detectContentFormat("archive.tar.gz")).toBe("unknown");
  });

  test("uses only the final extension of a path", () => {
    expect(detectContentFormat("olt/references/cli-capabilities.json")).toBe("json");
    expect(detectContentFormat("a/b/c.test.ts")).toBe("typescript");
  });
});
