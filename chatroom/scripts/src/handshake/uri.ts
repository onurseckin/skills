const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ROOM_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{8}$/i;
const CODE_PATTERN = /^[a-z2-7]{26}$/i;

export interface InviteUri {
  readonly roomId: string;
  readonly fingerprint: string;
  readonly code: string;
}

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < bytes.length; i++) {
    const currentByte = bytes[i];
    if (currentByte === undefined) {
      continue;
    }
    value = (value << 8) | currentByte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(encoded: string): Uint8Array {
  const normalized = encoded.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const buffer: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === undefined) {
      continue;
    }
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`INVALID_BASE32: invalid character '${char}'`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      buffer.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(buffer);
}

export function formatInviteUri(roomId: string, fingerprint: string, code: string): string {
  const normalizedRoom = roomId.trim().toLowerCase();
  const normalizedFp = fingerprint
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, "");
  const normalizedCode = code.trim().toUpperCase();

  if (!ROOM_ID_PATTERN.test(normalizedRoom)) {
    throw new Error(`INVALID_ROOM_ID: invalid room id '${roomId}'`);
  }
  if (!FINGERPRINT_PATTERN.test(normalizedFp)) {
    throw new Error(`INVALID_FINGERPRINT: invalid fingerprint '${fingerprint}'`);
  }
  if (!CODE_PATTERN.test(normalizedCode)) {
    throw new Error(`INVALID_INVITE_CODE: invalid code '${code}'`);
  }

  return `chatroom://${normalizedRoom}#${normalizedFp}.${normalizedCode}`;
}

export function parseInviteUri(uri: string): InviteUri {
  const trimmed = uri.trim();
  const protocol = "chatroom://";
  if (!trimmed.startsWith(protocol)) {
    throw new Error(`INVALID_URI: URI must start with '${protocol}'`);
  }

  const remainder = trimmed.slice(protocol.length);
  const hashIndex = remainder.indexOf("#");
  if (hashIndex === -1) {
    throw new Error("INVALID_URI: missing '#' fragment delimiter");
  }

  const roomId = remainder.slice(0, hashIndex).toLowerCase();
  if (!ROOM_ID_PATTERN.test(roomId)) {
    throw new Error(`INVALID_URI: invalid room id '${roomId}'`);
  }

  const fragment = remainder.slice(hashIndex + 1);
  const dotIndex = fragment.indexOf(".");
  if (dotIndex === -1) {
    throw new Error("INVALID_URI: missing '.' separator between fingerprint and code");
  }

  const fingerprint = fragment.slice(0, dotIndex).toLowerCase();
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new Error(`INVALID_URI: invalid fingerprint '${fingerprint}'`);
  }

  const code = fragment.slice(dotIndex + 1).toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw new Error(`INVALID_URI: invalid invite code '${code}'`);
  }

  return {
    roomId,
    fingerprint,
    code,
  };
}
