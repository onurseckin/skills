import { HOST_PROVIDERS, type HostProvider } from "./types.ts";

export const CODE_EDIT_TOOL_NAMES_BY_HOST: Readonly<Record<HostProvider, readonly string[]>> = {
  antigravity: [
    "write_to_file",
    "replace_file_content",
    "edit_file",
    "apply_diff",
    "patch",
    "create_file",
    "delete_file",
    "file_writer",
    "code_editor",
  ],
  "claude-code": ["Write", "Edit", "NotebookEdit"],
  codex: ["apply_patch"],
  cursor: ["edit_file"],
  chatgpt: [],
};

export const CODE_EDIT_TOOLS: ReadonlySet<string> = new Set(
  HOST_PROVIDERS.flatMap((provider) => CODE_EDIT_TOOL_NAMES_BY_HOST[provider]),
);

export function isCodeEditTool(toolName: string): boolean {
  return CODE_EDIT_TOOLS.has(toolName);
}
