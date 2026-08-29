import type { AgentRole } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import type { CommandSpec } from "../cli/registry/types.ts";
import { loadRoleContract, resolveRoleContractPath, type RoleContract } from "./role-contract.ts";
import {
  isCognitiveValidatorRole,
  isExecutionCommand,
  isMechanicValidatorRole,
} from "./command-authority-predicates.ts";
import {
  formatHardlockRemediation,
  formatRoleContractRemediation,
  resolveCurrentHost,
  type DetectedHost,
} from "./command-authority-remediation.ts";
import { normalizeRoleForContract } from "./command-authority-state.ts";

export function assertRoleMayInvoke(
  role: AgentRole | string | undefined | null,
  spec: CommandSpec,
  agentId?: string | undefined | null,
  host?: DetectedHost,
): void {
  if (
    !role ||
    typeof role !== "string" ||
    role.trim() === "" ||
    role.trim().toLowerCase() === "unresolved" ||
    !agentId ||
    typeof agentId !== "string" ||
    agentId.trim() === "" ||
    agentId.trim().toLowerCase() === "unresolved"
  ) {
    throw new HarnessError(
      "PERMISSION_DENIED",
      `role ${role ?? "unresolved"} may not invoke ${spec.name}: actor '${agentId ?? "unresolved"}' or role is unresolved; fail-closed enforcement active`,
    );
  }

  const normalizedRole = role.toLowerCase().trim();
  if (
    (normalizedRole === "meta-auditor" || normalizedRole === "meta_auditor") &&
    (spec.name === "meta-audit" || spec.aliases.includes("meta-audit"))
  ) {
    return;
  }

  const normalizedContractRole = normalizeRoleForContract(role);
  const activeHost = host !== undefined ? host : resolveCurrentHost();

  if (
    isExecutionCommand(spec) &&
    isCognitiveValidatorRole(role) &&
    !isMechanicValidatorRole(role)
  ) {
    let grantDetail = "";
    try {
      const contract = loadRoleContract(normalizedContractRole as AgentRole);
      grantDetail = `, and the contract at ${resolveRoleContractPath(normalizedContractRole as AgentRole)} grants only ${contract.commands.join(", ")}`;
    } catch {
      grantDetail = "";
    }
    const remediation = formatHardlockRemediation(activeHost);
    throw new HarnessError(
      "INVALID_STATE",
      `role ${role} may not invoke ${spec.name}: cognitive validators are strictly banned from executing bash/shell commands or running test suites (run:exec); agent ${agentId} holds a ${role} grant${grantDetail}. ${remediation}`,
    );
  }

  let contract: RoleContract;
  try {
    contract = loadRoleContract(normalizedContractRole as AgentRole);
  } catch (error) {
    throw new HarnessError(
      "PERMISSION_DENIED",
      `role ${role} may not invoke ${spec.name}: role contract could not be loaded (${String(error)})`,
    );
  }

  const invocations = [spec.name, ...spec.aliases];

  if (invocations.some((invocation) => contract.commands.includes(invocation))) return;
  const remediation = formatRoleContractRemediation(role, spec.name, activeHost);
  throw new HarnessError(
    "INVALID_STATE",
    `role ${role} may not invoke ${spec.name}: agent ${agentId} holds a ${role} grant, and the contract at ${resolveRoleContractPath(normalizedContractRole as AgentRole)} grants only ${contract.commands.join(", ")}. ${remediation}`,
  );
}
