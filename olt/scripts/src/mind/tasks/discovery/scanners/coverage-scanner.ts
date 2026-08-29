import { resolve } from "node:path";
import { DEFAULT_SOURCE_EXTENSIONS, DEFAULT_EXCLUDE_PATTERNS } from "../types.ts";
import { basename, extname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { HarnessError } from "../../../../core/errors/index.ts";
import type {
  TestCoverageFinding,
  TestCoverageScanOptions,
  TestCoverageScanResult,
} from "../types.ts";
import { collectFilesRecursively } from "./quality-scanner.ts";
export function scanTestCoverage(options: TestCoverageScanOptions = {}): TestCoverageScanResult {
  const startTime = Date.now();
  const sourceRoots =
    options.sourceRoots && options.sourceRoots.length > 0
      ? options.sourceRoots
      : ["olt/scripts/src"];
  const testRoots =
    options.testRoots && options.testRoots.length > 0 ? options.testRoots : ["tests/unit", "tests"];
  const extensions = options.fileExtensions ? options.fileExtensions : DEFAULT_SOURCE_EXTENSIONS;
  const excludes = options.excludePatterns ? options.excludePatterns : DEFAULT_EXCLUDE_PATTERNS;
  const maxFindings = options.maxFindings ? options.maxFindings : 50;

  const sourceFiles: string[] = [];
  for (const root of sourceRoots) {
    const resolved = resolve(root);
    collectFilesRecursively(resolved, resolved, extensions, excludes, sourceFiles);
  }

  const testFiles: string[] = [];
  for (const root of testRoots) {
    const resolved = resolve(root);
    collectFilesRecursively(resolved, resolved, extensions, excludes, testFiles);
  }

  const testFileMap = new Map<string, string>();
  for (const tf of testFiles) {
    testFileMap.set(basename(tf), tf);
  }

  const findings: TestCoverageFinding[] = [];
  let missingTestCount = 0;
  let skippedTestCount = 0;

  for (const sf of sourceFiles) {
    if (findings.length >= maxFindings) break;

    const base = basename(sf, extname(sf));
    // Skip index or type-only definition files from strict 1:1 test requirement if small
    if (base === "index" || base === "types" || base.endsWith(".d")) {
      continue;
    }

    const expectedTestName1 = `${base}.test.ts`;
    const expectedTestName2 = `${base}.spec.ts`;

    const matchedTest = testFileMap.get(expectedTestName1)
      ? testFileMap.get(expectedTestName1)
      : testFileMap.get(expectedTestName2);

    if (!matchedTest) {
      missingTestCount++;
      findings.push({
        sourceFile: sf,
        issueType: "MISSING_TEST_FILE",
        description: `Missing dedicated unit test suite for source module: ${basename(sf)}`,
        suggestedRemediation: `Create unit test suite at tests/unit/${relative(process.cwd(), sf)
          .replace(/scripts\/src\//, "")
          .replace(/\.ts$/, ".test.ts")}`,
        severity: "HIGH",
      });
    }
  }

  // Scan existing test files for skipped tests, empty suites, and low assertion density
  for (const tf of testFiles) {
    if (findings.length >= maxFindings) break;

    try {
      const content = readFileSync(tf, "utf8");
      if (
        content.includes("test.skip(") ||
        content.includes("describe.skip(") ||
        content.includes("it.skip(") ||
        content.includes("xit(") ||
        content.includes("xtest(")
      ) {
        skippedTestCount++;
        findings.push({
          sourceFile: tf,
          testFile: tf,
          issueType: "SKIPPED_TESTS",
          description: `Skipped test cases detected in test suite: ${basename(tf)}`,
          suggestedRemediation:
            "Re-enable skipped tests and repair any underlying assertion failures.",
          severity: "MEDIUM",
        });
      }

      const hasTestBlock = content.includes("test(") || content.includes("it(");
      if (!hasTestBlock && !content.includes("describe(")) {
        findings.push({
          sourceFile: tf,
          testFile: tf,
          issueType: "EMPTY_TEST_SUITE",
          description: `Empty test suite without test assertions: ${basename(tf)}`,
          suggestedRemediation:
            "Implement comprehensive assertions covering positive and negative cases.",
          severity: "HIGH",
        });
      } else if (hasTestBlock) {
        // Assertion density check: count expect() assertions
        const expectMatches = content.match(/\bexpect\s*\(/g);
        const expectCount = expectMatches ? expectMatches.length : 0;
        if (expectCount === 0) {
          findings.push({
            sourceFile: tf,
            testFile: tf,
            issueType: "LOW_ASSERTION_DENSITY",
            description: `Test suite ${basename(tf)} has zero expect() assertion calls`,
            suggestedRemediation:
              "Add explicit expect() assertions verifying return values and invariants.",
            severity: "HIGH",
          });
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return {
    findings,
    sourceFilesScanned: sourceFiles.length,
    testFilesScanned: testFiles.length,
    missingTestCount,
    skippedTestCount,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Scans codebase files for cognitive complexity and architectural gap issues:
 * - Deeply nested logic blocks exceeding indentation thresholds
 * - Cognitive parameter overloading (> 5 positional parameters)
 * - Unhandled raw JSON parses lacking try/catch protection
 * - Unbounded collections or infinite loops lacking bounds
 * - Missing error recovery (empty catch blocks)
 * - Async uncaught boundaries
 */
