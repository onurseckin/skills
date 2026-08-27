import { expect, test } from "bun:test";
import {
  buildImportEdges,
  findExportStarViolations,
  findFacadeViolations,
  findMissingFacades,
  resolveImport,
} from "../../../../../scripts/modularity/graph/index.ts";
import { blob, indexedDirectory } from "./graph-fixture.ts";

test("resolves exact files, extensions, then directory facades", () => {
  const paths = ["slice/a.ts", "slice/b.ts", "slice/target/index.ts"];
  expect(
    resolveImport({ from: "slice/a.ts", specifier: "./b", typeOnly: false, kind: "import" }, paths),
  ).toBe("slice/b.ts");
  expect(
    resolveImport(
      { from: "slice/a.ts", specifier: "./target", typeOnly: false, kind: "import" },
      paths,
    ),
  ).toBe("slice/target/index.ts");
  expect(() =>
    resolveImport(
      { from: "slice/a.ts", specifier: "./missing", typeOnly: false, kind: "import" },
      paths,
    ),
  ).toThrow("Unable to resolve relative import");
});

test.each(["olt/scripts", "scripts", "scripts/testing"])(
  "requires a facade for direct TypeScript in %s",
  (directory) => {
    const findings = findMissingFacades(indexedDirectory(directory, ["entry.ts"]));
    expect(findings.map((finding) => finding.path)).toContain(directory);
  },
);

test("permits same-directory imports but rejects a cross-directory private target", () => {
  const blobs = [
    blob("one/source.ts", 'import { local } from "./local.ts";'),
    blob("one/local.ts", "export const local = 1;"),
    blob("two/source.ts", 'import { hidden } from "../one/local.ts";'),
  ];
  const edges = buildImportEdges(blobs);

  expect(findFacadeViolations(edges)).toEqual([
    expect.objectContaining({
      rule: "facade_bypass",
      path: "two/source.ts",
      observed: "one/local.ts",
    }),
  ]);
});

test("permits a cross-directory facade target", () => {
  const edges = buildImportEdges([
    blob("one/index.ts", "export const publicValue = 1;"),
    blob("two/source.ts", 'import { publicValue } from "../one";'),
  ]);

  expect(findFacadeViolations(edges)).toEqual([]);
});

test("resolves a decoded escaped module specifier", () => {
  const edges = buildImportEdges([
    blob("slice/source.ts", 'import "./\\u0066oo.ts";'),
    blob("slice/foo.ts", "export const value = 1;"),
  ]);

  expect(edges).toEqual([
    expect.objectContaining({ from: "slice/source.ts", to: "slice/foo.ts", typeOnly: false }),
  ]);
});

test("reports export-star separately", () => {
  expect(
    findExportStarViolations([blob("slice/index.ts", 'export * from "./private.ts";')]),
  ).toEqual([expect.objectContaining({ rule: "export_star", path: "slice/index.ts" })]);
});
