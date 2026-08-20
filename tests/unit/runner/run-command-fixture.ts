import {
  executePreparedCommand,
  prepareCommand,
} from "../../../orchestrating-long-tasks/scripts/src/runner/run-command.ts";
import type {
  CommandOptions,
  CommandResult,
} from "../../../orchestrating-long-tasks/scripts/src/runner/types.ts";

/**
 * Prepare-then-execute in one call. Production runs every command through the durable
 * intent/reconcile protocol in `integration/record-command.ts`, which needs the prepared record
 * before the child spawns; these tests exercise the runner alone, so they compose the same two
 * steps without a capsule ledger around them.
 */
export async function runCommand(input: CommandOptions): Promise<CommandResult> {
  return executePreparedCommand(await prepareCommand(input));
}
