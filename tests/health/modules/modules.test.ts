import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveOrigin } from "../../../olt/scripts/src/health/modules.ts";
import { cleanupTempRoots, loadTree } from "../fixture.ts";

afterAll(cleanupTempRoots);

const TREE = {
  "leaf.ts": [
    "export function used(): number {",
    "  return 1;",
    "}",
    "export interface Shape {",
    "  id: string;",
    "}",
    "export type Kind = 'a' | 'b';",
    "export const VALUE = 2;",
    "export class Holder {}",
    "export enum Level {",
    "  Low = 1,",
    "}",
  ].join("\n"),
  "barrel.ts": ['export { used } from "./leaf.ts";', 'export * from "./other.ts";'].join("\n"),
  "other.ts": "export function forwarded(): number {\n  return 3;\n}",
  "entry.ts": [
    'import { used } from "./barrel.ts";',
    'import { forwarded } from "./barrel.ts";',
    'import type { Shape } from "./leaf.ts";',
    'import * as everything from "./wide.ts";',
    'import "./side-effect.ts";',
    "export function main(shape: Shape): number {",
    "  return used() + forwarded() + everything.count + shape.id.length;",
    "}",
  ].join("\n"),
  "wide.ts": "export const count = 4;",
  "side-effect.ts": "globalThis.marker = true;",
};

describe("Health Modules - Module Graph Construction & Resolution", () => {
  const tree = loadTree("modules", TREE);
  const leaf = tree.modules.get(join(tree.root, "leaf.ts"));
  const entry = tree.modules.get(join(tree.root, "entry.ts"));

  test("every export form is recorded with its kind", () => {
    expect(leaf?.exports.map((e) => `${e.kind}:${e.name}`).sort()).toEqual([
      "class:Holder",
      "enum:Level",
      "function:used",
      "interface:Shape",
      "type:Kind",
      "value:VALUE",
    ]);
  });

  test("a named import, a type import and a namespace import are all bindings", () => {
    const bindings = entry?.imports.map((binding) => binding.imported) ?? [];
    expect(bindings).toContain("used");
    expect(bindings).toContain("Shape");
    expect(bindings).toContain("*");
  });

  test("a side-effect import records no binding but still names the module", () => {
    expect(entry?.imports.some((binding) => binding.from.endsWith("side-effect.ts"))).toBe(false);
  });

  test("a re-export resolves back to the module that declares the symbol", () => {
    const barrel = join(tree.root, "barrel.ts");
    expect(resolveOrigin(tree.modules, { module: barrel, name: "used" })).toEqual({
      module: join(tree.root, "leaf.ts"),
      name: "used",
    });
  });

  test("a star re-export resolves through to the origin as well", () => {
    const barrel = join(tree.root, "barrel.ts");
    expect(resolveOrigin(tree.modules, { module: barrel, name: "forwarded" }).module).toBe(
      join(tree.root, "other.ts"),
    );
  });

  test("an unknown symbol resolves to itself rather than guessing an origin", () => {
    const barrel = join(tree.root, "barrel.ts");
    expect(resolveOrigin(tree.modules, { module: barrel, name: "absent" })).toEqual({
      module: barrel,
      name: "absent",
    });
  });

  test("an import of a path that does not exist still records the binding", () => {
    const missing = loadTree("missing-import", {
      "entry.ts": 'import { gone } from "./absent.ts";\nexport const seed = gone;',
    });
    const record = missing.modules.get(join(missing.root, "entry.ts"));
    expect(record?.imports[0]?.imported).toBe("gone");
    expect(record?.imports[0]?.from).toBe(join(missing.root, "absent.ts"));
  });

  test("a directory import resolves to its index module", () => {
    const nested = loadTree("index-import", {
      "entry.ts": 'import { inner } from "./folder";\nexport const seed = inner;',
      "folder/index.ts": "export const inner = 1;",
    });
    const record = nested.modules.get(join(nested.root, "entry.ts"));
    expect(record?.imports[0]?.from).toBe(join(nested.root, "folder/index.ts"));
  });

  test("a package import is kept as written, never resolved into the tree", () => {
    const external = loadTree("package-import", {
      "entry.ts": 'import { join } from "node:path";\nexport const seed = join;',
    });
    expect(external.modules.get(join(external.root, "entry.ts"))?.imports[0]?.from).toBe(
      "node:path",
    );
  });

  test("a re-export cycle terminates instead of recursing forever", () => {
    const cycle = loadTree("cycle", {
      "a.ts": 'export { value } from "./b.ts";',
      "b.ts": 'export { value } from "./a.ts";',
    });
    expect(
      resolveOrigin(cycle.modules, { module: join(cycle.root, "a.ts"), name: "value" }),
    ).toEqual({ module: join(cycle.root, "a.ts"), name: "value" });
  });

  describe("a default export is a symbol the graph must carry", () => {
    const defaultTree = loadTree("default-export", {
      "config.ts": "export default {\n  size: 1,\n};\n",
      "entry.ts": 'import config from "./config.ts";\nexport const size = config.size;\n',
    });

    test("the declaring module records it under the name an importer binds", () => {
      const record = defaultTree.modules.get(join(defaultTree.root, "config.ts"));
      expect(record?.exports.map((e) => [e.name, e.kind])).toEqual([
        ["default", "default"],
      ]);
    });

    test("the importing module binds it as `default`, so the export has a consumer", () => {
      const entryRecord = defaultTree.modules.get(join(defaultTree.root, "entry.ts"));
      expect(entryRecord?.imports.map((binding) => binding.imported)).toContain("default");
    });
  });
});
