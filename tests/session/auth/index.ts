/**
 * Session Auth & Identity Resolution Facade.
 */
export {
  resolveActiveSession,
  autoDeriveCallerIdentity,
} from "../../../olt/scripts/src/authority/session/resolver.ts";

export {
  registerSessionGrant,
  registerInMemorySessionGrant,
} from "../../../olt/scripts/src/authority/session/grants.ts";

export {
  createSessionAuthResolver,
  SessionAuthResolver,
} from "../../../olt/scripts/src/capture/runners/session-auth-resolver.ts";
