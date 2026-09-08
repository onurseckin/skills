import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { decodeBase32, parseInviteUri } from "./uri.ts";
import {
  roomConsumedInvitePath,
  roomConsumedInvitesDir,
  roomInvitePath,
  writeAtomic,
} from "../core/index.ts";
import {
  HandshakeError,
  isInviteRecord,
  type ConsumedInviteRecord,
  type ConsumeInviteResult,
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

const computeKeyFingerprint = (key: Uint8Array): string =>
  crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);

function withAppendLock<T>(lockPath: string, fn: () => T): T {
  const dir = path.dirname(lockPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const start = Date.now();
  let fd: number | null = null;
  while (Date.now() - start < 5000) {
    try {
      fd = fs.openSync(
        lockPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR,
        0o600,
      );
      break;
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "EEXIST") {
        try {
          if (Date.now() - fs.statSync(lockPath).mtimeMs > 15000) fs.unlinkSync(lockPath);
        } catch {}
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        continue;
      }
      throw err;
    }
  }
  if (fd === null)
    throw new HandshakeError("LOCK_FAILED", `Failed to acquire append lock at '${lockPath}'`);
  try {
    return fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  }
}

function findRoomByFingerprint(roomsBase: string, targetFp: string): string {
  try {
    for (const c of fs.readdirSync(roomsBase)) {
      try {
        const p = path.join(roomsBase, c, "room.json");
        if (fs.existsSync(p)) {
          const parsed: unknown = JSON.parse(fs.readFileSync(p, "utf8"));
          if (typeof parsed === "object" && parsed !== null && "key_fingerprint" in parsed) {
            const rawFp = (parsed as { key_fingerprint?: unknown }).key_fingerprint;
            const fp = typeof rawFp === "string" ? rawFp.replace(/^sha256:/, "").toLowerCase() : "";
            if (fp === targetFp) return c;
          }
        }
      } catch {}
    }
  } catch {}
  return "unknown";
}

interface VerifiedInvite {
  readonly roomId: string;
  readonly code: string;
  readonly unwrappedKey: Uint8Array;
  readonly fingerprint: string;
  readonly inviteData: InviteRecord;
  readonly invitePath: string;
  readonly consumedPath: string;
}

