import { calculateBackoffWithStrategy, type BackoffStrategy } from "../../core/scheduling/index.ts";
import { resolveTraceContext } from "../../telemetry/trace-context.ts";
import { parseArguments } from "../arguments.ts";
import { assertFlags, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

const ALLOWED_SCHED_BACKOFF_FLAGS: readonly string[] = [
  "base-interval",
  "base-interval-ms",
  "max-interval",
  "max-interval-ms",
  "streak",
  "strategy",
  "multiplier",
  "trace-id",
  "span-id",
  "parent-span-id",
  "trace-sampled",
  "json",
];

export function schedBackoffCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const baseIntervalMs =
    integerFlag(flags, "base-interval") ?? integerFlag(flags, "base-interval-ms") ?? 1000;
  const maxIntervalMs =
    integerFlag(flags, "max-interval") ?? integerFlag(flags, "max-interval-ms") ?? 30000;
  const streak = integerFlag(flags, "streak") ?? 0;
  const strategyFlag = textFlag(flags, "strategy", false);
  const strategy: BackoffStrategy =
    strategyFlag !== undefined ? (strategyFlag as BackoffStrategy) : "exponential";
  const multiplierStr = textFlag(flags, "multiplier", false);
  const multiplier = multiplierStr !== undefined ? Number(multiplierStr) : undefined;

  const delayMs = calculateBackoffWithStrategy({
    baseIntervalMs,
    maxIntervalMs,
    streak,
    strategy,
    multiplier,
  });

  return {
    ok: true,
    delayMs,
    baseIntervalMs,
    maxIntervalMs,
    streak,
    strategy,
  };
}

export async function executeSchedBackoff(argv: readonly string[]): Promise<number> {
  try {
    const normalizedArgv =
      argv.length === 0 || argv[0]?.startsWith("-") ? ["sched:backoff", ...argv] : argv;
    const parsed = parseArguments(normalizedArgv);
    assertFlags(parsed.flags, ALLOWED_SCHED_BACKOFF_FLAGS);
    const traceContext = resolveTraceContext(parsed.flags);
    const result = schedBackoffCommand(parsed.flags);
    const output = {
      ...result,
      traceContext,
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isValidation =
      message.includes("required") ||
      message.includes("invalid") ||
      message.includes("unknown option") ||
      message.includes("INVALID_ARGUMENT") ||
      message.includes("INVARIANT_VIOLATION");
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: message, code: isValidation ? 2 : 1 }, null, 2)}\n`,
    );
    return isValidation ? 2 : 1;
  }
}
