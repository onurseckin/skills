import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ChatError } from "./errors.ts";
import { isValidId } from "./guards.ts";

export function assertValidRoomId(roomId: string): void {
  if (!isValidId(roomId)) {
    throw new ChatError("INVALID_ROOM_ID", `Invalid room id '${roomId}'`);
  }
}

export function assertValidIdentity(id: string): void {
  if (!isValidId(id)) {
    throw new ChatError("INVALID_IDENTITY", `Invalid identity '${id}'`);
  }
}

export function chatroomHomeDir(): string {
  if (process.env.CHATROOM_HOME) {
    return resolve(process.env.CHATROOM_HOME);
  }
  return join(homedir(), ".agents", "chatroom");
}

export function globalPolicyPath(): string {
  return join(chatroomHomeDir(), "policy.json");
}

export function globalIdentityPath(): string {
  return join(chatroomHomeDir(), "identity.json");
}

export function keysDir(): string {
  return join(chatroomHomeDir(), "keys");
}

export function roomKeyPath(roomId: string): string {
  assertValidRoomId(roomId);
  return join(keysDir(), `${roomId}.key`);
}

export function roomsDir(): string {
  return join(chatroomHomeDir(), "rooms");
}

export function roomDir(roomId: string): string {
  assertValidRoomId(roomId);
  return join(roomsDir(), roomId);
}

export function roomManifestPath(roomId: string): string {
  return join(roomDir(roomId), "room.json");
}

export function roomLogDir(roomId: string): string {
  return join(roomDir(roomId), "log");
}

export function roomLogSegmentPath(roomId: string, segment: string | number): string {
  const segmentName =
    typeof segment === "number" ? `${String(segment).padStart(6, "0")}.jsonl` : segment;
  return join(roomLogDir(roomId), segmentName);
}

export function roomLogIndexPath(roomId: string): string {
  return join(roomDir(roomId), "log.index.json");
}

export function roomMembersDir(roomId: string): string {
  return join(roomDir(roomId), "members");
}

export function roomMemberPath(roomId: string, memberId: string): string {
  assertValidIdentity(memberId);
  return join(roomMembersDir(roomId), `${memberId}.json`);
}

export function roomReadersDir(roomId: string): string {
  return join(roomDir(roomId), "readers");
}

export function readerCursorPath(roomId: string, readerId: string): string {
  assertValidIdentity(readerId);
  return join(roomReadersDir(roomId), `${readerId}.cursor.json`);
}

export function readerSpoolCursorPath(roomId: string, readerId: string): string {
  assertValidIdentity(readerId);
  return join(roomReadersDir(roomId), `${readerId}.spool.cursor.json`);
}

export function roomDaemonDir(roomId: string): string {
  return join(roomDir(roomId), "daemon");
}

export function daemonOutSpoolPath(roomId: string, readerId: string, segment?: number): string {
  assertValidIdentity(readerId);
  const fileName =
    segment !== undefined ? `${readerId}.out.${segment}.jsonl` : `${readerId}.out.jsonl`;
  return join(roomDaemonDir(roomId), fileName);
}

export function daemonHealthPath(roomId: string, readerId: string): string {
  assertValidIdentity(readerId);
  return join(roomDaemonDir(roomId), `${readerId}.health.json`);
}

export function daemonRespawnPath(roomId: string, readerId: string): string {
  assertValidIdentity(readerId);
  return join(roomDaemonDir(roomId), `${readerId}.respawn.json`);
}

export function daemonReclaimPath(roomId: string, readerId: string): string {
  assertValidIdentity(readerId);
  return join(roomDaemonDir(roomId), `${readerId}.reclaim.jsonl`);
}

export function roomHandshakeDir(roomId: string): string {
  return join(roomDir(roomId), "handshake");
}

export function roomInvitesDir(roomId: string): string {
  return join(roomHandshakeDir(roomId), "invites");
}

export function roomInvitePath(roomId: string, code: string): string {
  return join(roomInvitesDir(roomId), `${code}.json`);
}

export function roomConsumedInvitesDir(roomId: string): string {
  return join(roomHandshakeDir(roomId), "consumed");
}

export function roomConsumedInvitePath(roomId: string, code: string): string {
  return join(roomConsumedInvitesDir(roomId), `${code}.json`);
}

export function roomProvisionDir(roomId: string): string {
  return join(roomDir(roomId), "provision");
}

export function roomProvisionReceiptPath(roomId: string, host: string, memberId: string): string {
  assertValidIdentity(memberId);
  return join(roomProvisionDir(roomId), `${host}.${memberId}.json`);
}

export function roomQuarantineDir(roomId: string): string {
  return join(roomDir(roomId), "quarantine");
}

export function roomQuarantinePath(roomId: string, timestamp: string, seq: number): string {
  const sanitizedTs = timestamp.replace(/[:.]/g, "-");
  return join(roomQuarantineDir(roomId), `${sanitizedTs}-${seq}.json`);
}

export function roomLocksDir(roomId: string): string {
  return join(roomDir(roomId), "locks");
}

export function roomAppendLockPath(roomId: string): string {
  return join(roomLocksDir(roomId), "append.lock");
}

export function readerLockPath(roomId: string, readerId: string): string {
  assertValidIdentity(readerId);
  return join(roomLocksDir(roomId), "readers", `${readerId}.lock`);
}

export function spoolLockPath(roomId: string, readerId: string): string {
  assertValidIdentity(readerId);
  return join(roomLocksDir(roomId), "spool", `${readerId}.lock`);
}

export function daemonLockPath(roomId: string, readerId: string): string {
  assertValidIdentity(readerId);
  return join(roomLocksDir(roomId), "daemon", `${readerId}.lock`);
}

export function repoChatroomDir(repoRoot: string): string {
  return join(resolve(repoRoot), ".chatroom");
}

export function repoPolicyPath(repoRoot: string): string {
  return join(repoChatroomDir(repoRoot), "policy.json");
}

export function repoBindingPath(repoRoot: string): string {
  return join(repoChatroomDir(repoRoot), "binding.json");
}
