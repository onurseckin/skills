import { describe, expect, test } from "bun:test";
import {
  countPhysicalLines,
  findFanoutViolations,
  findLineViolations,
  type IndexedBlob,
} from "../../../scripts/modularity/inventory/index.ts";

function blob(path: string): IndexedBlob {
  return { path, oid: "a".repeat(40), bytes: new Uint8Array() };
}

describe("directory fanout violations", () => {
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
});

describe("physical line counting and violations", () => {
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
});
