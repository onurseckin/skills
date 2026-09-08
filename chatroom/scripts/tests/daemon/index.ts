import { deriveTestSuite } from "../../src/testing/index.ts";

export { DAEMON_HEALTH_TEST_MODULE, healthTestsSuite } from "./health/index.ts";
export { spoolTestsSuite } from "./spool/index.ts";

export const TEST_MODULE = "chatroom-daemon";
export const DAEMON_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const daemonTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
