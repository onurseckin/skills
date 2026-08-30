import { HarnessError } from "../../core/errors/index.ts";

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
]);

export function isCoordinatorRole(role: string): boolean {
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  return (
    norm === "coordinator" ||
    norm.startsWith("coordinator-") ||
    norm.endsWith("-coordinator") ||
    norm.includes("coordinator")
  );
}

export function isCoordinatorFileEditForbidden(toolNameOrCategory: string): boolean {
  const norm = toolNameOrCategory
    .toLowerCase()
    .trim()
    .replace(/^mcp_[^_]+_/, "");
  return (
    COORDINATOR_FILE_EDIT_TOOLS.has(norm) ||
    COORDINATOR_FILE_EDIT_CATEGORIES.has(norm) ||
    norm.includes("write") ||
    norm.includes("edit") ||
    norm.includes("replace")
  );
}

export function assertCoordinatorPreToolGuard(
  role: string,
  toolOrCategory: string,
  agentId?: string,
): void {
  if (isCoordinatorRole(role) && isCoordinatorFileEditForbidden(toolOrCategory)) {
    const agentDisplay = agentId ? `agent ${agentId}` : `role ${role}`;
    throw new HarnessError(
      "ROLE_BOUNDARY_DEVIATION",
      `Coordinator Anti-Direct-Execution Guard: ${agentDisplay} holds a coordinator grant and is strictly prohibited from executing file modification tool '${toolOrCategory}' (ROLE_BOUNDARY_DEVIATION). Coordinators must compile the task plan and dispatch Tier 3 Implementers via invoke_subagent.`,
    );
  }
}
