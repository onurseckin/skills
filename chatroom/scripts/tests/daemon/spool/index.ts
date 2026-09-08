import { deriveTestSuite } from "../../../src/testing/index.ts";

export const TEST_MODULE = "chatroom-daemon-spool";
export const DAEMON_SPOOL_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const spoolTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
