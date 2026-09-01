export {
  DEFAULT_REPO_SECRET,
  assertEnvelopeIntegrity,
  canonicalEnvelopeBytes,
  createSignedEnvelope,
  verifyEnvelopeHmac,
} from "./envelope.ts";

export {
  ensureMailboxDir,
  ensureMailboxDirectories,
  getInMemoryMailboxDirs,
  isInMemoryMailboxDir,
  isVirtualMailboxPath,
  isValidAgentId,
  listMailboxAgentIds,
  registerInMemoryMailboxDir,
  resetInMemoryMailboxDirs,
  resolveMailboxLockPath,
  resolveMailboxPaths,
  resolveSystemLockPath,
} from "./mailbox-paths.ts";

export {
  appendMailboxMessage,
  clearInMemoryMailboxStore,
  defaultLockPathFor,
  ensureParentDir,
  getInMemoryMailbox,
  getInMemoryQuarantine,
  isInMemoryStreamMode,
  isValidEnvelopeStructure,
  quarantineTornLines,
  readUnreadMessages,
  rotateMailboxMessages,
  setInMemoryMailbox,
  setInMemoryStreamMode,
  shouldUseInMemory,
  writeAndSync,
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
  clearInMemoryCursors,
  collectInboxReceipts,
  dispatchPeerMessage,
  getInMemoryCursor,
  resolveRecipientAgentIds,
  setInMemoryCursor,
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

export {
  clearInMemoryQuarantines,
  escapeQuarantinePayload,
  ingestToQuarantine,
  setInMemoryQuarantine,
  sweepQuarantineDeadLetters,
  unescapeQuarantinePayload,
  writeInMemoryQuarantine,
  type QuarantineIngestOptions,
  type QuarantinedDeadLetter,
  type QuarantinedEntry,
  type SweepQuarantineOptions,
  type SweepQuarantineResult,
} from "./quarantine.ts";
