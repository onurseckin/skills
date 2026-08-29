import { loadRoleContract, type RoleContract } from "../../../packets/role-contract.ts";

export function loadMindContract(): RoleContract {
  return loadRoleContract("mind");
}
