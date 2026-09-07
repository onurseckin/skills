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

  return /(?:^|[-_])(?:write|edit|replace|mutation|mutate|delete|patch)(?:[-_]|$)/u.test(norm);
}

export const isSupervisorFileEditForbidden = isCoordinatorFileEditForbidden;

export function isCoordinatorRole(role: string): boolean {
  if (!role || typeof role !== "string") {
    return false;
  }
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  return (
    norm === "coordinator" ||
    norm.startsWith("coordinator-") ||
    norm.endsWith("-coordinator") ||
    norm.includes("-coordinator-") ||
    norm === "coord" ||
    norm.startsWith("coord-") ||
    norm.endsWith("-coord") ||
    norm.includes("-coord-")
  );
}

export function isOrchestratorRole(role: string): boolean {
  if (!role || typeof role !== "string") {
    return false;
  }
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  return (
    norm === "orchestrator" ||
    norm.startsWith("orchestrator-") ||
    norm.endsWith("-orchestrator") ||
    norm.includes("-orchestrator-") ||
    norm === "orch" ||
    norm.startsWith("orch-") ||
    norm.endsWith("-orch") ||
    norm.includes("-orch-")
  );
}
