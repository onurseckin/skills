/**
 * Routing Domain Facade.
 */
export {
  assertGrantedCommand,
  assertSpawnAuthorized,
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  installMetaAuditGrant,
  scratchRoot,
  setupVirtualAuthorityFS,
  spec,
  testCaller,
  type AuthenticatedCaller,
} from "./authority/index.ts";
export { getCapsuleCliCommands } from "./cli/index.ts";
