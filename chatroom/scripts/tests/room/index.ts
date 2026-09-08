import { deriveTestSuite } from "../../src/testing/index.ts";

export const ROOM_TESTS_READY = true;
export const TEST_MODULE = "chatroom-room";
export const ROOM_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const roomTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
