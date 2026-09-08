import { deriveTestSuite } from "../../src/testing/index.ts";

export const TEST_MODULE = "chatroom-identity";
export const IDENTITY_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const identityTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
