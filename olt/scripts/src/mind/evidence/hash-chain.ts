import { existsSync, readFileSync } from "node:fs";
import type { JsonObject } from "../../core/contracts/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../core/json.ts";
import type { HashChainVerification } from "./types.ts";

export interface HashChainVerificationResult {
  readonly verification: HashChainVerification;
  readonly events: readonly Record<string, unknown>[];
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export function verifyEventsHashChain(eventsFilePath: string): HashChainVerificationResult {
  if (!existsSync(eventsFilePath)) {
    return {
      verification: {
        valid: false,
        totalEvents: 0,
        headHash: null,
        error: `Events file not found at ${eventsFilePath}`,
      },
      events: [],
    };
  }

  let rawContent: string;
  try {
    rawContent = readFileSync(eventsFilePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      verification: {
        valid: false,
        totalEvents: 0,
        headHash: null,
        error: `Failed to read events file: ${message}`,
      },
      events: [],
    };
  }

  if (!rawContent.trim()) {
    return {
      verification: {
        valid: true,
        totalEvents: 0,
        headHash: null,
      },
      events: [],
    };
  }

  const lines = rawContent.split("\n");
  const parsedEvents: Record<string, unknown>[] = [];
  let expectedPreviousHash: string | null = null;
  let expectedSequence = 1;

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index]?.trim();
    if (!rawLine) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        verification: {
          valid: false,
          totalEvents: parsedEvents.length,
          headHash: expectedPreviousHash,
          brokenAtSequence: expectedSequence,
          error: `Line ${index + 1} is invalid JSON: ${message}`,
        },
        events: parsedEvents,
      };
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        verification: {
          valid: false,
          totalEvents: parsedEvents.length,
          headHash: expectedPreviousHash,
          brokenAtSequence: expectedSequence,
          error: `Line ${index + 1} must be a JSON object`,
        },
        events: parsedEvents,
      };
    }

    const record = parsed as Record<string, unknown>;
    const hash = record["hash"];
    if (typeof hash !== "string" || !SHA256_HEX_PATTERN.test(hash)) {
      return {
        verification: {
          valid: false,
          totalEvents: parsedEvents.length,
          headHash: expectedPreviousHash,
          brokenAtSequence: expectedSequence,
          error: `Line ${index + 1} has invalid SHA-256 hash: "${String(hash)}"`,
        },
        events: parsedEvents,
      };
    }

    const previousHash = record["previous_hash"];
    if (expectedPreviousHash === null) {
      if (previousHash !== null && previousHash !== undefined) {
        return {
          verification: {
            valid: false,
            totalEvents: parsedEvents.length,
            headHash: expectedPreviousHash,
            brokenAtSequence: expectedSequence,
            error: `Sequence 1 must have null previous_hash, got "${String(previousHash)}"`,
          },
          events: parsedEvents,
        };
      }
    } else if (previousHash !== expectedPreviousHash) {
      return {
        verification: {
          valid: false,
          totalEvents: parsedEvents.length,
          headHash: expectedPreviousHash,
          brokenAtSequence: expectedSequence,
          error: `Line ${index + 1} previous_hash "${String(previousHash)}" does not match expected "${expectedPreviousHash}"`,
        },
        events: parsedEvents,
      };
    }

    const sequence = record["sequence"];
    if (typeof sequence === "number" && sequence !== expectedSequence) {
      return {
        verification: {
          valid: false,
          totalEvents: parsedEvents.length,
          headHash: expectedPreviousHash,
          brokenAtSequence: expectedSequence,
          error: `Line ${index + 1} sequence ${sequence} does not match expected sequence ${expectedSequence}`,
        },
        events: parsedEvents,
      };
    }

    const { hash: _omittedHash, ...content } = record;
    const computedHash = sha256Bytes(canonicalJsonBytes(content as JsonObject));
    if (hash !== computedHash) {
      return {
        verification: {
          valid: false,
          totalEvents: parsedEvents.length,
          headHash: expectedPreviousHash,
          brokenAtSequence: expectedSequence,
          error: `Line ${index + 1} hash mismatch: recorded "${hash}" != computed "${computedHash}"`,
        },
        events: parsedEvents,
      };
    }

    parsedEvents.push(record);
    expectedPreviousHash = hash;
    expectedSequence += 1;
  }

  return {
    verification: {
      valid: true,
      totalEvents: parsedEvents.length,
      headHash: expectedPreviousHash,
    },
    events: parsedEvents,
  };
}
