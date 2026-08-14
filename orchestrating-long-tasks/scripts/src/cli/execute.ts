import type { JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { parseArguments } from "./arguments.ts";
import {
  initCommand,
  projectionRecoveryCommand,
  validateCommand,
  type CommandContext,
} from "./commands/capsule.ts";
import { planApplyCommand, readyCommand, scheduleCommand } from "./commands/planning.ts";
import {
  assignRepairerCommand,
  authorityDecisionCommand,
  claimCommand,
  finishCommand,
  gateCommand,
  heartbeatCommand,
  recoverCommand,
  releaseCommand,
  reviewCommand,
  submitCommand,
  validationStartCommand,
} from "./commands/workflow.ts";
import { requirePinnedRuntime } from "./pinned-runtime.ts";
import { runCommandCli } from "./commands/runner.ts";
import { installCommand, installationStatusCommand } from "./commands/installer.ts";
import { packetCommand, repositoryInspectionCommand } from "./commands/packet.ts";
import {
  beginCriticCommand,
  completeCommand,
  completionRemediationCommand,
  completionReviewCommand,
} from "./commands/completion.ts";
import { doctorCommand, handoffCommand, statusCommand } from "./commands/reporting.ts";
import { dispositionOrphanEvidenceCommand } from "./commands/orphan-evidence.ts";

export async function execute(
  argv: readonly string[],
  context: CommandContext = {},
): Promise<JsonObject> {
  const parsed = parseArguments(argv);
  if (context.executingRuntime && typeof parsed.flags.run === "string") {
    requirePinnedRuntime(parsed.flags.run, context.executingRuntime);
  }
  if (parsed.remainder.length && parsed.command !== "run") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `command ${parsed.command} does not accept -- arguments`,
    );
  }
  switch (parsed.command) {
    case "init":
      return (await initCommand(parsed.flags, context)) as JsonObject;
    case "validate":
      return (await validateCommand(parsed.flags)) as JsonObject;
    case "projection-recover":
      return projectionRecoveryCommand(parsed.flags) as JsonObject;
    case "plan-apply":
      return (await planApplyCommand(parsed.flags)) as JsonObject;
    case "ready":
      return readyCommand(parsed.flags) as JsonObject;
    case "schedule":
      return scheduleCommand(parsed.flags) as JsonObject;
    case "claim":
      return claimCommand(parsed.flags) as JsonObject;
    case "heartbeat":
      return heartbeatCommand(parsed.flags) as JsonObject;
    case "submit":
      return (await submitCommand(parsed.flags)) as JsonObject;
    case "begin-validation":
      return validationStartCommand(parsed.flags) as JsonObject;
    case "review":
      return (await reviewCommand(parsed.flags)) as JsonObject;
    case "gate":
      return gateCommand(parsed.flags) as JsonObject;
    case "finish":
      return finishCommand(parsed.flags) as JsonObject;
    case "recover":
      return recoverCommand(parsed.flags) as JsonObject;
    case "release":
      return releaseCommand(parsed.flags) as JsonObject;
    case "assign-repairer":
      return assignRepairerCommand(parsed.flags) as JsonObject;
    case "decide-authority":
      return authorityDecisionCommand(parsed.flags) as JsonObject;
    case "disposition-orphan":
      return (await dispositionOrphanEvidenceCommand(parsed.flags)) as JsonObject;
    case "run":
      return (await runCommandCli(parsed.flags, parsed.remainder)) as JsonObject;
    case "install":
      return (await installCommand(parsed.flags)) as JsonObject;
    case "installation-status":
      return (await installationStatusCommand(parsed.flags)) as JsonObject;
    case "packet":
      return (await packetCommand(parsed.flags)) as JsonObject;
    case "inspect-repository":
      return repositoryInspectionCommand(parsed.flags) as JsonObject;
    case "begin-critic":
      return beginCriticCommand(parsed.flags) as JsonObject;
    case "review-completion":
      return (await completionReviewCommand(parsed.flags)) as JsonObject;
    case "remediate-completion":
      return (await completionRemediationCommand(parsed.flags)) as JsonObject;
    case "complete":
      return completeCommand(parsed.flags) as JsonObject;
    case "status":
      return statusCommand(parsed.flags) as JsonObject;
    case "handoff":
      return handoffCommand(parsed.flags) as JsonObject;
    case "doctor":
      return (await doctorCommand(parsed.flags)) as JsonObject;
    default:
      throw new HarnessError("INVALID_ARGUMENT", `unknown command: ${parsed.command}`);
  }
}
