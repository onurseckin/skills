export {
  DEFAULT_REPO_SECRET,
  assertEnvelopeIntegrity,
  canonicalEnvelopeBytes,
  createSignedEnvelope,
  verifyEnvelopeHmac,
} from "../../../olt/scripts/src/communication/mailbox/envelope.ts";
export type {
  CreateEnvelopeOptions,
  MailboxEnvelope,
  MessageType,
  HmacVerificationResult,
} from "../../../olt/scripts/src/communication/types.ts";
