import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { decodeBase32, encodeBase32, formatInviteUri, parseInviteUri } from "./uri.ts";

import {
  CHATROOM_PUBLIC_KEY,
  HandshakeError,
  type ConfirmationPreview,
  type ConsumedInviteRecord,
  type ConsumeInviteResult,
  type HandshakeErrorCode,
  type HandshakeOptions,
  type InviteRecord,
} from "./types.ts";

export {
  CHATROOM_PUBLIC_KEY,
  HandshakeError,
  type ConfirmationPreview,
  type ConsumedInviteRecord,
  type ConsumeInviteResult,
  type HandshakeErrorCode,
  type HandshakeOptions,
  type InviteRecord,
};

function resolveChatroomDir(options?: HandshakeOptions): string {
  return (
    options?.chatroomDir ??
    process.env.CHATROOM_HOME ??
    path.join(os.homedir(), ".agents", "chatroom")
  );
}

function deriveKeyStream(codeBytes: Uint8Array, roomId: string, length: number): Uint8Array {
  return new Uint8Array(
    crypto.hkdfSync("sha256", codeBytes, Buffer.from(roomId, "utf8"), Buffer.alloc(0), length),
  );
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const len = Math.min(a.length, b.length);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  return out;
}

function computeKeyFingerprint(key: Uint8Array): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
}

