import { describe, expect, test } from "bun:test";
import { DEFAULT_TIMEOUT_MS, parseRunnerArgs } from "../../../scripts/testing/runner/arg-parser.ts";

describe("arg-parser specific flags", () => {
  describe("coverage flags", () => {
    test("parses --coverage flag and applies default reporters and directory", () => {
      const p = parseRunnerArgs(["--coverage", "tests"]);
      expect(p.isCoverage).toBe(true);
      expect(p.bunTestArgs).toEqual([
        "test",
        "--timeout",
        "30000",
        "--parallel",
        "--coverage",
        "--coverage-reporter=lcov",
        "--coverage-reporter=text",
        "--coverage-dir=coverage",
        "tests",
      ]);
    });

    test("parses custom coverage-dir and coverage-reporter with inline and spaced syntax", () => {
      const p1 = parseRunnerArgs([
        "--coverage-dir=custom_cov",
        "--coverage-reporter=lcov",
        "tests",
      ]);
      expect(p1.isCoverage).toBe(true);
      expect(p1.coverageDir).toBe("custom_cov");
      expect(p1.coverageReporters).toEqual(["lcov"]);
      expect(p1.bunTestArgs).toContain("--coverage-dir=custom_cov");
      expect(p1.bunTestArgs).toContain("--coverage-reporter=lcov");

      const p2 = parseRunnerArgs([
        "--coverage-dir",
        "cov2",
        "--coverage-reporter",
        "json",
        "--coverage-reporter",
        "text",
      ]);
      expect(p2.isCoverage).toBe(true);
      expect(p2.coverageDir).toBe("cov2");
      expect(p2.coverageReporters).toEqual(["json", "text"]);
    });

    test("explicit --no-coverage disables coverage even if coverage options are given", () => {
      const p = parseRunnerArgs(["--no-coverage", "--coverage-dir=custom_cov"]);
      expect(p.isCoverage).toBe(false);
      expect(p.bunTestArgs).not.toContain("--coverage");
      expect(p.bunTestArgs).not.toContain("--coverage-dir=custom_cov");
    });
  });

  describe("snapshots, fast-fail (bail), and pattern filters", () => {
    test("parses snapshot flags -u and --update-snapshots", () => {
      expect(parseRunnerArgs(["-u", "tests/foo.test.ts"]).isUpdateSnapshots).toBe(true);
      expect(parseRunnerArgs(["--update-snapshots"]).bunTestArgs).toContain("--update-snapshots");
    });

    test("parses boolean bail flags and bail count", () => {
      expect(parseRunnerArgs(["-b"]).isBail).toBe(true);
      expect(parseRunnerArgs(["--bail"]).isBail).toBe(true);
      expect(parseRunnerArgs(["--no-bail"]).isBail).toBe(false);

      const p1 = parseRunnerArgs(["--bail=3"]);
      expect(p1.isBail).toBe(true);
      expect(p1.bailCount).toBe(3);
      expect(p1.bunTestArgs).toContain("--bail=3");

      const p2 = parseRunnerArgs(["--bail", "4", "tests/foo.test.ts"]);
      expect(p2.isBail).toBe(true);
      expect(p2.bailCount).toBe(4);
      expect(p2.targets).toEqual(["tests/foo.test.ts"]);
      expect(p2.bunTestArgs).toContain("--bail=4");

      const p3 = parseRunnerArgs(["--bail", "tests/foo.test.ts"]);
      expect(p3.bailCount).toBeUndefined();
      expect(p3.targets).toEqual(["tests/foo.test.ts"]);
    });

    test("parses pattern filters with separated and inline syntax", () => {
      expect(parseRunnerArgs(["-t", "login tests"]).filterPattern).toBe("login tests");
      expect(parseRunnerArgs(["--test-name-pattern", "api.*v2"]).filterPattern).toBe("api.*v2");
      expect(parseRunnerArgs(["--filter", "scoped"]).filterPattern).toBe("scoped");
      expect(parseRunnerArgs(["-t=auth.*success"]).filterPattern).toBe("auth.*success");
      expect(parseRunnerArgs(["--test-name-pattern=smoke"]).filterPattern).toBe("smoke");
      expect(parseRunnerArgs(["--filter=e2e"]).filterPattern).toBe("e2e");
    });
  });

  describe("timeouts, concurrency, and wrapper flags", () => {
    test("parses timeout and concurrency flags", () => {
      expect(parseRunnerArgs(["--timeout", "5000"]).timeoutMs).toBe(5000);
      expect(parseRunnerArgs(["--timeout=12000"]).timeoutMs).toBe(12000);
      expect(parseRunnerArgs(["--timeout", "invalid"]).timeoutMs).toBe(DEFAULT_TIMEOUT_MS);

      expect(parseRunnerArgs(["--no-parallel"]).bunTestArgs).toContain("--no-parallel");
      expect(parseRunnerArgs(["--parallel", "8"]).bunTestArgs).toContain("--parallel=8");
      expect(parseRunnerArgs(["--parallel=4"]).bunTestArgs).toContain("--parallel=4");

      expect(parseRunnerArgs(["--max-concurrency", "16"]).bunTestArgs).toContain("16");
      expect(parseRunnerArgs(["--max-concurrency=32"]).bunTestArgs).toContain("32");
    });

    test("extracts wrapper flags and does not forward them to bunTestArgs", () => {
      const p = parseRunnerArgs([
        "-q",
        "--quiet",
        "-v",
        "--verbose",
        "--ci",
        "--no-ticker",
        "--ticker",
        "--no-summary",
        "--summary",
        "tests/target.test.ts",
      ]);
      expect(p.wrapperOptions).toEqual({
        quiet: true,
        verbose: true,
        ci: true,
        ticker: true,
        summary: true,
      });
      expect(p.bunTestArgs).not.toContain("-q");
      expect(p.bunTestArgs).not.toContain("--verbose");
      expect(p.bunTestArgs).not.toContain("--no-ticker");
      expect(p.bunTestArgs).toContain("tests/target.test.ts");
    });
  });
});
