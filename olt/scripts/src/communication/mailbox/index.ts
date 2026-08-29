export {
  DEFAULT_REPO_SECRET,
  assertEnvelopeIntegrity,
  canonicalEnvelopeBytes,
  createSignedEnvelope,
  verifyEnvelopeHmac,
} from "./envelope.ts";

export { ensureMailboxDirectories, resolveMailboxPaths } from "./mailbox-paths.ts";

export {
  appendMailboxMessage,
  isValidEnvelopeStructure,
  quarantineTornLines,
  readUnreadMessages,
  rotateMailboxMessages,
  type ReadUnreadMessagesOptions,
  type ReadUnreadMessagesResult,
  type RotateMailboxOptions,
} from "./mailbox-stream.ts";

export {
  DEFAULT_MAX_SEEN_IDS,
  advanceMailboxCursor,
  advanceMailboxCursorBatch,
  createEmptyCursor,
  isMessageProcessed,
  isValidCursorPayload,
  loadMailboxCursor,
  saveMailboxCursor,
} from "./cursor-tracker.ts";

export {
  broadcastWaveNotification,
  collectInboxReceipts,
  dispatchPeerMessage,
  resolveRecipientAgentIds,
  type CollectReceiptsOptions,
} from "./mailbox-dispatcher.ts";

export {
  assertNonChatterPolicy,
  filterHumanRelayNarration,
  isMidFlightNarration,
  routeStatusUpdate,
  type AssertNonChatterPolicyContext,
  type RouteStatusUpdateOptions,
} from "./chatter-guard.ts";
