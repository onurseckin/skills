import { deriveTestSuite } from "../helpers.ts";

export const LOG_TEST_MODULE = "chatroom-log";
export const TEST_MODULE = LOG_TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const logTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
