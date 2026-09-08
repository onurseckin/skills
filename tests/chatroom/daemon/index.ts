import { deriveTestSuite } from "../helpers.ts";

export const CHATROOM_DAEMON_TEST_MODULE = "chatroom-daemon";
export const TEST_MODULE = CHATROOM_DAEMON_TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const daemonTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
