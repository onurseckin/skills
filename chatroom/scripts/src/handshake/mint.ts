import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { encodeBase32, formatInviteUri } from "./uri.ts";
import { writeAtomic } from "../core/index.ts";
import {
  CHATROOM_PUBLIC_KEY,
  HandshakeError,
  type HandshakeOptions,
  type InviteRecord,
} from "./types.ts";

function resolveChatroomDir(options?: HandshakeOptions): string {
  return (
    options?.chatroomDir ??
    process.env.CHATROOM_HOME ??
    path.join(os.homedir(), ".agents", "chatroom")
  );
}

const deriveKeyStream = (codeBytes: Uint8Array, roomId: string, length: number): Uint8Array =>
  new Uint8Array(
    crypto.hkdfSync("sha256", codeBytes, Buffer.from(roomId, "utf8"), Buffer.alloc(0), length),
  );

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const len = Math.min(a.length, b.length);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  return out;
}

export function wrapKey(roomKey: Uint8Array, codeBytes: Uint8Array, roomId: string): string {
  const keyStream = deriveKeyStream(codeBytes, roomId, roomKey.length);
  const wrappedKeyBytes = xorBytes(roomKey, keyStream);
  return Buffer.from(wrappedKeyBytes).toString("hex");
}

const computeKeyFingerprint = (key: Uint8Array): string =>
  crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);

const toKeyBytes = (t: string): Uint8Array =>
  /^[0-9a-fA-F]{64}$/.test(t)
    ? new Uint8Array(Buffer.from(t, "hex"))
    : new Uint8Array(Buffer.from(t, "utf8"));

function resolveKeyBytes(
  chatroomDir: string,
  roomId: string,
  roomDir: string,
  options?: HandshakeOptions,
): Uint8Array {
  if (options?.roomKey !== undefined) {
    return typeof options.roomKey === "string"
      ? toKeyBytes(options.roomKey.trim())
      : options.roomKey;
  }
  const keyPath = path.join(chatroomDir, "keys", `${roomId}.key`);
  if (fs.existsSync(keyPath)) return toKeyBytes(fs.readFileSync(keyPath, "utf8").trim());
  const roomJsonPath = path.join(roomDir, "room.json");
  if (fs.existsSync(roomJsonPath)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(roomJsonPath, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "visibility" in parsed &&
        (parsed as { visibility?: unknown }).visibility === "public"
      ) {
        return new Uint8Array(Buffer.from(CHATROOM_PUBLIC_KEY, "utf8"));
      }
    } catch {}
  }
  throw new HandshakeError(
    "ROOM_NOT_INITIALIZED",
    `Room key file not found at '${keyPath}' for room '${roomId}'`,
  );
}

export function mintInvite(
  room: string | { id: string },
  creator: string | { id: string },
  ttlSeconds: number,
  options?: HandshakeOptions,
): string {
  const roomId =
    typeof room === "string" ? room.trim().toLowerCase() : room.id.trim().toLowerCase();
  const creatorId = typeof creator === "string" ? creator.trim() : creator.id.trim();
  const chatroomDir = resolveChatroomDir(options);
  const roomDir = path.join(chatroomDir, "rooms", roomId);

  if (!fs.existsSync(roomDir)) {
    throw new HandshakeError("UNKNOWN_ROOM", `Room '${roomId}' does not exist locally`);
  }

  const roomKey = resolveKeyBytes(chatroomDir, roomId, roomDir, options);
  const roomJsonPath = path.join(roomDir, "room.json");
  let fingerprint = computeKeyFingerprint(roomKey);
  if (fs.existsSync(roomJsonPath)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(roomJsonPath, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "key_fingerprint" in parsed &&
        typeof (parsed as { key_fingerprint?: unknown }).key_fingerprint === "string"
      ) {
        const rFp = ((parsed as { key_fingerprint: string }).key_fingerprint ?? "")
          .replace(/^sha256:/, "")
          .toLowerCase();
        if (rFp.length > 0) fingerprint = rFp;
      }
    } catch {}
  }
  const codeBytes = new Uint8Array(crypto.randomBytes(16));
  const code = encodeBase32(codeBytes);
  const wrappedKeyHex = wrapKey(roomKey, codeBytes, roomId);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const record: InviteRecord = {
    code,
    created_at: now.toISOString(),
    created_by: creatorId,
    expires_at: expiresAt,
    uses_remaining: 1,
    wrapped_key: wrappedKeyHex,
  };

  writeAtomic(
    path.join(roomDir, "handshake", "invites", `${code}.json`),
    JSON.stringify(record, null, 2) + "\n",
    { mode: 0o600 },
  );

  return formatInviteUri(roomId, fingerprint, code);
}
