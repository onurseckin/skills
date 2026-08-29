import { formatUniversalCheatSheet } from "../../../roles/index.ts";
import type {
  DynamicRoleSpec,
  DynamicRoleContract,
  RoleCheatSheetOptions,
  RoleCheatSheet,
} from "./types.ts";

export function generateDynamicRoleCheatSheet(
  roleOrSpec: DynamicRoleContract | DynamicRoleSpec,
  options?: RoleCheatSheetOptions | undefined,
): RoleCheatSheet {
  const spec = "spec" in roleOrSpec ? roleOrSpec.spec : roleOrSpec;
  return formatUniversalCheatSheet(spec, options);
}
