/**
 * Routing Domain Facade.
 */
export {
  assertGrantedCommand,
  assertSpawnAuthorized,
  spec,
  testCaller,
  installMetaAuditGrant,
  type AuthenticatedCaller,
} from "./authority/index.ts";
export { getCapsuleCliCommands } from "./cli/index.ts";
