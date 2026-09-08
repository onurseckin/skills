import { deriveTestSuite } from "../../../src/testing/index.ts";

export {
  appendToLog,
  createHealthPorts,
  makeEnvelope,
  seedMember,
  seedRoom,
  VFS_PREFIX,
} from "./helpers.ts";

export const TEST_MODULE = "chatroom-cli-work";
export const CLI_WORK_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const workCliTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