function verifyInviteOnDisk(uri: string, options?: HandshakeOptions): VerifiedInvite {
  const parsedUri = parseInviteUri(uri);
  const { roomId, code } = parsedUri;
  const chatroomDir = resolveChatroomDir(options);
  const roomDir = path.join(chatroomDir, "rooms", roomId);
  const roomJsonPath = path.join(roomDir, "room.json");

  if (!fs.existsSync(roomDir) || !fs.existsSync(roomJsonPath)) {
    throw new HandshakeError("UNKNOWN_ROOM", `Room '${roomId}' does not exist locally`);
  }
  const consumedPath = options?.chatroomDir
    ? path.join(roomDir, "handshake", "consumed", `${code}.json`)
    : roomConsumedInvitePath(roomId, code);
  const invitePath = options?.chatroomDir
    ? path.join(roomDir, "handshake", "invites", `${code}.json`)
    : roomInvitePath(roomId, code);

  if (fs.existsSync(consumedPath)) {
    throw new HandshakeError(
      "HANDSHAKE_CONSUMED",
      `Invite '${code}' has already been consumed for room '${roomId}'`,
    );
  }
  if (!fs.existsSync(invitePath)) {
    throw new HandshakeError(
      "HANDSHAKE_CONSUMED",
      `Invite '${code}' not found or already consumed for room '${roomId}'`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(invitePath, "utf8"));
  } catch {
    throw new HandshakeError(
      "HANDSHAKE_CONSUMED",
      `Invite '${code}' not found or already consumed for room '${roomId}'`,
    );
  }
  if (!isInviteRecord(parsed)) {
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "expires_at" in parsed &&
      typeof (parsed as { expires_at: unknown }).expires_at === "string" &&
      Number.isNaN(Date.parse((parsed as { expires_at: string }).expires_at))
    ) {
      throw new HandshakeError(
        "INVITE_EXPIRED",
        `Invite '${code}' has invalid expiration timestamp`,
      );
    }
    throw new HandshakeError(
      "HANDSHAKE_CONSUMED",
      `Invite '${code}' not found or already consumed for room '${roomId}'`,
    );
  }
  const inviteData: InviteRecord = parsed;
  const expiresTimestamp = Date.parse(inviteData.expires_at);
  if (Number.isNaN(expiresTimestamp) || Date.now() > expiresTimestamp) {
    throw new HandshakeError(
      "INVITE_EXPIRED",
      `Invite '${code}' expired at ${inviteData.expires_at}`,
    );
  }

  const codeBytes = decodeBase32(code);
  const wrappedKeyBytes = new Uint8Array(Buffer.from(inviteData.wrapped_key, "hex"));
  const keyStream = deriveKeyStream(codeBytes, roomId, wrappedKeyBytes.length);
  const unwrappedKey = xorBytes(wrappedKeyBytes, keyStream);
  const rawFingerprint = computeKeyFingerprint(unwrappedKey);
  const hexFingerprint =
    unwrappedKey.length === 32
      ? crypto
          .createHash("sha256")
          .update(Buffer.from(unwrappedKey).toString("hex"), "utf8")
          .digest("hex")
          .slice(0, 8)
      : rawFingerprint;

  const manifestParsed: unknown = JSON.parse(fs.readFileSync(roomJsonPath, "utf8"));
  const roomFingerprint =
    typeof manifestParsed === "object" &&
    manifestParsed !== null &&
    "key_fingerprint" in manifestParsed &&
    typeof (manifestParsed as { key_fingerprint?: unknown }).key_fingerprint === "string"
      ? ((manifestParsed as { key_fingerprint: string }).key_fingerprint ?? "")
          .replace(/^sha256:/, "")
          .toLowerCase()
      : "";

  if (rawFingerprint !== roomFingerprint && hexFingerprint !== roomFingerprint) {
    const roomsBase = path.join(chatroomDir, "rooms");
    let actualRoom = findRoomByFingerprint(roomsBase, rawFingerprint);
    if (actualRoom === "unknown") {
      actualRoom = findRoomByFingerprint(roomsBase, parsedUri.fingerprint);
    }
    const msg = `Key fingerprint mismatch: claimed room '${roomId}' has fingerprint '${roomFingerprint}', but key fingerprint '${rawFingerprint}' belongs to room '${actualRoom}'`;
    throw new HandshakeError("WRONG_ROOM", msg, {
      claimedRoom: roomId,
      claimedFingerprint: roomFingerprint,
      actualRoom,
      actualFingerprint: rawFingerprint,
    });
  }

  return {
    roomId,
    code,
    unwrappedKey,
    fingerprint: hexFingerprint === roomFingerprint ? hexFingerprint : rawFingerprint,
    inviteData,
    invitePath,
    consumedPath,
  };
}

export function validateInvite(
  uri: string,
  options?: HandshakeOptions,
): { readonly roomId: string; readonly code: string; readonly key: Uint8Array } {
  const verified = verifyInviteOnDisk(uri, options);
  return { roomId: verified.roomId, code: verified.code, key: verified.unwrappedKey };
}

export function consumeInvite(
  uri: string,
  joiner: string | { id: string },
  options?: HandshakeOptions,
): ConsumeInviteResult {
  const parsedUri = parseInviteUri(uri);
  const joinerId = typeof joiner === "string" ? joiner.trim() : joiner.id.trim();
  const chatroomDir = resolveChatroomDir(options);
  const roomDir = path.join(chatroomDir, "rooms", parsedUri.roomId);
  const lockPath = path.join(roomDir, "locks", "append.lock");

  return withAppendLock(lockPath, () => {
    const verified = verifyInviteOnDisk(uri, options);
    const consumedDir = options?.chatroomDir
      ? path.dirname(verified.consumedPath)
      : roomConsumedInvitesDir(verified.roomId);
    if (!fs.existsSync(consumedDir)) fs.mkdirSync(consumedDir, { recursive: true, mode: 0o700 });
    fs.renameSync(verified.invitePath, verified.consumedPath);

    const record: ConsumedInviteRecord = {
      ...verified.inviteData,
      uses_remaining: 0,
      consumed_at: new Date().toISOString(),
      consumed_by: joinerId,
    };
    writeAtomic(verified.consumedPath, JSON.stringify(record, null, 2) + "\n", {
      mode: 0o600,
    });

    return {
      roomId: verified.roomId,
      key: verified.unwrappedKey,
      keyHex: Buffer.from(verified.unwrappedKey).toString("hex"),
      keyFingerprint: verified.fingerprint,
      joiner: joinerId,
      invite: record,
    };
  });
}
