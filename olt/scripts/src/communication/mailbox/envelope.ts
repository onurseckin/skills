import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";
import type { CreateEnvelopeOptions, MailboxEnvelope, VerifyEnvelopeResult } from "../types.ts";

export const DEFAULT_REPO_SECRET = process.env.OLT_HMAC_SECRET || "olt-communication-secret-key";

const textEncoder = new TextEncoder();

function canonicalizeJson(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): string {
  if (value === null || value === undefined) {
    return "null";
  }

  const valueType = typeof value;

  if (valueType === "boolean" || valueType === "string") {
    return JSON.stringify(value);
  }

  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON numbers must be finite");
    }
    return JSON.stringify(value);
  }

  if (valueType === "bigint") {
    throw new TypeError("Do not know how to serialize a BigInt to JSON");
  }

  if (valueType === "function" || valueType === "symbol") {
    return "null";
  }

  if (valueType === "object") {
    const objectValue = value as object;

    if (typeof (objectValue as { toJSON?: () => unknown }).toJSON === "function") {
      const serialized = (objectValue as { toJSON: () => unknown }).toJSON();
      return canonicalizeJson(serialized, seen);
    }

    if (seen.has(objectValue)) {
      throw new TypeError("Circular reference in canonical JSON serialization");
    }
    seen.add(objectValue);

    try {
      if (Array.isArray(value)) {
        const items = value.map((item) => {
          if (item === undefined || typeof item === "function" || typeof item === "symbol") {
            return "null";
          }
          return canonicalizeJson(item, seen);
        });
        return `[${items.join(",")}]`;
      }

      const record = value as Record<string, unknown>;
      const sortedKeys = Object.keys(record).sort();
      const entries: string[] = [];

      for (const key of sortedKeys) {
        const prop = record[key];
        if (prop !== undefined && typeof prop !== "function" && typeof prop !== "symbol") {
          entries.push(`${JSON.stringify(key)}:${canonicalizeJson(prop, seen)}`);
        }
      }

      return `{${entries.join(",")}}`;
    } finally {
      seen.delete(objectValue);
    }
  }

  return JSON.stringify(value);
}

export function canonicalEnvelopeBytes(data: unknown): Uint8Array {
  const jsonString = canonicalizeJson(data);
  return textEncoder.encode(jsonString);
}

function computeEnvelopeSignature(
  unsignedPayload: Record<string, unknown>,
  secretKey: string,
): string {
  const bytes = canonicalEnvelopeBytes(unsignedPayload);
  return createHmac("sha256", secretKey).update(bytes).digest("hex");
}

export function createSignedEnvelope<T = Record<string, unknown>>(
  options: CreateEnvelopeOptions<T>,
): MailboxEnvelope<T> {
  const id = randomUUID();
  const sequence = options.sequence ?? 1;
  const timestamp = new Date().toISOString();
  const correlation_id = options.correlationId ?? id;
  const secretKey = options.secretKey || process.env.OLT_HMAC_SECRET || DEFAULT_REPO_SECRET;

  const unsignedEnvelope: Omit<MailboxEnvelope<T>, "hmac_signature"> = {
    id,
    sequence,
    sender_id: options.senderId,
    sender_role: options.senderRole,
    recipient_id: options.recipientId,
    message_type: options.messageType,
    timestamp,
    payload: options.payload,
    correlation_id,
  };

  const hmac_signature = computeEnvelopeSignature(
    unsignedEnvelope as unknown as Record<string, unknown>,
    secretKey,
  );

  return {
    ...unsignedEnvelope,
    hmac_signature,
  };
}

export function verifyEnvelopeHmac(
  envelope: MailboxEnvelope<unknown>,
  secretKey?: string,
): VerifyEnvelopeResult {
  if (typeof envelope !== "object" || envelope === null) {
    return {
      valid: false,
      error: "Envelope must be a non-null object",
    };
  }

  if (typeof envelope.hmac_signature !== "string" || envelope.hmac_signature.trim().length === 0) {
    return {
      valid: false,
      error: "Missing or invalid hmac_signature in envelope",
    };
  }

  const key = secretKey || process.env.OLT_HMAC_SECRET || DEFAULT_REPO_SECRET;

  try {
    const unsigned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(envelope)) {
      if (k !== "hmac_signature") {
        unsigned[k] = v;
      }
    }

    const expectedSignature = computeEnvelopeSignature(unsigned, key);

    const providedBuffer = Buffer.from(envelope.hmac_signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      return {
        valid: false,
        error:
          "HMAC signature mismatch: envelope content has been tampered with or signed with a different secret",
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Verification error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function assertEnvelopeIntegrity(
  envelope: MailboxEnvelope<unknown>,
  secretKey?: string,
): void {
  const result = verifyEnvelopeHmac(envelope, secretKey);
  if (!result.valid) {
    throw new HarnessError(
      "INTEGRITY",
      `Mailbox envelope failed HMAC integrity verification: ${result.error ?? "invalid signature"}`,
    );
  }
}
