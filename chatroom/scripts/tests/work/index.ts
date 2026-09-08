import { deriveTestSuite } from "../../src/testing/index.ts";

export {
  appendToVirtualLog,
  assertCanPerformWork,
  createHealthPorts,
  joinRoomWithBriefContract,
  makeEnvelope,
  readVirtualLogEnvelopes,
  seedExistingMember,
  seedRoom,
  type JoinContractInput,
  type JoinContractResult,
} from "./brief-helpers.ts";

export const TEST_MODULE = "chatroom-work";
export const WORK_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const workTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