function resolveKeyBytes(
  chatroomDir: string,
  roomId: string,
  roomDir: string,
  options?: HandshakeOptions,
): Uint8Array {
  if (options?.roomKey !== undefined) {
    if (typeof options.roomKey === "string") {
      const t = options.roomKey.trim();
      return /^[0-9a-fA-F]{64}$/.test(t)
        ? new Uint8Array(Buffer.from(t, "hex"))
        : new Uint8Array(Buffer.from(t, "utf8"));
    }
    return options.roomKey;
  }
  const keyPath = path.join(chatroomDir, "keys", `${roomId}.key`);
  if (fs.existsSync(keyPath)) {
    const raw = fs.readFileSync(keyPath);
    const t = raw.toString("utf8").trim();
    return /^[0-9a-fA-F]{64}$/.test(t)
      ? new Uint8Array(Buffer.from(t, "hex"))
      : new Uint8Array(raw);
  }
  const roomJsonPath = path.join(roomDir, "room.json");
  if (fs.existsSync(roomJsonPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(roomJsonPath, "utf8"));
      if (m.visibility === "public")
        return new Uint8Array(Buffer.from(CHATROOM_PUBLIC_KEY, "utf8"));
    } catch {}
  }
  throw new HandshakeError(
    "ROOM_NOT_INITIALIZED",
    `Room key file not found at '${keyPath}' for room '${roomId}'`,
  );
}

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
    for (const candidate of fs.readdirSync(roomsBase)) {
      try {
        const p = path.join(roomsBase, candidate, "room.json");
        if (fs.existsSync(p)) {
          const m = JSON.parse(fs.readFileSync(p, "utf8"));
          const candFp = (m.key_fingerprint ?? "").replace(/^sha256:/, "").toLowerCase();
          if (candFp === targetFp) return candidate;
        }
      } catch {}
    }
  } catch {}
  return "unknown";
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
  const fingerprint = computeKeyFingerprint(roomKey);
  const codeBytes = new Uint8Array(crypto.randomBytes(16));
  const code = encodeBase32(codeBytes);

  const keyStream = deriveKeyStream(codeBytes, roomId, roomKey.length);
  const wrappedKeyBytes = xorBytes(roomKey, keyStream);
  const wrappedKeyHex = Buffer.from(wrappedKeyBytes).toString("hex");

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

  const invitesDir = path.join(roomDir, "handshake", "invites");
  if (!fs.existsSync(invitesDir)) fs.mkdirSync(invitesDir, { recursive: true, mode: 0o700 });

  const targetPath = path.join(invitesDir, `${code}.json`);
  const tempPath = path.join(invitesDir, `.${code}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tempPath, targetPath);

  return formatInviteUri(roomId, fingerprint, code);
}

export function consumeInvite(
  uri: string,
  joiner: string | { id: string },
  options?: HandshakeOptions,
): ConsumeInviteResult {
  const parsedUri = parseInviteUri(uri);
  const { roomId, code } = parsedUri;
  const joinerId = typeof joiner === "string" ? joiner.trim() : joiner.id.trim();
  const chatroomDir = resolveChatroomDir(options);
  const roomDir = path.join(chatroomDir, "rooms", roomId);
  const roomJsonPath = path.join(roomDir, "room.json");

  if (!fs.existsSync(roomDir) || !fs.existsSync(roomJsonPath)) {
    throw new HandshakeError("UNKNOWN_ROOM", `Room '${roomId}' does not exist locally`);
  }

  const consumedDir = path.join(roomDir, "handshake", "consumed");
  const consumedPath = path.join(consumedDir, `${code}.json`);
  const invitesDir = path.join(roomDir, "handshake", "invites");
  const invitePath = path.join(invitesDir, `${code}.json`);

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

  const lockPath = path.join(roomDir, "locks", "append.lock");
  const consumedRecord = withAppendLock(lockPath, () => {
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

    const inviteData: InviteRecord = JSON.parse(fs.readFileSync(invitePath, "utf8"));
    if (Date.now() > Date.parse(inviteData.expires_at)) {
      throw new HandshakeError(
        "INVITE_EXPIRED",
        `Invite '${code}' expired at ${inviteData.expires_at}`,
      );
    }

    if (!fs.existsSync(consumedDir)) fs.mkdirSync(consumedDir, { recursive: true, mode: 0o700 });
    fs.renameSync(invitePath, consumedPath);

    const record: ConsumedInviteRecord = {
      ...inviteData,
      uses_remaining: 0,
      consumed_at: new Date().toISOString(),
      consumed_by: joinerId,
    };
    fs.writeFileSync(consumedPath, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
    return record;
  });

  const codeBytes = decodeBase32(code);
  const wrappedKeyBytes = new Uint8Array(Buffer.from(consumedRecord.wrapped_key, "hex"));
  const keyStream = deriveKeyStream(codeBytes, roomId, wrappedKeyBytes.length);
  const unwrappedKey = xorBytes(wrappedKeyBytes, keyStream);
  const computedFingerprint = computeKeyFingerprint(unwrappedKey);

  const manifest = JSON.parse(fs.readFileSync(roomJsonPath, "utf8"));
  const roomFingerprint = (manifest.key_fingerprint ?? "").replace(/^sha256:/, "").toLowerCase();

  if (computedFingerprint !== roomFingerprint) {
    const roomsBase = path.join(chatroomDir, "rooms");
    let actualRoom = findRoomByFingerprint(roomsBase, computedFingerprint);
    if (actualRoom === "unknown") {
      actualRoom = findRoomByFingerprint(roomsBase, parsedUri.fingerprint);
    }
    throw new HandshakeError(
      "WRONG_ROOM",
      `Key fingerprint mismatch: claimed room '${roomId}' has fingerprint '${roomFingerprint}', but key fingerprint '${computedFingerprint}' belongs to room '${actualRoom}'`,
      {
        claimedRoom: roomId,
        claimedFingerprint: roomFingerprint,
        actualRoom,
        actualFingerprint: computedFingerprint,
      },
    );
  }

  return {
    roomId,
    key: unwrappedKey,
    keyHex: Buffer.from(unwrappedKey).toString("hex"),
    keyFingerprint: computedFingerprint,
    joiner: joinerId,
    invite: consumedRecord,
  };
}

export function getConfirmationPreview(
  roomId: string,
  options?: HandshakeOptions,
): ConfirmationPreview {
  const chatroomDir = resolveChatroomDir(options);
  const roomDir = path.join(chatroomDir, "rooms", roomId);
  const roomJsonPath = path.join(roomDir, "room.json");

  if (!fs.existsSync(roomDir) || !fs.existsSync(roomJsonPath)) {
    throw new HandshakeError("UNKNOWN_ROOM", `Room '${roomId}' does not exist locally`);
  }

  const manifest = JSON.parse(fs.readFileSync(roomJsonPath, "utf8"));
  const roomTitle = typeof manifest.title === "string" ? manifest.title : roomId;

  const membersDir = path.join(roomDir, "members");
  const memberList = fs.existsSync(membersDir)
    ? fs
        .readdirSync(membersDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
        .sort()
    : [];

  let messageCount = 0;
  const indexPath = path.join(roomDir, "log.index.json");
  if (fs.existsSync(indexPath)) {
    try {
      const idx = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      if (typeof idx.head_seq === "number") messageCount = idx.head_seq;
      else if (typeof idx.next_seq === "number") messageCount = Math.max(0, idx.next_seq - 1);
    } catch {}
  }

  const logDir = path.join(roomDir, "log");
  let lastMessagePreview: string | null = null;
  if (fs.existsSync(logDir)) {
    try {
      const segments = fs
        .readdirSync(logDir)
        .filter((f) => f.endsWith(".jsonl"))
        .sort();
      if (messageCount === 0 && segments.length > 0) {
        for (const seg of segments) {
          const lines = fs.readFileSync(path.join(logDir, seg), "utf8").trim().split("\n");
          for (const l of lines) if (l.trim().length > 0) messageCount++;
        }
      }
      const lastSeg = segments[segments.length - 1];
      if (lastSeg !== undefined) {
        const lines = fs.readFileSync(path.join(logDir, lastSeg), "utf8").trim().split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i]?.trim();
          if (line && line.length > 0) {
            try {
              const parsed = JSON.parse(line);
              lastMessagePreview =
                typeof parsed.text === "string"
                  ? (parsed.text.split("\n")[0] ?? parsed.text)
                  : line;
            } catch {
              lastMessagePreview = line;
            }
            break;
          }
        }
      }
    } catch {}
  }

  return { roomId, roomTitle, memberList, messageCount, lastMessagePreview };
}

export function formatConfirmationPreview(preview: ConfirmationPreview): string {
  const members = preview.memberList.length > 0 ? preview.memberList.join(", ") : "(none)";
  const previewLine = preview.lastMessagePreview ?? "(no messages yet)";
  return [
    `Room: ${preview.roomTitle} (${preview.roomId})`,
    `Members (${preview.memberList.length}): ${members}`,
    `Messages: ${preview.messageCount}`,
    `Last message: ${previewLine}`,
  ].join("\n");
}
