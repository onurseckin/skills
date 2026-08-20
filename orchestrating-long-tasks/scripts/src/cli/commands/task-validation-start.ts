import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { isValidatorDomain } from "../../packets/role-contract.ts";
import { publishTaskRolePacket } from "../../packets/role-grant.ts";
import { loadRun } from "../../store/index.ts";
import { applicableGates } from "../../workflow/gates/gate-policy.ts";
import { beginValidation } from "../../workflow/review/begin-validation.ts";
import { validationForValidator } from "../../workflow/review/validation-state.ts";
import { formatValidationStartBrief } from "../formatters/index.ts";
import { integerFlag, textFlag, type Flags } from "../options.ts";
import { reviewPolicyFor } from "./task-review-support.ts";

export async function taskValidateStartCommand(flags: Flags): Promise<Record<string, unknown>> {
  const [run, taskId, validator] = [
    textFlag(flags, "run")!,
    textFlag(flags, "task")!,
    textFlag(flags, "validator")!,
  ];
  // B12.2: the domain the coordinator dispatched this agent for. Optional — omitted, beginValidation
  // DERIVES it from the task's write scope instead of requiring the caller to remember it.
  const rawDomain = textFlag(flags, "validator-domain", false);
  if (rawDomain !== undefined && !isValidatorDomain(rawDomain)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--validator-domain is not a recognized validator domain: ${rawDomain}`,
    );
  }
  const leaseDuration = integerFlag(flags, "lease-duration", { minimum: 5, maximum: 86_400 });
  const state = beginValidation(
    workflowPort(run),
    taskId,
    validator,
    undefined,
    leaseDuration,
    rawDomain,
  );
  const task = state.tasks[taskId]!;
  if (typeof task.validation_token !== "string") {
    throw new HarnessError("INVALID_STATE", `validation for ${taskId} produced no token`);
  }
  const token = task.validation_token;
  delete task.validation_token;
  const validation = validationForValidator(task, validator);
  if (!validation)
    throw new HarnessError("INTEGRITY", `validation of ${taskId} recorded no attempt`);

  // The validator's contract reaches it in the same breath as its authority, so a verdict can never
  // be recorded by an agent the harness never handed a validator contract to. `validation.domain` is
  // always populated here — explicit or derived — so the matching checklist binds into the packet
  // whether or not the caller passed --validator-domain (B12.2's whole point: selection is a
  // checkable rule, not something the coordinator has to remember to state).
  const published = await publishTaskRolePacket({
    runRoot: run,
    port: workflowPort(run),
    role: "validator",
    agentId: validator,
    attempt: validation.attempt,
    token,
    taskId,
    validatorDomain: validation.domain,
  });

  const policy = reviewPolicyFor(loadRun(run).runRoot);
  const markdown = formatValidationStartBrief({
    taskId,
    validator,
    token,
    // The gates the validator must run are the ones the plan recorded, never a guess from the scope.
    gates: applicableGates(state, task).map((gate) =>
      Array.isArray(gate.command) ? gate.command.join(" ") : gate.command,
    ),
    minProbes: policy.minProbes,
  });
  return {
    markdown,
    run_root: run,
    token,
    task,
    min_adversarial_probes: policy.minProbes,
    packet_id: published.record.id,
    packet_path: published.markdownPath,
    role_contract_sha256: published.packet.metadata.role_contract_sha256,
  };
}
