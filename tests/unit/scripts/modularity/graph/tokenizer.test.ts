import { expect, test } from "bun:test";
import { scanImports } from "../../../../../scripts/modularity/graph/index.ts";
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
