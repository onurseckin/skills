import {
  watchdogCleanupCommand,
  watchdogPhaseCleanupCommand,
  watchdogProbeCommand,
  watchdogStatusCommand,
  watchdogVerifyCommand,
} from "../cli/commands/watchdog-ops.ts";
import type { CommandContext, Flags } from "../cli/options.ts";

export {
  watchdogCleanupCommand,
  watchdogPhaseCleanupCommand,
  watchdogProbeCommand,
  watchdogStatusCommand,
  watchdogVerifyCommand,
};

export function executeWatchdogStatus(
  flags: Flags,
  context?: CommandContext,
): Record<string, unknown> {
  return watchdogStatusCommand(flags, context);
}

export function executeWatchdogCleanup(
  flags: Flags,
  context?: CommandContext,
): Record<string, unknown> {
  return watchdogCleanupCommand(flags, context);
}

export function executeWatchdogPhaseCleanup(
  flags: Flags,
  context?: CommandContext,
): Record<string, unknown> {
  return watchdogPhaseCleanupCommand(flags, context);
}

export function executeWatchdogVerify(
  flags: Flags,
  context?: CommandContext,
): Record<string, unknown> {
  return watchdogVerifyCommand(flags, context);
}

export async function executeWatchdogProbe(
  flags: Flags,
  context?: CommandContext,
): Promise<Record<string, unknown>> {
  return watchdogProbeCommand(flags, context);
}
