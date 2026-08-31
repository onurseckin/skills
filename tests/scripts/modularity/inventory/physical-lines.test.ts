import { expect, test } from "bun:test";
import {
  countPhysicalLines,
  findLineViolations,
  type IndexedBlob,
} from "../../../../scripts/modularity/inventory/index.ts";

test.each([
  [new Uint8Array(), 0],
  [new TextEncoder().encode("x\n".repeat(300)), 300],
  [new TextEncoder().encode("x\n".repeat(300) + "x"), 301],
])("counts physical lines", (bytes, expected) => {
  expect(countPhysicalLines(bytes)).toBe(expected);
});

test("reports only files above the physical-line limit", () => {
  const blobs: readonly IndexedBlob[] = [
    {
      path: "slice/pass.ts",
      oid: "a".repeat(40),
      bytes: new TextEncoder().encode("x\n".repeat(300)),
    },
    {
      path: "slice/fail.ts",
      oid: "b".repeat(40),
      bytes: new TextEncoder().encode("x\n".repeat(300) + "x"),
    },
    {
      path: "docs/ignored.md",
      oid: "c".repeat(40),
      bytes: new TextEncoder().encode("x\n".repeat(301)),
    },
  ];

  expect(findLineViolations(blobs)).toEqual([
    {
      rule: "line_limit",
      path: "slice/fail.ts",
      observed: 301,
      limit: 300,
      detail: "File exceeds the 300 physical-line limit.",
    },
  ]);
});
