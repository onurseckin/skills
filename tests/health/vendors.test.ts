import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkVendorIdentifiers } from "../../olt/scripts/src/health/vendors.ts";
import { VENDOR_NAMES } from "../../olt/scripts/src/health/vendor-names.ts";
import { cleanupTempRoots, tempRoot, writeTree } from "./fixture.ts";

afterAll(cleanupTempRoots);

function scan(files: Record<string, string>, exempt?: readonly string[]) {
  const root = writeTree(tempRoot("vendor"), files);
  return checkVendorIdentifiers([
    { label: "producer", root, ...(exempt === undefined ? {} : { exempt }) },
  ]);
}

describe("a vendor name is a value, never a name in the schema", () => {
  test("a type named after one tool is reported", () => {
    const findings = scan({
      "shape.ts": "export interface PlaywrightMetadata {\n  browser: string;\n}\n",
    }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toContain("PlaywrightMetadata");
    expect(findings[0]?.line).toBe(1);
  });

  test("a file named after a product is reported even when its code is clean", () => {
    const findings = scan({ "vitest-runner.ts": "export const runner = 1;\n" }).findings;
    expect(findings[0]?.detail).toContain("path segment");
    // The finding is about the file's name, so it carries no line: `:0` would name a place that
    // does not exist in the file.
    expect(findings[0]?.line).toBeUndefined();
  });

  test("a vendor name recorded as a value is exactly what the rule permits", () => {
    expect(scan({ "value.ts": 'export const tool = "playwright";\n' }).findings).toEqual([]);
  });

  test("a vendor name in prose is not an identifier", () => {
    expect(
      scan({ "note.ts": "// playwright writes this file\nexport const a = 1;\n" }).findings,
    ).toEqual([]);
  });
});

describe("an exemption is a decision, and it cannot outlive what it covered", () => {
  test("an exempt path is not reported", () => {
    expect(
      scan({ "adapters/playwright-report.ts": "export const a = 1;\n" }, ["adapters"]).findings,
    ).toEqual([]);
  });

  test("an exemption for a path that no longer exists is itself a finding", () => {
    const findings = scan({ "clean.ts": "export const a = 1;\n" }, ["adapters/gone.ts"]).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toContain("no longer exists");
  });
});

describe("the sweep says which trees it covered and which names it cannot see", () => {
  test("a tree that does not exist is reported, never silently counted as clean", () => {
    const findings = checkVendorIdentifiers([
      { label: "consumer", root: join(tempRoot("absent"), "missing") },
    ]).findings;
    expect(findings[0]?.detail).toContain("was not swept");
  });

  test("both trees are named in the limitations", () => {
    const result = checkVendorIdentifiers([
      { label: "producer", root: writeTree(tempRoot("p"), { "a.ts": "export const a = 1;\n" }) },
      { label: "consumer", root: writeTree(tempRoot("c"), { "b.ts": "export const b = 2;\n" }) },
    ]);
    expect(result.scanned).toBe(2);
    expect(result.limitations.join(" ")).toContain("producer");
    expect(result.limitations.join(" ")).toContain("consumer");
  });

  test("the names the list deliberately omits are declared unseeable", () => {
    expect(VENDOR_NAMES).not.toContain("cursor");
    expect(VENDOR_NAMES).not.toContain("bun");
    expect(checkVendorIdentifiers([]).limitations.join(" ")).toContain(
      "cannot be detected here at all",
    );
  });
});
