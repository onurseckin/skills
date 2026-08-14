import { inspectRepositoryBinding } from "../packets/repository-identity.ts";
import { createInternalCommandRunner } from "./internal-command-runner.ts";
import { runAttempt } from "./run-attempt.ts";
import type { CommandOptions, CommandResult, PreparedCommand } from "./types.ts";
import { assertCommandIdentities } from "./policy.ts";

const authoritativeRunner = createInternalCommandRunner({
  inspectRepository: inspectRepositoryBinding,
  attempt: runAttempt,
});

export async function prepareCommand(input: CommandOptions): Promise<PreparedCommand> {
  return authoritativeRunner.prepareCommand(input);
}

export async function executePreparedCommand(prepared: PreparedCommand): Promise<CommandResult> {
  return authoritativeRunner.executePreparedCommand(prepared);
}

export async function runCommand(input: CommandOptions): Promise<CommandResult> {
  assertCommandIdentities(input);
  return executePreparedCommand(await prepareCommand(input));
}
