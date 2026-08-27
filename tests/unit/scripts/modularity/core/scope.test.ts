import { expect, test } from "bun:test";
import {
  assertRootConvention,
  classifyPath,
} from "../../../../../scripts/modularity/core/index.ts";

test("includes production runtime but excludes runtime output", () => {
  expect(classifyPath("olt/scripts/src/runtime/agent-metadata.ts").included).toBe(true);
  expect(classifyPath(".olt/capsules/run/runtime/session.json").included).toBe(false);
});

test("counts markdown for fanout but not lines", () => {
  expect(classifyPath("docs/guide.md")).toEqual({
    included: true,
    lineLimited: false,
    fanoutCounted: true,
    importScanned: false,
  });
});

test("never exempts TypeScript fixtures", () => {
  expect(classifyPath("tests/support/fixtures/worker.fixture.ts").lineLimited).toBe(true);
});

test("excludes cache directories before extension rules", () => {
  expect(classifyPath("cache/runtime-metadata.ts")).toEqual({
    included: false,
    lineLimited: false,
    fanoutCounted: false,
    importScanned: false,
  });
});

test("rejects unapproved included root paths", () => {
  expect(assertRootConvention(["README.md", "entry.ts"])).toEqual([
    {
      rule: "root_no_growth",
      path: "entry.ts",
      observed: "entry.ts",
      detail: "Root path is not in the approved conventional set.",
    },
  ]);
});

test("permits the ten approved root paths and ignores the lockfile", () => {
  expect(
    assertRootConvention([
      ".capture.yaml",
      ".gitignore",
      ".oxfmtrc.json",
      "AGENTS.md",
      "LICENSE",
      "README.md",
      "bun.lock",
      "bunfig.toml",
      "lefthook.yml",
      "package.json",
      "tsconfig.json",
    ]),
  ).toEqual([]);
});
