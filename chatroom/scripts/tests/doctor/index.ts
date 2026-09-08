import { deriveTestSuite } from "../../src/testing/index.ts";

export const TEST_MODULE = "chatroom-doctor";
export const DOCTOR_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const doctorTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
