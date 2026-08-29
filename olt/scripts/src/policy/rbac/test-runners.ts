import type { RepoPolicy } from "../types/index.ts";
import { KNOWN_TEST_RUNNERS } from "./constants.ts";
import { analyzeCommandDispatch } from "./command-dispatch.ts";

export function isKnownTestRunner(tokens: readonly string[]): boolean {
  return KNOWN_TEST_RUNNERS.some((runner) =>
    runner.prefixTokens.every((token, index) => tokens[index]?.toLowerCase() === token),
  );
}

const IGNORED_TEST_KEYWORDS: ReadonlySet<string> = new Set([
  "all",
  "workspace",
  "run",
  "watch",
  "related",
  "bench",
  "coverage",
  "cov",
  "bail",
  "quiet",
  "silent",
  "verbose",
  "json",
  "tap",
  "junit",
  "html",
  "text",
  "lcov",
  "node",
  "bun",
  "browser",
  "jsdom",
  "happy-dom",
]);

export function isTargetTestArgument(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed || trimmed.startsWith("-") || trimmed === "--") return false;

  // Whole repo wildcards in Go/Rust/glob (e.g. ./... or ...)
  if (trimmed === "./..." || trimmed === "..." || trimmed === ".") return false;

  // Pure numeric literals (e.g. 1234, 4, 5000)
  if (/^\d+$/.test(trimmed)) return false;

  // Boolean literals
  if (trimmed.toLowerCase() === "true" || trimmed.toLowerCase() === "false") return false;

  // Non-target CLI flags, test modes, common config keys/values, reporter formats
  if (IGNORED_TEST_KEYWORDS.has(trimmed.toLowerCase())) return false;

  // Key=value argument that does not contain a file path
  if (/^[a-zA-Z0-9_-]+=[a-zA-Z0-9_-]+$/.test(trimmed) && !trimmed.includes("/")) {
    return false;
  }

  // Directory path or file path with slashes (excluding root/wildcard)
  if (trimmed.includes("/") || trimmed.includes("\\")) return true;

  // Known test or source file extension / naming patterns
  if (
    /\.(test|spec)\.[a-zA-Z0-9]+$/i.test(trimmed) ||
    /\.(ts|tsx|js|jsx|py|rs|go|rb|cpp|c|h|java|kt|scala|cs|php|ex|exs)$/i.test(trimmed) ||
    /^test_/i.test(trimmed) ||
    /_test$/i.test(trimmed) ||
    /_test\./i.test(trimmed) ||
    /Test\.java$/i.test(trimmed)
  ) {
    return true;
  }

  // Non-keyword identifier (e.g. cargo test test_name or pytest test_function)
  if (/^[a-zA-Z_][a-zA-Z0-9_:-]*$/.test(trimmed)) {
    return true;
  }

  return false;
}

export function isUntargetedTestCommand(
  commandStr: string,
  argvInput?: readonly string[],
  policy?: RepoPolicy,
): boolean {
  const trimmed = commandStr.trim();
  const rawTokens = argvInput && argvInput.length > 0 ? argvInput : trimmed.split(/\s+/);
  const dispatch = analyzeCommandDispatch(rawTokens);
  if (dispatch.denialReason) return false;
  const tokens = dispatch.tokens;
  if (tokens.length === 0 || tokens[0] === "") return false;

  for (const runner of KNOWN_TEST_RUNNERS) {
    if (tokens.length < runner.prefixTokens.length) continue;

    let matchesPrefix = true;
    for (let i = 0; i < runner.prefixTokens.length; i++) {
      if (tokens[i]!.toLowerCase() !== runner.prefixTokens[i]!.toLowerCase()) {
        matchesPrefix = false;
        break;
      }
    }

    if (matchesPrefix) {
      const rest = tokens.slice(runner.prefixTokens.length);
      const targetArgs: string[] = [];
      const flagsWithValueSet = new Set(runner.flagsWithValue ?? []);
      const modeKeywordsSet = new Set(runner.modeKeywords ?? []);

      for (let i = 0; i < rest.length; i++) {
        const token = rest[i]!;
        if (token === "--") {
          continue;
        }
        if (token.startsWith("-")) {
          if (
            flagsWithValueSet.has(token) &&
            i + 1 < rest.length &&
            !rest[i + 1]!.startsWith("-")
          ) {
            i++; // skip flag value argument
          }
          continue;
        }
        if (modeKeywordsSet.has(token.toLowerCase())) {
          continue;
        }
        if (isTargetTestArgument(token)) {
          targetArgs.push(token);
        }
      }

      // If no valid targeted arguments remain, it is an un-targeted test run!
      return targetArgs.length === 0;
    }
  }

  // Check dynamic full suite command from policy
  if (policy?.test_runner?.full_suite_command) {
    const fullTokens = policy.test_runner.full_suite_command.trim().split(/\s+/);
    if (tokens.length >= fullTokens.length) {
      let matchesFull = true;
      for (let i = 0; i < fullTokens.length; i++) {
        if (tokens[i]!.toLowerCase() !== fullTokens[i]!.toLowerCase()) {
          matchesFull = false;
          break;
        }
      }
      if (matchesFull) {
        const rest = tokens.slice(fullTokens.length);
        const validTargets = rest.filter((t) => isTargetTestArgument(t));
        return validTargets.length === 0;
      }
    }
  }

  return false;
}
