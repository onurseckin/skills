import { deriveTestSuite } from "../../src/testing/index.ts";

export const TEST_MODULE = "chatroom-policy";
export const POLICY_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const policyTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
