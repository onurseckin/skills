import { deriveTestSuite } from "../../src/testing/index.ts";

export const TEST_MODULE = "chatroom-core";
export const CORE_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const coreTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
