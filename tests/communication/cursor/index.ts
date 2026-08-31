export {
  DEFAULT_MAX_SEEN_IDS,
  advanceMailboxCursor,
  advanceMailboxCursorBatch,
  createEmptyCursor,
  isMessageProcessed,
  isValidCursorPayload,
  loadMailboxCursor,
  saveMailboxCursor,
} from "../../../olt/scripts/src/communication/mailbox/cursor-tracker.ts";
export type {
  MailboxCursor,
} from "../../../olt/scripts/src/communication/types.ts";
