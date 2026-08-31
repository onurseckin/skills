/**
 * Workspace Layout Subdomain Test Facade.
 * Explicit named exports for capsule layouts, command structures, and reports.
 */

export { CAPSULE_LAYOUT, type LayoutEntry, type LayoutRole } from "../../../olt/scripts/src/engine/store/layout/layout.ts";
export { commandLayout } from "../../../olt/scripts/src/engine/store/layout/layout-commands.ts";
export { packetLayout } from "../../../olt/scripts/src/engine/store/layout/layout-packets.ts";
export { reportsLayout } from "../../../olt/scripts/src/engine/store/layout/layout-reports.ts";
export { checkManifest } from "../../../olt/scripts/src/engine/store/layout/manifest.ts";
export {
  CAPSULE_ID_PATTERN,
  CHECKPOINT_INTERVAL,
  isCheckpointSequence,
  limits,
  RESERVED_STATE_KEYS,
  RUN_ID_PATTERN,
  SHA256_PATTERN,
} from "../../../olt/scripts/src/engine/store/layout/constants.ts";
