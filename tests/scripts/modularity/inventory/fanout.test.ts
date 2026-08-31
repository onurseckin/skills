import { expect, test } from "bun:test";
import {
  findFanoutViolations,
  type IndexedBlob,
} from "../../../../scripts/modularity/inventory/index.ts";

function blob(path: string): IndexedBlob {
  return { path, oid: "a".repeat(40), bytes: new Uint8Array() };
}

test("permits ten direct included files including index.ts", () => {
  const files = [
    "slice/index.ts",
    ...Array.from({ length: 9 }, (_, index) => `slice/file-${index}.ts`),
  ];
  expect(findFanoutViolations(files.map(blob))).toEqual([]);
});

test("reports eleven direct included files", () => {
  const files = [
    "slice/index.ts",
    ...Array.from({ length: 10 }, (_, index) => `slice/file-${index}.ts`),
  ];
  expect(findFanoutViolations(files.map(blob))).toEqual([
    {
      rule: "directory_fanout",
      path: "slice",
      observed: 11,
      limit: 10,
      detail: "Directory exceeds the 10 direct-file limit.",
    },
  ]);
});

test("counts markdown, YAML, JSON, and nested directories independently", () => {
  expect(
    findFanoutViolations([
      blob("slice/index.ts"),
      blob("slice/catalog.json"),
      blob("slice/guide.md"),
      blob("slice/config.yaml"),
      blob("slice/nested/file.ts"),
    ]),
  ).toEqual([]);
});
