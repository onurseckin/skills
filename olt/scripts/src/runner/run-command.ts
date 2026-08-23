import { inspectRepositoryBinding } from "../packets/repository-identity.ts";
import {
  createInternalCommandRunner,
  type InternalCommandRunner,
} from "./internal-command-runner.ts";
import { runAttempt } from "./run-attempt.ts";
import type { CommandOptions, CommandResult, PreparedCommand } from "./types.ts";
import { readAgentMetadata } from "../runtime/agent-metadata.ts";
import { verifyCommandAuthorization } from "../policy/rbac-engine.ts";
import { resolveScratchDir } from "../shared/paths.ts";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

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
  const prepared = await runner.prepareCommand(input);

  // Verify Authorization
  const metadata = readAgentMetadata(input.actor, input.runRoot);
  if (!metadata) {
    throw new Error(
      `[ROLE_BOUNDARY_VIOLATION] Cannot find AgentMetadata for actor: ${input.actor}`,
    );
  }

  const auth = verifyCommandAuthorization(metadata, input.argv);
  if (!auth.authorized) {
    throw new Error(auth.message || `[${auth.error_code}] Command authorization failed`);
  }

  // Emit signed receipt to .olt/scratch/evidence/
  const scratchDir = resolveScratchDir(prepared.options.repositoryRoot);
  const evidenceDir = join(scratchDir, "evidence");
  if (!existsSync(evidenceDir)) {
    mkdirSync(evidenceDir, { recursive: true });
  }

  const receipt = {
    actor: metadata.agent_id,
    role: metadata.role,
    command: input.argv.join(" "),
    timestamp: new Date().toISOString(),
    authorized: true,
  };

  const receiptStr = JSON.stringify(receipt, null, 2);
  const digest = createHash("sha256").update(receiptStr).digest("hex");
  writeFileSync(join(evidenceDir, `${digest}.json`), receiptStr);

  return prepared;
}

export async function executePreparedCommand(
  prepared: PreparedCommand,
  runner: InternalCommandRunner = authoritativeRunner,
): Promise<CommandResult> {
  return runner.executePreparedCommand(prepared);
}
