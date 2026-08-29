import { describe, expect, test } from "bun:test";
import {
  CODE_EDIT_TOOLS,
  CODE_EDIT_TOOL_NAMES_BY_HOST,
  isCodeEditTool,
} from "../../../olt/scripts/src/platform/index.ts";
import { HOST_PROVIDERS } from "../../../olt/scripts/src/platform/index.ts";
import { CODE_EDIT_TOOLS as ROLE_AUDITING_CODE_EDIT_TOOLS } from "../../../olt/scripts/src/mind/auditing/roles/index.ts";
import { CODE_EDIT_TOOLS as TIER_CONFINEMENT_CODE_EDIT_TOOLS } from "../../../olt/scripts/src/reporting/doctor/tier-confinement.ts";

describe("code-edit-tools: one host-aware table, not an antigravity-only one", () => {
  test("every declared host provider has an entry in the table", () => {
    for (const provider of HOST_PROVIDERS) {
      expect(CODE_EDIT_TOOL_NAMES_BY_HOST[provider]).toBeDefined();
    }
  });

  test("Claude Code's real edit tools are recognized as code-editing tools", () => {
    expect(isCodeEditTool("Write")).toBe(true);
    expect(isCodeEditTool("Edit")).toBe(true);
    expect(isCodeEditTool("NotebookEdit")).toBe(true);
  });

  test("Codex's real edit tool is recognized as a code-editing tool", () => {
    expect(isCodeEditTool("apply_patch")).toBe(true);
  });

  test("Cursor's edit tool is recognized as a code-editing tool", () => {
    expect(isCodeEditTool("edit_file")).toBe(true);
  });

  test("Antigravity's existing tool names are preserved unchanged", () => {
    for (const name of [
      "write_to_file",
      "replace_file_content",
      "edit_file",
      "apply_diff",
      "patch",
      "create_file",
      "delete_file",
      "file_writer",
      "code_editor",
    ]) {
      expect(isCodeEditTool(name)).toBe(true);
    }
  });

  test("mind/role-auditing.ts and reporting/doctor/tier-confinement.ts both consume the same shared set, not independent duplicates", () => {
    expect(ROLE_AUDITING_CODE_EDIT_TOOLS).toBe(CODE_EDIT_TOOLS);
    expect(TIER_CONFINEMENT_CODE_EDIT_TOOLS).toBe(CODE_EDIT_TOOLS);
  });

  test("a Claude Code coordinator writing code with Edit is not invisible to the tier-confinement guard", () => {
    expect(TIER_CONFINEMENT_CODE_EDIT_TOOLS.has("Edit")).toBe(true);
  });
});
