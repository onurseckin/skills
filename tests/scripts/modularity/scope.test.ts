import { expect, test } from "bun:test";
import {
  assertRepositoryRelativePosixPath,
  assertRootConvention,
  classifyPath,
  ModularityScopeError,
} from "../../../scripts/modularity/core/index.ts";

test("includes production runtime but excludes runtime output", () => {
  expect(classifyPath("olt/scripts/src/runtime/index.ts").included).toBe(true);
  expect(classifyPath(".olt/capsules/run/runtime/session.json").included).toBe(false);
  expect(classifyPath("runtime/session.json").included).toBe(false);
});

test("counts markdown for fanout but not lines", () => {
  expect(classifyPath("docs/guide.md")).toEqual({
    included: true,
    lineLimited: false,
    fanoutCounted: true,
    importScanned: false,
  });
});

test("classifies modularity baseline artifacts as fanout only", () => {
  expect(classifyPath("scripts/modularity/baseline/index.json")).toEqual({
    included: true,
    lineLimited: false,
    fanoutCounted: true,
    importScanned: false,
  });
});

test("classifies generated CLI artifacts as data files", () => {
  expect(classifyPath("olt/references/cli-capabilities/manifest.json")).toEqual({
    included: true,
    lineLimited: true,
    fanoutCounted: true,
    importScanned: false,
  });
});

test("classifies non-TypeScript fixtures as fanout only", () => {
  expect(classifyPath("tests/fixtures/sample.txt")).toEqual({
    included: true,
    lineLimited: false,
    fanoutCounted: true,
    importScanned: false,
  });
  expect(classifyPath("tests/__snapshots__/sample.txt")).toEqual({
    included: true,
    lineLimited: false,
    fanoutCounted: true,
    importScanned: false,
  });
});

test("classifies various TypeScript extensions", () => {
  expect(classifyPath("src/component.tsx")).toEqual({
    included: true,
    lineLimited: true,
    fanoutCounted: true,
    importScanned: true,
  });
  expect(classifyPath("src/module.mts")).toEqual({
    included: true,
    lineLimited: true,
    fanoutCounted: true,
    importScanned: true,
  });
  expect(classifyPath("src/common.cts")).toEqual({
    included: true,
    lineLimited: true,
    fanoutCounted: true,
    importScanned: true,
  });
});

test("classifies json, jsonl, yaml, and yml data files", () => {
  expect(classifyPath("config/settings.json")).toEqual({
    included: true,
    lineLimited: true,
    fanoutCounted: true,
    importScanned: false,
  });
  expect(classifyPath("data/records.jsonl")).toEqual({
    included: true,
    lineLimited: false,
    fanoutCounted: true,
    importScanned: false,
  });
  expect(classifyPath("config/app.yaml")).toEqual({
    included: true,
    lineLimited: false,
    fanoutCounted: true,
    importScanned: false,
  });
  expect(classifyPath("config/app.yml")).toEqual({
    included: true,
    lineLimited: false,
    fanoutCounted: true,
    importScanned: false,
  });
  expect(classifyPath("assets/logo.png")).toEqual({
    included: false,
    lineLimited: false,
    fanoutCounted: false,
    importScanned: false,
  });
});

test("never exempts TypeScript fixtures", () => {
  expect(classifyPath("tests/fixtures/worker.fixture.ts").lineLimited).toBe(true);
});

test("excludes cache directories before extension rules", () => {
  expect(classifyPath("cache/runtime-metadata.ts")).toEqual({
    included: false,
    lineLimited: false,
    fanoutCounted: false,
    importScanned: false,
  });
  expect(classifyPath("coverage/lcov.info")).toEqual({
    included: false,
    lineLimited: false,
    fanoutCounted: false,
    importScanned: false,
  });
  expect(classifyPath("node_modules/pkg/index.ts")).toEqual({
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

test("exports scope validation errors from the public facade", () => {
  expect(ModularityScopeError).toBeDefined();
  expect(() => assertRepositoryRelativePosixPath("")).toThrow(ModularityScopeError);
  expect(() => assertRepositoryRelativePosixPath("/abs/path.ts")).toThrow(ModularityScopeError);
  expect(() => assertRepositoryRelativePosixPath("win\\path.ts")).toThrow(ModularityScopeError);
  expect(() => assertRepositoryRelativePosixPath("a//b.ts")).toThrow(ModularityScopeError);
  expect(() => assertRepositoryRelativePosixPath("a/./b.ts")).toThrow(ModularityScopeError);
  expect(() => assertRepositoryRelativePosixPath("../outside.ts")).toThrow(ModularityScopeError);
  expect(() => assertRepositoryRelativePosixPath("valid/relative/path.ts")).not.toThrow();
});

test("rejects unapproved root entries even when their extension is out of scope", () => {
  expect(assertRootConvention([".env", "Makefile", "bun.lock", "README.md"])).toEqual([
    {
      rule: "root_no_growth",
      path: ".env",
      observed: ".env",
      detail: "Root path is not in the approved conventional set.",
    },
    {
      rule: "root_no_growth",
      path: "Makefile",
      observed: "Makefile",
      detail: "Root path is not in the approved conventional set.",
    },
  ]);
});
