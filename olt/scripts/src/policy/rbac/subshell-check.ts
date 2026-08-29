import { SHELL_EXECUTABLES } from "./constants.ts";
import { analyzeCommandDispatch } from "./command-dispatch.ts";

export interface SubshellDetectionResult {
  readonly detected: boolean;
  readonly reason?: string | undefined;
}

export function hasUnshieldedSubshellOrChaining(
  _commandStr: string,
  argv: readonly string[],
): SubshellDetectionResult {
  const dispatch = analyzeCommandDispatch(argv);
  if (dispatch.denialReason) {
    return { detected: true, reason: dispatch.denialReason };
  }
  const tokens = dispatch.tokens;
  const firstToken = tokens[0] ?? "";

  if (SHELL_EXECUTABLES.has(firstToken)) {
    return {
      detected: true,
      reason: `Subshell binary invocation detected: '${firstToken}'`,
    };
  }

  if (firstToken === "eval" || firstToken === "exec") {
    return {
      detected: true,
      reason: `Direct evaluator invocation detected: '${firstToken}'`,
    };
  }

  if (
    (firstToken === "node" || firstToken === "bun" || firstToken === "deno") &&
    tokens.some(
      (a) => a === "-e" || a === "--eval" || a.startsWith("-e=") || a.startsWith("--eval="),
    )
  ) {
    return {
      detected: true,
      reason: `Inline code evaluator detected: '${firstToken} -e'`,
    };
  }

  if (
    (firstToken === "python" ||
      firstToken === "python3" ||
      firstToken === "perl" ||
      firstToken === "ruby") &&
    tokens.some((a) => a === "-c" || a === "-e" || a.startsWith("-c=") || a.startsWith("-e="))
  ) {
    return {
      detected: true,
      reason: `Inline code evaluator detected: '${firstToken}'`,
    };
  }

  for (const arg of tokens) {
    if (arg === "&&" || arg === "||" || arg === ";" || arg === "|" || arg === "&") {
      return {
        detected: true,
        reason: `Command chaining operator detected in argv: '${arg}'`,
      };
    }
  }

  return { detected: false };
}
