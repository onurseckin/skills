import { inspectRepositoryBinding } from "../packets/repository-identity.ts";
import {
  createInternalCommandRunner,
  type InternalCommandRunner,
} from "./internal-command-runner.ts";
import { runAttempt } from "./run-attempt.ts";
import type { CommandOptions, CommandResult, PreparedCommand } from "./types.ts";

const authoritativeRunner = createInternalCommandRunner({
  inspectRepository: inspectRepositoryBinding,
  attempt: runAttempt,
});

// `runner` is an injection seam for tests only: every production caller invokes these with a
// single argument, so it always resolves to the real, repository/process-backed runner above.
export async function prepareCommand(
  input: CommandOptions,
  runner: InternalCommandRunner = authoritativeRunner,
): Promise<PreparedCommand> {
  return runner.prepareCommand(input);
}

export async function executePreparedCommand(
  prepared: PreparedCommand,
  runner: InternalCommandRunner = authoritativeRunner,
): Promise<CommandResult> {
  return runner.executePreparedCommand(prepared);
}
