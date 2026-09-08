import { deriveTestSuite } from "../../../src/testing/index.ts";

export const TEST_MODULE = "chatroom-defects-cursor";
export const DEFECTS_CURSOR_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const cursorDefectTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
