/**
 * Command Authority Routing Facade.
 */
export {
  assertGrantedCommand,
  assertSpawnAuthorized,
  type AuthenticatedCaller,
} from "../../../../olt/scripts/src/packets/command-authority.ts";
export { spec, testCaller, installMetaAuditGrant } from "./command-authority-fixture.ts";
