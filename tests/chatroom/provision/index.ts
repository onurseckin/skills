import { deriveTestSuite } from "../helpers.ts";

export const PROVISION_TEST_MODULE = "chatroom-provision";
export const TEST_MODULE = PROVISION_TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const provisionTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
