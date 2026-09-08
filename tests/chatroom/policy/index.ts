import { deriveTestSuite } from "../helpers.ts";

export const POLICY_TEST_MODULE = "chatroom-policy";
export const TEST_MODULE = POLICY_TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const policyTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
