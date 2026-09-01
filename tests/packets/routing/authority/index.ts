/**
 * Command Authority Routing Facade.
 */
export {
  assertGrantedCommand,
  assertSpawnAuthorized,
  type AuthenticatedCaller,
} from "../../../../olt/scripts/src/packets/command-authority.ts";
export {
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  installMetaAuditGrant,
  scratchRoot,
  setupVirtualAuthorityFS,
  spec,
  testCaller,
} from "./command-authority-fixture.ts";
