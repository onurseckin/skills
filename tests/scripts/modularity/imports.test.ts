import { expect, test } from "bun:test";
import {
  buildImportEdges,
  findExportStarViolations,
  findFacadeViolations,
  findMissingFacades,
  resolveImport,
  stronglyConnectedComponents,
  type ImportEdge,
} from "../../../scripts/modularity/graph/index.ts";

function blob(path: string, content: string) {
  return {
    path,
    oid: "a".repeat(40),
    bytes: new TextEncoder().encode(content),
  };
}

function indexedDirectory(directory: string, names: readonly string[]) {
  return names.map((name) => blob(`${directory}/${name}`, "export const a = 1;"));
}

function edge(from: string, to: string): ImportEdge {
  return { from, to, typeOnly: false, viaFacade: true };
}

test("resolves exact files, extensions, then directory facades", () => {
  const paths = [
    "slice/a.ts",
    "slice/b.ts",
    "slice/comp.tsx",
    "slice/mod.mts",
    "slice/comm.cts",
    "slice/target/index.ts",
  ];
  expect(
    resolveImport({ from: "slice/a.ts", specifier: "./b", typeOnly: false, kind: "import" }, paths),
  ).toBe("slice/b.ts");
  expect(
    resolveImport(
      { from: "slice/a.ts", specifier: "./comp", typeOnly: false, kind: "import" },
      paths,
    ),
  ).toBe("slice/comp.tsx");
  expect(
    resolveImport(
      { from: "slice/a.ts", specifier: "./mod", typeOnly: false, kind: "import" },
      paths,
    ),
  ).toBe("slice/mod.mts");
  expect(
    resolveImport(
      { from: "slice/a.ts", specifier: "./comm", typeOnly: false, kind: "import" },
      paths,
    ),
  ).toBe("slice/comm.cts");
  expect(
    resolveImport(
      {
        from: "slice/a.ts",
        specifier: "./target",
        typeOnly: false,
        kind: "import",
      },
      paths,
    ),
  ).toBe("slice/target/index.ts");
  expect(() =>
    resolveImport(
      {
        from: "slice/a.ts",
        specifier: "./missing",
        typeOnly: false,
        kind: "import",
      },
      paths,
    ),
  ).toThrow("Unable to resolve relative import");
  expect(() =>
    resolveImport(
      {
        from: "slice/a.ts",
        specifier: "lodash",
        typeOnly: false,
        kind: "import",
      },
      paths,
    ),
  ).toThrow("Unable to resolve relative import");
  expect(() =>
    resolveImport(
      {
        from: "slice/a.ts",
        specifier: "../../outside.ts",
        typeOnly: false,
        kind: "import",
      },
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

test("findMissingFacades ignores root files and non-importScanned files", () => {
  expect(
    findMissingFacades([blob("index.ts", "export const x = 1;"), blob("data/config.json", "{}")]),
  ).toEqual([]);
});

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
    expect.objectContaining({
      from: "slice/source.ts",
      to: "slice/foo.ts",
      typeOnly: false,
    }),
  ]);
});

test("reports export-star separately", () => {
  expect(
    findExportStarViolations([blob("slice/index.ts", 'export * from "./private.ts";')]),
  ).toEqual([expect.objectContaining({ rule: "export_star", path: "slice/index.ts" })]);
});

test("reports missing-facade bypasses once per edge identity and sorts with tie-break", () => {
  const edges = [
    {
      from: "src/caller.ts",
      to: "src/pkg/private_b.ts",
      typeOnly: false,
      viaFacade: false,
    },
    {
      from: "src/caller.ts",
      to: "src/pkg/private_a.ts",
      typeOnly: false,
      viaFacade: false,
    },
    {
      from: "src/caller.ts",
      to: "src/pkg/private_a.ts",
      typeOnly: false,
      viaFacade: false,
    },
    {
      from: "src/source.ts",
      to: "missing/private.ts",
      typeOnly: false,
      viaFacade: false,
    },
    {
      from: "src/source.ts",
      to: "src/index.ts",
      typeOnly: false,
      viaFacade: true,
    },
  ];

  const violations = findFacadeViolations(edges);
  expect(violations.length).toBe(3);
  expect(violations[0]?.path).toBe("src/caller.ts");
  expect(violations[0]?.observed).toBe("src/pkg/private_a.ts");
  expect(violations[1]?.observed).toBe("src/pkg/private_b.ts");
  expect(violations[2]?.path).toBe("src/source.ts");
});

