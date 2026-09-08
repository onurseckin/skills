import { deriveTestSuite } from "../../src/testing/index.ts";

export { cursorDefectTestsSuite } from "./cursor/index.ts";

export const TEST_MODULE = "chatroom-defects";
export const DEFECTS_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url, { recursive: true });
export const defectTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
