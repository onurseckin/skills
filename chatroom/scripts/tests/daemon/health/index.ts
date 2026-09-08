import { deriveTestSuite } from "../../../src/testing/index.ts";

export const DAEMON_HEALTH_TEST_MODULE = "daemon-health";
export const TEST_MODULE = DAEMON_HEALTH_TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const healthTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
