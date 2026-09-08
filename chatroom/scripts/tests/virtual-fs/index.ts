import { deriveTestSuite } from "../../src/testing/index.ts";

export const TEST_MODULE = "chatroom-virtual-fs";
export const VIRTUAL_FS_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const virtualFsTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
