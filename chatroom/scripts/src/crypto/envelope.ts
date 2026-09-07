import { createHash, createHmac } from "node:crypto";
import {
  canonicalJsonBytes,
  timingSafeEqualBuffers,
  type Envelope,
  type UnsignedEnvelope,
} from "../core/index.ts";

export const CHATROOM_PUBLIC_KEY = "chatroom:public:v1";

export interface VerifyEnvelopeResult {
  readonly valid: boolean;
  readonly reason?: string;
}

export function computeFingerprint(key: string): string {
  const digest = createHash("sha256").update(key, "utf8").digest("hex");
  return `sha256:${digest.slice(0, 8)}`;
}

export function signEnvelope(unsigned: UnsignedEnvelope, key: string): Envelope {
  const bytes = canonicalJsonBytes(unsigned);
  const sig = createHmac("sha256", key).update(bytes).digest("hex");
  return {
    ...unsigned,
    sig,
  };
}

export function verifyEnvelope(envelope: Envelope, key: string): VerifyEnvelopeResult {
  const { sig, redelivery_count, ...unsigned } = envelope;
  void redelivery_count;

  const expectedSig = createHmac("sha256", key).update(canonicalJsonBytes(unsigned)).digest("hex");

  try {
    const providedBuffer = Buffer.from(sig, "hex");
    const expectedBuffer = Buffer.from(expectedSig, "hex");

    if (
      providedBuffer.byteLength !== expectedBuffer.byteLength ||
      !timingSafeEqualBuffers(providedBuffer, expectedBuffer)
    ) {
      return {
        valid: false,
        reason: "Signature mismatch",
      };
    }

    return { valid: true };
  } catch (error: unknown) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
