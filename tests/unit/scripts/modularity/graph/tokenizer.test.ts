import { expect, test } from "bun:test";
import { countExportStars, scanImports } from "../../../../../scripts/modularity/graph/index.ts";
import { blob } from "./graph-fixture.ts";

test("preserves type-only imports and ignores comments", () => {
  const refs = scanImports(
    blob(
      "slice/source.ts",
      `
      // import { fake } from "../private.ts";
      import type { Grant } from "../agents/index.ts";
      export { value } from "./local.ts";
      `,
    ),
  );

  expect(refs).toEqual([
    { specifier: "../agents/index.ts", typeOnly: true, kind: "import" },
    { specifier: "./local.ts", typeOnly: false, kind: "export" },
  ]);
});

test("ignores quoted strings, templates, and regex literals", () => {
  const refs = scanImports(
    blob(
      "slice/source.ts",
      [
        "const text = \"import { fake } from './fake.ts'\";",
        "const pattern = /export\\s+.*from\\s+['\"]fake['\"]/;",
        'const template = `import "./also-fake.ts"`;',
        'import "./real.ts";',
      ].join("\n"),
    ),
  );

  expect(refs).toEqual([{ specifier: "./real.ts", typeOnly: false, kind: "import" }]);
});

test("recognizes side-effect imports and type-only exports", () => {
  expect(
    scanImports(
      blob(
        "slice/source.ts",
        'import "./setup.ts"; export type { Grant } from "./contracts/index.ts";',
      ),
    ),
  ).toEqual([
    { specifier: "./setup.ts", typeOnly: false, kind: "import" },
    { specifier: "./contracts/index.ts", typeOnly: true, kind: "export" },
  ]);
});

test("treats comments as trivia throughout import and export declarations", () => {
  const source = `import /* comment */ "./side.ts";
    import { value } /* comment */ from /* comment */ "./x.ts";
    export /* comment */ * from "./x.ts";`;
  const target = blob("slice/source.ts", source);

  expect(scanImports(target)).toEqual([
    { specifier: "./side.ts", typeOnly: false, kind: "import" },
    { specifier: "./x.ts", typeOnly: false, kind: "import" },
    { specifier: "./x.ts", typeOnly: false, kind: "export" },
  ]);
  expect(countExportStars(target)).toBe(1);
});

test("decodes escaped specifiers and rejects malformed string escapes", () => {
  expect(scanImports(blob("slice/source.ts", 'import "./\\u0066oo.ts";'))).toEqual([
    { specifier: "./foo.ts", typeOnly: false, kind: "import" },
  ]);
  expect(() => scanImports(blob("slice/source.ts", 'import "./\\u00zz.ts";'))).toThrow(
    "Malformed module specifier",
  );
});

test("scans multiline named imports and exports", () => {
  expect(
    scanImports(
      blob(
        "slice/source.ts",
        `import {
          value,
        } from
        "./x.ts";
        export type {
          Grant,
        } from
        "./contracts/index.ts";`,
      ),
    ),
  ).toEqual([
    { specifier: "./x.ts", typeOnly: false, kind: "import" },
    { specifier: "./contracts/index.ts", typeOnly: true, kind: "export" },
  ]);
});
