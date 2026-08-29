import { computeAntiIdleInterval } from "../../core/scheduling/index.ts";
import { resolveTraceContext } from "../../telemetry/trace-context.ts";
import { parseArguments } from "../arguments.ts";
import {
  assertFlags,
  boolFlag,
  integerFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../options.ts";

const ALLOWED_SCHED_EVAL_FLAGS: readonly string[] = [
  "pending-work",
  "has-pending-work",
  "active",
  "streak",
  "zero-value-streak",
  "retry-after",
  "retry-after-ms",
  "base-interval",
  "base-interval-ms",
  "max-interval",
  "max-interval-ms",
  "max-pause-interval",
  "max-pause-interval-ms",
  "rate-limited",
  "is-rate-limited",
  "previous-interval",
  "previous-interval-ms",
  "jitter",
  "apply-jitter",
  "no-jitter",
  "jitter-ratio",
  "multiplier",
  "trace-id",
  "span-id",
  "parent-span-id",
  "trace-sampled",
  "json",
];

export function schedEvalCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const hasPendingWork =
    flags["pending-work"] === true ||
    flags["has-pending-work"] === true ||
    boolFlag(flags, "pending-work") ||
    boolFlag(flags, "has-pending-work");
  const active = flags["active"] === true || boolFlag(flags, "active");
  const zeroValueStreak =
    integerFlag(flags, "streak") ?? integerFlag(flags, "zero-value-streak") ?? 0;
  const retryAfterMs = integerFlag(flags, "retry-after") ?? integerFlag(flags, "retry-after-ms");
  const baseIntervalMs =
    integerFlag(flags, "base-interval") ?? integerFlag(flags, "base-interval-ms");
  const maxIntervalMs = integerFlag(flags, "max-interval") ?? integerFlag(flags, "max-interval-ms");
  const maxPauseIntervalMs =
    integerFlag(flags, "max-pause-interval") ?? integerFlag(flags, "max-pause-interval-ms");
  const isRateLimited =
    flags["rate-limited"] === true ||
    flags["is-rate-limited"] === true ||
    boolFlag(flags, "rate-limited") ||
    boolFlag(flags, "is-rate-limited");
  const previousIntervalMs =
    integerFlag(flags, "previous-interval") ?? integerFlag(flags, "previous-interval-ms");
  const applyJitter =
    boolFlag(flags, "no-jitter") || flags["jitter"] === "false" || flags["apply-jitter"] === "false"
      ? false
      : true;
  const jitterRatioStr = textFlag(flags, "jitter-ratio", false);
  const jitterRatio = jitterRatioStr !== undefined ? Number(jitterRatioStr) : undefined;
  const multiplierStr = textFlag(flags, "multiplier", false);
  const multiplier = multiplierStr !== undefined ? Number(multiplierStr) : undefined;

  const result = computeAntiIdleInterval({
    hasPendingWork,
    active,
    zeroValueStreak,
    retryAfterMs,
    baseIntervalMs,
    maxIntervalMs,
    maxPauseIntervalMs,
    isRateLimited,
    previousIntervalMs,
    applyJitter,
    jitterRatio,
    multiplier,
  });

  return {
    ok: true,
    intervalMs: result.intervalMs,
    rawIntervalMs: result.rawIntervalMs,
    isImmediate: result.isImmediate,
    reason: result.reason,
    zeroValueStreak: result.zeroValueStreak,
  };
}

export async function executeSchedEval(argv: readonly string[]): Promise<number> {
  try {
    const normalizedArgv =
      argv.length === 0 || argv[0]?.startsWith("-") ? ["sched:eval", ...argv] : argv;
    const parsed = parseArguments(normalizedArgv);
    assertFlags(parsed.flags, ALLOWED_SCHED_EVAL_FLAGS);
    const traceContext = resolveTraceContext(parsed.flags);
    const result = schedEvalCommand(parsed.flags);
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
