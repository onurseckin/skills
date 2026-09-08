import { deriveTestSuite } from "./helpers.ts";

export {
  VIRTUAL_CHATROOM_HOME,
  cleanupVirtualChatroomFS,
  createTestRoom,
  deriveTestSuite,
  discoverTests as discoverSuiteTests,
  getVirtualChatroomFS,
  setupVirtualChatroomFS,
  withTestRoom,
  type DeriveTestSuiteOptions,
  type VirtualChatroomContext,
} from "./helpers.ts";

export const TEST_MODULE = "chatroom-root";
export const CHATROOM_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const chatroomTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
