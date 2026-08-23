import { RoleBoundaryWatchdog } from "../olt/scripts/src/mind/role-auditing.ts";
import { partitionDynamicLanes } from "../olt/scripts/src/graph/topology.ts";
import { GLOBAL_SYNC_GEN5 } from "./sync-global.ts";

export const GEN5_VERIFIED: boolean =
  typeof RoleBoundaryWatchdog === "function" &&
  typeof partitionDynamicLanes === "function" &&
  GLOBAL_SYNC_GEN5 === true;
