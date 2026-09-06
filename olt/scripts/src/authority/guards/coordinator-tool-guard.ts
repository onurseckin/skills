import { HarnessError } from "../../core/errors/index.ts";
import {
  assertSupervisoryContainment,
  getDefaultContainmentEngine,
  isSupervisoryRoleForContainment,
  type ContainmentEngineLike,
} from "./containment.ts";

export const COORDINATOR_FILE_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "notebook_edit",
  "generate_image",
  "touch",
  "rm",
  "mv",
  "cp",
  "mkdir",
  "write",
  "edit",
  "notebookedit",
  "apply_patch",
  "apply_diff",
  "create_file",
  "delete_file",
  "file_writer",
  "code_editor",
]);

export const COORDINATOR_FILE_EDIT_CATEGORIES: ReadonlySet<string> = new Set([
  "write",
  "edit",
  "mutation",
  "file-write",
  "code-edit",
  "file-mutation",
  "file_modification",
  "code_modification",
]);

export const SUPERVISOR_FILE_EDIT_TOOLS = COORDINATOR_FILE_EDIT_TOOLS;
export const SUPERVISOR_FILE_EDIT_CATEGORIES = COORDINATOR_FILE_EDIT_CATEGORIES;

export function isCoordinatorRole(role: string): boolean {
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  if (norm === "coordinator") return true;
  if (norm.startsWith("coordinator-")) return true;
  if (norm.endsWith("-coordinator")) return true;
  return norm.includes("coordinator");
}

export function isMindRole(role: string): boolean {
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  if (norm === "mind") return true;
  if (norm.startsWith("mind-")) return true;
  if (norm.endsWith("-mind")) return true;
  return norm.includes("mind");
}

export function isOrchestratorRole(role: string): boolean {
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  if (norm === "orchestrator") return true;
  if (norm.startsWith("orchestrator-")) return true;
  if (norm.endsWith("-orchestrator")) return true;
  if (norm.includes("orchestrator")) return true;
  return norm === "orch";
}

export function isSupervisorRole(role: string): boolean {
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  if (isCoordinatorRole(role)) return true;
  if (isMindRole(role)) return true;
  if (isOrchestratorRole(role)) return true;
  if (norm.includes("supervisor")) return true;
  if (norm === "tier-0") return true;
  if (norm === "tier-1") return true;
  if (norm === "tier-2") return true;
  return isSupervisoryRoleForContainment(role);
}

export const isSupervisoryRole = isSupervisorRole;

export function isCoordinatorFileEditForbidden(toolNameOrCategory: string): boolean {
  const norm = toolNameOrCategory
    .toLowerCase()
    .trim()
    .replace(/^mcp_[^_]+_/, "");

  if (COORDINATOR_FILE_EDIT_TOOLS.has(norm)) {
    return true;
  }
  if (COORDINATOR_FILE_EDIT_CATEGORIES.has(norm)) {
    return true;
  }

  // Exact token boundary matching for file modification capabilities
  return /(?:^|[-_])(?:write|edit|replace|mutation|mutate|delete|patch)(?:[-_]|$)/u.test(norm);
}

export const isSupervisorFileEditForbidden = isCoordinatorFileEditForbidden;

export interface SupervisorPreToolGuardOptions {
  readonly engine?: ContainmentEngineLike | undefined;
  readonly targetFile?: string | undefined;
  readonly details?: string | undefined;
}

export function assertSupervisorPreToolGuard(
  role: string,
  toolOrCategory: string,
  agentId?: string,
  options?: SupervisorPreToolGuardOptions,
): void {
  if (!isSupervisorRole(role)) {
    return;
  }
  if (!isCoordinatorFileEditForbidden(toolOrCategory)) {
    return;
  }

  const agent =
    typeof agentId === "string" && agentId.length > 0
      ? agentId
      : role
        ? `${role}-agent`
        : "supervisor";
  const containmentRole = isSupervisoryRoleForContainment(role)
    ? role
    : isMindRole(role)
      ? "mind"
      : isOrchestratorRole(role)
        ? "orchestrator"
        : "coordinator";

  let containmentError: HarnessError | null = null;
  try {
    const engine = options?.engine !== undefined ? options.engine : getDefaultContainmentEngine();
    assertSupervisoryContainment({
      engine,
      agentId: agent,
      role: containmentRole,
      toolName: toolOrCategory,
      actionType: "DIRECT_CODE_EDIT",
      targetFile: options?.targetFile,
      details: options?.details,
    });
  } catch (err: unknown) {
    if (err instanceof HarnessError) {
      if (err.code === "ROLE_BOUNDARY_DEVIATION") {
        containmentError = err;
      } else if (err.code === "ROLE_CONFINEMENT_VIOLATION") {
        containmentError = err;
      }
    }
  }

  if (containmentError) {
    const rawMessage = containmentError.message;
    const finalMessage = rawMessage.includes("ROLE_BOUNDARY_DEVIATION")
      ? rawMessage
      : `${rawMessage} (ROLE_BOUNDARY_DEVIATION). Supervisors must compile the task plan and dispatch Tier 3 Implementers via invoke_subagent.`;
    throw new HarnessError(containmentError.code, finalMessage);
  }

  const agentDisplay = agentId ? `agent ${agentId}` : `role ${role}`;
  throw new HarnessError(
    "ROLE_BOUNDARY_DEVIATION",
    `Supervisor Pre-Tool Guard [CONTAINMENT STRIKE 1 - HALT_AND_DELEGATE]: ${agentDisplay} holds a supervisory grant ('${role}') and is strictly prohibited from executing file modification tool '${toolOrCategory}' (ROLE_BOUNDARY_DEVIATION). Direct execution and file modifications are strictly forbidden for supervisory tiers. Action blocked. Decompose the task into discrete work units and dispatch a Tier 3 Implementer via invoke_subagent.`,
  );
}

export function assertCoordinatorPreToolGuard(
  role: string,
  toolOrCategory: string,
  agentId?: string,
  options?: SupervisorPreToolGuardOptions,
): void {
  assertSupervisorPreToolGuard(role, toolOrCategory, agentId, options);
}
