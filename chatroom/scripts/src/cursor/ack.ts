import {
  absorbAckedAbove,
  assertCursorInvariants,
  ChatError,
  computeCursorChecksum,
  type HeldLease,
  type ReaderCursor,
} from "./model.ts";

export type Confirmation =
  | { readonly kind: "explicit"; readonly at: string }
  | {
      readonly kind: "spooled";
      readonly at: string;
      readonly spool_path: string;
      readonly spool_offset: number;
      readonly fsynced: boolean;
    };

export interface AckOptions {
  readonly now?: string;
}

function validateConfirmation(confirmation: Confirmation): void {
  if (!confirmation || typeof confirmation !== "object") {
    throw new ChatError("INVALID_ARGUMENT", "Confirmation is required and must be an object");
  }

  if (confirmation.kind === "explicit") {
    if (typeof confirmation.at !== "string" || confirmation.at.length === 0) {
      throw new ChatError("INVALID_ARGUMENT", "explicit confirmation requires non-empty at string");
    }
    return;
  }

  if (confirmation.kind === "spooled") {
    if (typeof confirmation.at !== "string" || confirmation.at.length === 0) {
      throw new ChatError("INVALID_ARGUMENT", "spooled confirmation requires non-empty at string");
    }
    if (typeof confirmation.spool_path !== "string" || confirmation.spool_path.length === 0) {
      throw new ChatError("INVALID_ARGUMENT", "spooled confirmation requires non-empty spool_path");
    }
    if (typeof confirmation.spool_offset !== "number" || confirmation.spool_offset < 0) {
      throw new ChatError(
        "INVALID_ARGUMENT",
        "spooled confirmation requires non-negative spool_offset",
      );
    }
    if (typeof confirmation.fsynced !== "boolean" || !confirmation.fsynced) {
      throw new ChatError("INVALID_ARGUMENT", "spooled confirmation requires fsynced: true");
    }
    return;
  }

  throw new ChatError(
    "INVALID_ARGUMENT",
    `Unknown confirmation kind: ${(confirmation as { kind?: string }).kind ?? "undefined"}`,
  );
}

export function ackLease(
  cursor: ReaderCursor,
  leaseId: string,
  through: number | null,
  confirmation: Confirmation,
  options?: AckOptions,
): ReaderCursor {
  validateConfirmation(confirmation);

  if (typeof leaseId !== "string" || leaseId.length === 0) {
    throw new ChatError("INVALID_ARGUMENT", "leaseId must be a non-empty string");
  }

  const leaseIndex = cursor.held.findIndex((h) => h.lease === leaseId);
  if (leaseIndex === -1) {
    throw new ChatError(
      "INVALID_STATE",
      `No live lease with id '${leaseId}' found for reader '${cursor.reader}'`,
    );
  }

  const heldLease = cursor.held[leaseIndex]!;
  const now = options?.now ?? confirmation.at;

  if (heldLease.expires_at <= now) {
    throw new ChatError(
      "INVALID_STATE",
      `Lease '${leaseId}' has expired at ${heldLease.expires_at} (current time: ${now})`,
    );
  }

  let ackThrough: number;
  if (through === null || through === undefined) {
    ackThrough = heldLease.to;
  } else {
    if (!Number.isInteger(through)) {
      throw new ChatError("INVALID_ARGUMENT", "through must be an integer or null");
    }
    if (through < heldLease.from) {
      throw new ChatError(
        "INVALID_STATE",
        `through seq ${through} is below lease start ${heldLease.from}`,
      );
    }
    if (through > heldLease.to) {
      throw new ChatError(
        "INVALID_STATE",
        `through seq ${through} exceeds lease end ${heldLease.to}`,
      );
    }
    ackThrough = through;
  }

  const updatedHeld: HeldLease[] = [];
  for (let i = 0; i < cursor.held.length; i++) {
    if (i === leaseIndex) {
      if (ackThrough < heldLease.to) {
        const partialLease: HeldLease = {
          ...heldLease,
          from: ackThrough + 1,
        };
        updatedHeld.push(partialLease);
      }
    } else {
      updatedHeld.push(cursor.held[i]!);
    }
  }

  let nextContiguous = cursor.contiguous_seq;
  let nextAckedAbove = [...cursor.acked_above];

  if (heldLease.from === cursor.contiguous_seq + 1) {
    nextContiguous = ackThrough;
    const absorbed = absorbAckedAbove(nextContiguous, nextAckedAbove);
    nextContiguous = absorbed.contiguous_seq;
    nextAckedAbove = absorbed.acked_above;
  } else {
    const newlyAcked: number[] = [];
    for (let seq = heldLease.from; seq <= ackThrough; seq++) {
      newlyAcked.push(seq);
    }
    const combined = [...nextAckedAbove, ...newlyAcked];
    const absorbed = absorbAckedAbove(nextContiguous, combined);
    nextContiguous = absorbed.contiguous_seq;
    nextAckedAbove = absorbed.acked_above;
  }

  const unsigned: Omit<ReaderCursor, "checksum"> = {
    v: 1,
    room: cursor.room,
    reader: cursor.reader,
    contiguous_seq: nextContiguous,
    held: updatedHeld,
    acked_above: nextAckedAbove,
    last_ack_at: confirmation.at,
    updated_at: now,
  };

  const checksum = computeCursorChecksum(unsigned);
  const finalCursor: ReaderCursor = {
    ...unsigned,
    checksum,
  };

  assertCursorInvariants(finalCursor);

  return finalCursor;
}
