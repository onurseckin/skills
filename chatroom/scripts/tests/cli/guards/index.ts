import { deriveTestSuite } from "../../../src/testing/index.ts";

export const TEST_MODULE = "chatroom-cli-guards";
export const CLI_GUARDS_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const guardsTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
