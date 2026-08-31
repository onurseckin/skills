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
        "const pattern = /export\\s+.*from\\s+['\"]fake['\"]/gim;",
        "const charClass = /[/]/;",
        'const template = `import "./also-fake.ts"`;',
        'import "./real.ts";',
      ].join("\n"),
    ),
  );

  expect(refs).toEqual([{ specifier: "./real.ts", typeOnly: false, kind: "import" }]);
});

test("handles unterminated quoted strings and regexes safely at EOF", () => {
  expect(scanImports(blob("slice/unterminated-quote.ts", 'const x = "unfinished'))).toEqual([]);
  expect(scanImports(blob("slice/unterminated-regex.ts", "const x = /unfinished"))).toEqual([]);
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

test("decodes various escape sequences in module specifiers", () => {
  expect(scanImports(blob("slice/source.ts", 'import "./\\u0066oo.ts";'))).toEqual([
    { specifier: "./foo.ts", typeOnly: false, kind: "import" },
  ]);
  expect(scanImports(blob("slice/source.ts", 'import "./\\u{66}oo.ts";'))).toEqual([
    { specifier: "./foo.ts", typeOnly: false, kind: "import" },
  ]);
  expect(scanImports(blob("slice/source.ts", 'import "./\\x66oo.ts";'))).toEqual([
    { specifier: "./foo.ts", typeOnly: false, kind: "import" },
  ]);
  expect(
    scanImports(blob("slice/source.ts", 'import "./\\b\\f\\n\\r\\t\\v\\0\\q\\\r\\\r\n\\\n.ts";')),
  ).toEqual([{ specifier: "./\b\f\n\r\t\v\0q.ts", typeOnly: false, kind: "import" }]);
});

test("rejects malformed string escapes and unterminated strings", () => {
  expect(() => scanImports(blob("slice/source.ts", 'import "./\\u00zz.ts";'))).toThrow(
    "invalid hexadecimal escape",
  );
  expect(() => scanImports(blob("slice/source.ts", 'import "./\\xZZ.ts";'))).toThrow(
    "invalid hexadecimal escape",
  );
  expect(() => scanImports(blob("slice/source.ts", 'import "./\\u{110001}.ts";'))).toThrow(
    "invalid Unicode code point",
  );
  expect(() => scanImports(blob("slice/source.ts", 'import "./\\u{123.ts";'))).toThrow(
    "Malformed module specifier",
  );
  expect(() => scanImports(blob("slice/source.ts", 'import "./\\01.ts";'))).toThrow(
    "legacy octal escape",
  );
  expect(() => scanImports(blob("slice/source.ts", 'import "./foo\\\n\r\n'))).toThrow(
    "unterminated string",
  );
  expect(() => scanImports(blob("slice/source.ts", 'import "./foo\\'))).toThrow(
    "unfinished escape",
  );
  expect(() => scanImports(blob("slice/source.ts", 'import "unterminated'))).toThrow(
    "unterminated string",
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

test("recognizes from only after nested named bindings close", () => {
  expect(
    scanImports(
      blob(
        "slice/source.ts",
        'import { from as imported } from "./target.ts"; export { from as exported } from "./export.ts";',
      ),
    ),
  ).toEqual([
    { specifier: "./target.ts", typeOnly: false, kind: "import" },
    { specifier: "./export.ts", typeOnly: false, kind: "export" },
  ]);
});

test("counts export type-star while preserving its type-only reference", () => {
  const target = blob("slice/index.ts", 'export type * from "./types.ts";');

  expect(scanImports(target)).toEqual([
    { specifier: "./types.ts", typeOnly: true, kind: "export" },
  ]);
  expect(countExportStars(target)).toBe(1);
});

test("skips a hashbang only when it begins the source", () => {
  expect(
    scanImports(blob("slice/hashbang.ts", '#!import "./fake.ts";\nimport "./real.ts";')),
  ).toEqual([{ specifier: "./real.ts", typeOnly: false, kind: "import" }]);
  expect(scanImports(blob("slice/non-hashbang.ts", '# ! import "./real.ts";'))).toEqual([
    { specifier: "./real.ts", typeOnly: false, kind: "import" },
  ]);
  expect(scanImports(blob("slice/single-line-hashbang.ts", "#!/usr/bin/env bun"))).toEqual([]);
});