test("resolves NodeNext ESM .js, .mjs, .cjs, and .jsx imports to source TypeScript files", () => {
  const paths = ["slice/service.ts", "slice/helper.tsx", "slice/module.mts", "slice/common.cts"];
  expect(
    resolveImport(
      { from: "slice/index.ts", specifier: "./service.js", typeOnly: false, kind: "import" },
      paths,
    ),
  ).toBe("slice/service.ts");
  expect(
    resolveImport(
      { from: "slice/index.ts", specifier: "./helper.jsx", typeOnly: false, kind: "import" },
      paths,
    ),
  ).toBe("slice/helper.tsx");
  expect(
    resolveImport(
      { from: "slice/index.ts", specifier: "./module.mjs", typeOnly: false, kind: "import" },
      paths,
    ),
  ).toBe("slice/module.mts");
  expect(
    resolveImport(
      { from: "slice/index.ts", specifier: "./common.cjs", typeOnly: false, kind: "import" },
      paths,
    ),
  ).toBe("slice/common.cts");
});

test("exempts test-to-test cross-directory imports and white-box test imports from facade bypass", () => {
  const edges = [
    {
      from: "tests/a/test.ts",
      to: "tests/helpers/fixture.ts",
      typeOnly: false,
      viaFacade: false,
    },
    {
      from: "tests/core/scope.test.ts",
      to: "src/core/scope.ts",
      typeOnly: false,
      viaFacade: false,
    },
  ];
  expect(findFacadeViolations(edges)).toEqual([]);
});

test("resolves directory facades with .tsx, .mts, and .cts extensions", () => {
  const paths = ["components/ui/index.tsx", "services/auth/index.mts", "common/utils/index.cts"];
  expect(
    resolveImport(
      { from: "app.tsx", specifier: "./components/ui", typeOnly: false, kind: "import" },
      paths,
    ),
  ).toBe("components/ui/index.tsx");
  expect(
    resolveImport(
      { from: "app.ts", specifier: "./services/auth", typeOnly: false, kind: "import" },
      paths,
    ),
  ).toBe("services/auth/index.mts");
  expect(
    resolveImport(
      { from: "app.ts", specifier: "./common/utils", typeOnly: false, kind: "import" },
      paths,
    ),
  ).toBe("common/utils/index.cts");
});

test("findMissingFacades recognizes index.tsx, index.mts, and index.cts as valid facades", () => {
  const blobs = [
    blob("ui/Button.tsx", "export const Button = () => null;"),
    blob("ui/index.tsx", 'export * as Button from "./Button.tsx";'),
    blob("esm/helper.mts", "export const x = 1;"),
    blob("esm/index.mts", 'export * as helper from "./helper.mts";'),
  ];
  expect(findMissingFacades(blobs)).toEqual([]);
});

test("finds a deterministically sorted multi-file cycle", () => {
  expect(
    stronglyConnectedComponents([edge("b.ts", "a.ts"), edge("a.ts", "b.ts"), edge("c.ts", "a.ts")]),
  ).toEqual([["a.ts", "b.ts"]]);
});

test("counts a self-edge and proves removing one cycle edge clears the finding", () => {
  const cycle = [edge("a.ts", "b.ts"), edge("b.ts", "a.ts")];
  expect(stronglyConnectedComponents([...cycle, edge("self.ts", "self.ts")])).toEqual([
    ["a.ts", "b.ts"],
    ["self.ts"],
  ]);
  expect(stronglyConnectedComponents(cycle.slice(0, 1))).toEqual([]);
});
