/**
 * Test Runner CLI Argument Parser and Forwarder
 * Robust parser for test runner CLI arguments, supporting option extraction,
 * wrapper/engine flag separation, double-dash boundary passthrough, and bun test command generation.
 */

import type { ParsedRunnerArgs, WrapperOptions } from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_PARALLEL = true;
export const DEFAULT_COVERAGE_DIR = "coverage";
export const DEFAULT_COVERAGE_REPORTERS: readonly string[] = ["lcov", "text"];

const BUN_PARAM_FLAGS = new Set<string>([
  "--rerun-each",
  "--retry",
  "--reporter",
  "--reporter-outfile",
  "--seed",
  "--shard",
  "--changed",
  "--timings",
  "--parallel-delay",
  "--path-ignore-patterns",
]);

/**
 * Checks whether target paths represent broad suite execution (e.g. empty, "tests", ".").
 */
export function isBroadScopeTargets(targets: readonly string[]): boolean {
  if (targets.length === 0) return true;
  return targets.some((t) => {
    const norm = t.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (norm === "") return true;
    if (norm === "tests") return true;
    if (norm === ".") return true;
    return false;
  });
}

/**
 * Parses raw CLI arguments into structured runner configuration.
 */
export function parseRunnerArgs(rawArgs: readonly string[] = []): ParsedRunnerArgs {
  const dashDashIdx = rawArgs.indexOf("--");
  const beforeDash = dashDashIdx >= 0 ? rawArgs.slice(0, dashDashIdx) : rawArgs;
  const passthroughArgs = dashDashIdx >= 0 ? rawArgs.slice(dashDashIdx) : [];

  const targets: string[] = [];
  const otherBunArgs: string[] = [];
  const coverageReporters: string[] = [];

  let isCoverage = false;
  let isCovSet = false;
  let coverageDir: string | undefined;
  let isBail = false;
  let bailCount: number | undefined;
  let isUpdateSnapshots = false;
  let filterPattern: string | undefined;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let parallel = DEFAULT_PARALLEL;
  let isParallelExplicit = false;
  let parallelWorkers: number | undefined;
  let maxConcurrency: number | undefined;

  let quiet: boolean | undefined;
  let ticker: boolean | undefined;
  let ci: boolean | undefined;
  let verbose: boolean | undefined;
  let summary: boolean | undefined;

  for (let i = 0; i < beforeDash.length; i++) {
    const token = beforeDash[i];
    if (token === undefined) continue;

    const nextToken = beforeDash[i + 1];

    if (token === "--timeout" && nextToken !== undefined) {
      i++;
      const val = parseInt(nextToken, 10);
      if (!Number.isNaN(val) && val >= 0) timeoutMs = val;
    } else if (token.startsWith("--timeout=")) {
      const val = parseInt(token.slice(10), 10);
      if (!Number.isNaN(val) && val >= 0) timeoutMs = val;
    } else if (token === "--coverage") {
      isCoverage = true;
      isCovSet = true;
    } else if (token === "--no-coverage") {
      isCoverage = false;
      isCovSet = true;
    } else if (token === "--coverage-dir" && nextToken !== undefined) {
      i++;
      coverageDir = nextToken;
      if (!isCovSet) isCoverage = true;
    } else if (token.startsWith("--coverage-dir=")) {
      coverageDir = token.slice(15);
      if (!isCovSet) isCoverage = true;
    } else if (token === "--coverage-reporter" && nextToken !== undefined) {
      i++;
      coverageReporters.push(nextToken);
      if (!isCovSet) isCoverage = true;
    } else if (token.startsWith("--coverage-reporter=")) {
      coverageReporters.push(token.slice(20));
      if (!isCovSet) isCoverage = true;
    } else if (token === "-u" ? true : token === "--update-snapshots") {
      isUpdateSnapshots = true;
    } else if (token === "-b" ? true : token === "--bail") {
      isBail = true;
      if (nextToken !== undefined && /^\d+$/.test(nextToken)) {
        i++;
        bailCount = parseInt(nextToken, 10);
      }
    } else if (token.startsWith("--bail=")) {
      const count = parseInt(token.slice(7), 10);
      isBail = true;
      if (!Number.isNaN(count) && count > 0) bailCount = count;
    } else if (token === "--no-bail") {
      isBail = false;
      bailCount = undefined;
    } else if (
      (token === "-t" ? true : token === "--test-name-pattern" ? true : token === "--filter") &&
      nextToken !== undefined
    ) {
      i++;
      filterPattern = nextToken;
    } else if (token.startsWith("-t=")) {
      filterPattern = token.slice(3);
    } else if (token.startsWith("--test-name-pattern=")) {
      filterPattern = token.slice(20);
    } else if (token.startsWith("--filter=")) {
      filterPattern = token.slice(9);
    } else if (token === "--parallel") {
      parallel = true;
      isParallelExplicit = true;
      if (nextToken !== undefined && /^\d+$/.test(nextToken)) {
        i++;
        parallelWorkers = parseInt(nextToken, 10);
      }
    } else if (token.startsWith("--parallel=")) {
      parallel = true;
      isParallelExplicit = true;
      const count = parseInt(token.slice(11), 10);
      if (!Number.isNaN(count) && count > 0) parallelWorkers = count;
    } else if (token === "--no-parallel") {
      parallel = false;
      isParallelExplicit = true;
      parallelWorkers = undefined;
    } else if (token === "--max-concurrency" && nextToken !== undefined) {
      i++;
      const val = parseInt(nextToken, 10);
      if (!Number.isNaN(val) && val > 0) maxConcurrency = val;
    } else if (token.startsWith("--max-concurrency=")) {
      const val = parseInt(token.slice(18), 10);
      if (!Number.isNaN(val) && val > 0) maxConcurrency = val;
    } else if (token === "--quiet" ? true : token === "-q") {
      quiet = true;
    } else if (token === "--no-ticker") {
      ticker = false;
    } else if (token === "--ticker") {
      ticker = true;
    } else if (token === "--ci") {
      ci = true;
    } else if (token === "--verbose" ? true : token === "-v") {
      verbose = true;
    } else if (token === "--summary") {
      summary = true;
    } else if (token === "--no-summary") {
      summary = false;
    } else if (BUN_PARAM_FLAGS.has(token)) {
      otherBunArgs.push(token);
      if (nextToken !== undefined) {
        i++;
        otherBunArgs.push(nextToken);
      }
    } else if (!token.startsWith("-")) {
      targets.push(token);
    } else {
      otherBunArgs.push(token);
    }
  }

  const wrapperOptions: WrapperOptions = {
    ...(quiet !== undefined ? { quiet } : {}),
    ...(ticker !== undefined ? { ticker } : {}),
    ...(ci !== undefined ? { ci } : {}),
    ...(verbose !== undefined ? { verbose } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };

  const isBroadScope = isBroadScopeTargets(targets);
  if (!isCovSet && isBroadScope) {
    isCoverage = true;
  }
  const parsedPartial: Omit<ParsedRunnerArgs, "bunTestArgs"> = {
    rawArgs,
    targets,
    isCoverage,
    isBroadScope,
    isBail,
    isUpdateSnapshots,
    filterPattern,
    timeoutMs,
    parallel,
    passthroughArgs,
    wrapperOptions,
    coverageDir,
    coverageReporters: coverageReporters.length > 0 ? coverageReporters : undefined,
    maxConcurrency,
    bailCount,
    parallelWorkers,
    otherBunArgs: otherBunArgs.length > 0 ? otherBunArgs : undefined,
  };

  return {
    ...parsedPartial,
    bunTestArgs: buildBunTestArgs({ ...parsedPartial, bunTestArgs: [] }),
  };
}

/**
 * Reconstructs the exact `bun test` argument vector from parsed runner arguments.
 */
export function buildBunTestArgs(parsed: ParsedRunnerArgs): string[] {
  const args: string[] = ["test", "--timeout", String(parsed.timeoutMs)];

  if (parsed.parallel) {
    if (parsed.parallelWorkers !== undefined) {
      args.push(`--parallel=${parsed.parallelWorkers}`);
    } else {
      args.push("--parallel");
    }
  } else {
    args.push("--no-parallel");
  }

  if (parsed.maxConcurrency !== undefined) {
    args.push("--max-concurrency", String(parsed.maxConcurrency));
  }

  if (parsed.isCoverage) {
    args.push("--coverage");
    const reporters = parsed.coverageReporters?.length
      ? parsed.coverageReporters
      : DEFAULT_COVERAGE_REPORTERS;
    for (const r of reporters) args.push(`--coverage-reporter=${r}`);
    const targetCovDir =
      parsed.coverageDir !== undefined && parsed.coverageDir !== null
        ? parsed.coverageDir
        : DEFAULT_COVERAGE_DIR;
    args.push(`--coverage-dir=${targetCovDir}`);
  }

  if (parsed.isUpdateSnapshots) args.push("--update-snapshots");
  if (parsed.isBail) {
    args.push(
      parsed.bailCount !== undefined && parsed.bailCount > 1
        ? `--bail=${parsed.bailCount}`
        : "--bail",
    );
  }
  if (parsed.filterPattern) args.push("--test-name-pattern", parsed.filterPattern);
  if (parsed.otherBunArgs?.length) args.push(...parsed.otherBunArgs);
  if (parsed.targets.length > 0) args.push(...parsed.targets);
  if (parsed.passthroughArgs.length > 0) args.push(...parsed.passthroughArgs);

  return args;
}
