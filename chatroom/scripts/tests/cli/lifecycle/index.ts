import { deriveTestSuite } from "../../../src/testing/index.ts";

export const TEST_MODULE = "chatroom-cli-lifecycle";
export const CLI_LIFECYCLE_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const lifecycleTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
