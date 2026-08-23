import {
  executePreparedCommand,
  prepareCommand,
} from "../../../olt/scripts/src/engine/runner/run-command.ts";
import type {
  CommandOptions,
  CommandResult,
} from "../../../olt/scripts/src/capture/runners/types.ts";

/**
 * Prepare-then-execute in one call. Production runs every command through the durable
 * intent/reconcile protocol in `integration/record-command.ts`, which needs the prepared record
 * before the child spawns; these tests exercise the runner alone, so they compose the same two
 * steps without a capsule ledger around them.
 */
export async function runCommand(input: CommandOptions): Promise<CommandResult> {
  return executePreparedCommand(await prepareCommand(input));
}

/**
 * Polls until `pid` is gone rather than asserting absence the instant a kill signal is sent.
 * Signal delivery and reaping happen on the OS scheduler's own timeline, not the caller's: on a
 * contended machine `process.kill(pid, 0)` can still find the target alive for tens of
 * milliseconds after SIGTERM/SIGKILL was issued, which made an immediate `.toThrow()` assertion
 * flake under load. Polling keeps the same discrimination (a process that never dies still fails
 * the test) without racing the scheduler for how fast it gets there.
 */
export async function waitForProcessExit(pid: number, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`process ${pid} was still alive ${timeoutMs}ms after termination`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
