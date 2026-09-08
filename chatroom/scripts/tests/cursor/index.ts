import { deriveTestSuite } from "../../src/testing/index.ts";

export const TEST_MODULE = "chatroom-cursor";
export const CURSOR_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const cursorTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
