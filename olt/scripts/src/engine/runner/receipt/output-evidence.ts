import { basename } from "node:path";
import { effectiveCommandArgv } from "../models/command-wrappers";

const ZERO_TEST_PATTERNS = [
  /filters? did not match any test files?/iu,
  /\[no test files\]/iu,
  /\bno test is available\b/iu,
  /\bno tests? (?:found|ran|collected|discovered)\b/iu,
  /\bran 0 tests?\b/iu,
  /\brunning 0 tests?\b/iu,
  /\b0 tests? (?:ran|collected|discovered)\b/iu,
  /\bcollected 0 items?\b/iu,
  /\b0 passed\s*;\s*0 failed\b/iu,
  /^\s*0 pass(?:ed)?\b/imu,
  /^\s*#\s*tests\s+0\b/imu,
];

const DIRECT_TEST_TOOLS = new Set(["jest", "pytest", "vitest"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn"]);
const POSITIVE_TEST_PATTERNS = [
  /\b[1-9]\d*\s+(?:items?\s+collected|pass(?:ed)?|tests?\s+(?:ran|collected|discovered))\b/iu,
  /\b(?:collected|running)\s+[1-9]\d*\s+(?:items?|tests?)\b/iu,
  /^\s*#\s*tests\s+[1-9]\d*\b/imu,
];

export const ZERO_TEST_ISSUE = "test command discovered zero tests";

function commandFamily(value: string): string {
  return basename(value)
    .toLowerCase()
    .replace(/\.exe$/u, "");
}

function packageScriptIsTest(args: readonly string[]): boolean {
  if (args[0] === "test") return true;
  return args[0] === "run" && /(?:^|[:_-])tests?(?:$|[:_-])/iu.test(args[1] ?? "");
}

export function commandHasTestIntent(argv: readonly string[]): boolean {
  const effective = effectiveCommandArgv(argv);
  const family = commandFamily(effective[0] ?? "");
  const args = effective.slice(1);
  if (DIRECT_TEST_TOOLS.has(family)) return true;
  if (["cargo", "dotnet", "go"].includes(family)) return args[0] === "test";
  if (family === "bun") return args[0] === "test" || packageScriptIsTest(args);
  if (family === "deno") return args[0] === "test";
  if (family === "node") return args.includes("--test");
  if (/^(?:python(?:\d+(?:\.\d+)*)?|pypy(?:\d+(?:\.\d+)*)?)$/u.test(family))
    return args[0] === "-m" && ["pytest", "unittest"].includes(args[1] ?? "");
  return PACKAGE_MANAGERS.has(family) && packageScriptIsTest(args);
}

export function outputEvidenceIssues(
  argv: readonly string[],
  stdout: Uint8Array,
  stderr: Uint8Array,
): string[] {
  if (!commandHasTestIntent(argv)) return [];
  const decoder = new TextDecoder();
  const output = `${decoder.decode(stdout)}\n${decoder.decode(stderr)}`;
  const family = commandFamily(effectiveCommandArgv(argv)[0] ?? "");
  let zeroTests: boolean;
  if (family === "cargo") {
    const runningCounts = [...output.matchAll(/\brunning\s+(\d+)\s+tests?\b/giu)].map((match) =>
      Number(match[1]),
    );
    const resultCounts = [...output.matchAll(/\b(\d+)\s+passed\s*;\s*(\d+)\s+failed\b/giu)].map(
      (match) => Number(match[1]) + Number(match[2]),
    );
    const counts = runningCounts.length > 0 ? runningCounts : resultCounts;
    zeroTests = counts.length > 0 && counts.every((count) => count === 0);
  } else if (family === "go") {
    zeroTests = /\[no test files\]/iu.test(output) && !/^\s*ok\s+\S+/imu.test(output);
  } else if (family === "dotnet") {
    zeroTests =
      /\bno test is available\b/iu.test(output) &&
      !/\b(?:failed|passed|total tests):\s*[1-9]\d*\b/iu.test(output);
  } else {
    const hasPositiveEvidence = POSITIVE_TEST_PATTERNS.some((pattern) => pattern.test(output));
    zeroTests = !hasPositiveEvidence && ZERO_TEST_PATTERNS.some((pattern) => pattern.test(output));
  }
  return zeroTests ? [ZERO_TEST_ISSUE] : [];
}
