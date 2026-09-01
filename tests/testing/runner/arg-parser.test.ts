import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PARALLEL,
  DEFAULT_TIMEOUT_MS,
  buildBunTestArgs,
  isBroadScopeTargets,
  parseRunnerArgs,
} from "../../../scripts/testing/runner/arg-parser.ts";
import type { ParsedRunnerArgs } from "../../../scripts/testing/runner/types.ts";

describe("arg-parser core and passthrough", () => {
  describe("isBroadScopeTargets", () => {
    test("detects broad scope for empty targets and root directory patterns", () => {
      const broad = [
        [],
        ["tests"],
        ["tests/"],
        ["./tests"],
        ["."],
        ["./"],
        [""],
        ["tests/foo.test.ts", "tests"],
      ];
      for (const t of broad) expect(isBroadScopeTargets(t)).toBe(true);
    });

    test("detects narrow scope for specific files or subdirectories", () => {
      const narrow = [
        ["tests/testing"],
        ["tests/testing/runner/arg-parser.test.ts"],
        ["src/utils.test.ts"],
      ];
      for (const t of narrow) expect(isBroadScopeTargets(t)).toBe(false);
    });
  });

  describe("parseRunnerArgs defaults and double-dash boundary", () => {
    test("parses empty arguments to default broad-scope configuration with coverage enabled", () => {
      const p = parseRunnerArgs();
      expect(p.rawArgs).toEqual([]);
      expect(p.targets).toEqual([]);
      expect(p.isCoverage).toBe(true);
      expect(p.isBroadScope).toBe(true);
      expect(p.isBail).toBe(false);
      expect(p.isUpdateSnapshots).toBe(false);
      expect(p.filterPattern).toBeUndefined();
      expect(p.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
      expect(p.parallel).toBe(DEFAULT_PARALLEL);
      expect(p.passthroughArgs).toEqual([]);
      expect(p.wrapperOptions).toEqual({});
      expect(p.bunTestArgs).toEqual([
        "test",
        "--timeout",
        "30000",
        "--parallel",
        "--coverage",
        "--coverage-reporter=lcov",
        "--coverage-reporter=text",
        "--coverage-dir=coverage",
      ]);
    });

    test("explicit --no-coverage disables coverage for broad-scope execution", () => {
      const p = parseRunnerArgs(["--no-coverage"]);
      expect(p.targets).toEqual([]);
      expect(p.isCoverage).toBe(false);
      expect(p.isBroadScope).toBe(true);
      expect(p.bunTestArgs).toEqual(["test", "--timeout", "30000", "--parallel"]);
    });

    test("targeted single-file runs remain lightweight without coverage by default", () => {
      const p = parseRunnerArgs(["tests/foo.test.ts"]);
      expect(p.targets).toEqual(["tests/foo.test.ts"]);
      expect(p.isCoverage).toBe(false);
      expect(p.isBroadScope).toBe(false);
      expect(p.bunTestArgs).toEqual([
        "test",
        "--timeout",
        "30000",
        "--parallel",
        "tests/foo.test.ts",
      ]);
    });

    test("preserves arguments after double-dash in passthrough without parsing", () => {
      const raw = ["tests/foo.test.ts", "--", "-t", "ignored-filter", "--bail", "-q", "extra"];
      const p = parseRunnerArgs(raw);
      expect(p.targets).toEqual(["tests/foo.test.ts"]);
      expect(p.isBroadScope).toBe(false);
      expect(p.filterPattern).toBeUndefined();
      expect(p.isBail).toBe(false);
      expect(p.wrapperOptions.quiet).toBeUndefined();
      expect(p.passthroughArgs).toEqual(["--", "-t", "ignored-filter", "--bail", "-q", "extra"]);
      expect(p.bunTestArgs).toEqual([
        "test",
        "--timeout",
        "30000",
        "--parallel",
        "tests/foo.test.ts",
        "--",
        "-t",
        "ignored-filter",
        "--bail",
        "-q",
        "extra",
      ]);
    });

    test("handles double-dash as the first argument with broad default coverage", () => {
      const p = parseRunnerArgs(["--", "passthrough-only"]);
      expect(p.targets).toEqual([]);
      expect(p.isBroadScope).toBe(true);
      expect(p.isCoverage).toBe(true);
      expect(p.passthroughArgs).toEqual(["--", "passthrough-only"]);
      expect(p.bunTestArgs).toEqual([
        "test",
        "--timeout",
        "30000",
        "--parallel",
        "--coverage",
        "--coverage-reporter=lcov",
        "--coverage-reporter=text",
        "--coverage-dir=coverage",
        "--",
        "passthrough-only",
      ]);
    });
  });

  describe("arbitrary Bun test flags and buildBunTestArgs", () => {
    test("forwards arbitrary engine flags with and without parameters", () => {
      const p = parseRunnerArgs([
        "--rerun-each",
        "2",
        "--retry",
        "3",
        "--dots",
        "--seed",
        "12345",
        "--shard",
        "1/3",
        "--isolate",
        "--randomize",
        "tests/suite.test.ts",
      ]);
      expect(p.otherBunArgs).toEqual([
        "--rerun-each",
        "2",
        "--retry",
        "3",
        "--dots",
        "--seed",
        "12345",
        "--shard",
        "1/3",
        "--isolate",
        "--randomize",
      ]);
      expect(p.bunTestArgs).toEqual([
        "test",
        "--timeout",
        "30000",
        "--parallel",
        "--rerun-each",
        "2",
        "--retry",
        "3",
        "--dots",
        "--seed",
        "12345",
        "--shard",
        "1/3",
        "--isolate",
        "--randomize",
        "tests/suite.test.ts",
      ]);
    });

    test("buildBunTestArgs accurately reconstructs custom ParsedRunnerArgs", () => {
      const custom: ParsedRunnerArgs = {
        rawArgs: [],
        targets: ["tests/a.test.ts", "tests/b.test.ts"],
        isCoverage: true,
        isBroadScope: false,
        isBail: true,
        bailCount: 2,
        isUpdateSnapshots: true,
        filterPattern: "unit",
        timeoutMs: 10000,
        parallel: false,
        maxConcurrency: 4,
        coverageDir: "cov_dir",
        coverageReporters: ["lcov"],
        otherBunArgs: ["--dots"],
        passthroughArgs: ["--", "extra1"],
        wrapperOptions: { quiet: true },
        bunTestArgs: [],
      };
      expect(buildBunTestArgs(custom)).toEqual([
        "test",
        "--timeout",
        "10000",
        "--no-parallel",
        "--max-concurrency",
        "4",
        "--coverage",
        "--coverage-reporter=lcov",
        "--coverage-dir=cov_dir",
        "--update-snapshots",
        "--bail=2",
        "--test-name-pattern",
        "unit",
        "--dots",
        "tests/a.test.ts",
        "tests/b.test.ts",
        "--",
        "extra1",
      ]);
    });
  });
});
