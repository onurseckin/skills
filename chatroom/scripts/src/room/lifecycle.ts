import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  assertValidRoomId,
  canonicalJson,
  ChatError,
  isRepoBinding,
  keysDir,
  repoBindingPath,
  roomConsumedInvitesDir,
  roomDaemonDir,
  roomDir,
  roomHandshakeDir,
  roomInvitesDir,
  roomKeyPath,
  roomLocksDir,
  roomLogDir,
  roomLogIndexPath,
  roomLogSegmentPath,
  roomMembersDir,
  roomProvisionDir,
  roomQuarantineDir,
  roomReadersDir,
  roomsDir,
  safeJsonParse,
  writeAtomic,
  type LogIndex,
  type RepoBinding,
  type RoomManifest,
  type RoomSettings,
  type RoomVisibility,
} from "../core/index.ts";
import { CHATROOM_PUBLIC_KEY, computeFingerprint } from "../crypto/index.ts";
import {
  createDefaultRoomSettings,
  readRoomManifest,
  roomManifestExists,
  writeRoomManifest,
} from "./manifest.ts";

export interface CreateRoomOptions {
  readonly id: string;
  readonly title?: string;
  readonly visibility?: RoomVisibility;
  readonly createdBy: string;
  readonly settings?: Partial<RoomSettings>;
  readonly key?: string;
}

export interface CreateRoomResult {
  readonly manifest: RoomManifest;
  readonly key: string;
}

export function createRoom(options: CreateRoomOptions): CreateRoomResult {
  assertValidRoomId(options.id);

  if (roomManifestExists(options.id)) {
    throw new ChatError("ROOM_ALREADY_EXISTS", `Room '${options.id}' already exists`);
  }

  const visibility: RoomVisibility = options.visibility ?? "keyed";
  let key: string;

  if (visibility === "public") {
    key = CHATROOM_PUBLIC_KEY;
  } else {
    key = options.key ?? randomBytes(32).toString("hex");
  }

  const keyFingerprint = computeFingerprint(key);
  const createdAt = new Date().toISOString();

  const manifest: RoomManifest = {
    v: 1,
    id: options.id,
    title: options.title ?? options.id,
    visibility,
    key_fingerprint: keyFingerprint,
    created_at: createdAt,
    created_by: options.createdBy,
    settings: createDefaultRoomSettings(options.settings),
  };

  mkdirSync(keysDir(), { recursive: true });
  mkdirSync(roomDir(options.id), { recursive: true });
  mkdirSync(roomLogDir(options.id), { recursive: true });
  mkdirSync(roomMembersDir(options.id), { recursive: true });
  mkdirSync(roomReadersDir(options.id), { recursive: true });
  mkdirSync(roomDaemonDir(options.id), { recursive: true });
  mkdirSync(roomHandshakeDir(options.id), { recursive: true });
  mkdirSync(roomInvitesDir(options.id), { recursive: true });
  mkdirSync(roomConsumedInvitesDir(options.id), { recursive: true });
  mkdirSync(roomProvisionDir(options.id), { recursive: true });
  mkdirSync(roomQuarantineDir(options.id), { recursive: true });

  const locksDirectory = roomLocksDir(options.id);
  mkdirSync(locksDirectory, { recursive: true });
  mkdirSync(join(locksDirectory, "readers"), { recursive: true });
  mkdirSync(join(locksDirectory, "spool"), { recursive: true });
  mkdirSync(join(locksDirectory, "daemon"), { recursive: true });

  if (visibility === "keyed") {
    writeAtomic(roomKeyPath(options.id), key, { mode: 0o600 });
  }

  writeRoomManifest(manifest);

  const initialIndex: LogIndex = {
    next_seq: 1,
    segments: ["000001.jsonl"],
    head_seq: 0,
    updated_at: createdAt,
  };
  writeAtomic(roomLogIndexPath(options.id), canonicalJson(initialIndex));
  writeAtomic(roomLogSegmentPath(options.id, 1), "");

  return {
    manifest,
    key,
  };
}

export function readRoomKey(roomId: string): string {
  const manifest = readRoomManifest(roomId);
  if (manifest.visibility === "public") {
    return CHATROOM_PUBLIC_KEY;
  }

  const keyPath = roomKeyPath(roomId);
  if (!existsSync(keyPath)) {
    throw new ChatError("NOT_FOUND", `Key file for room '${roomId}' not found at '${keyPath}'`);
  }

  return readFileSync(keyPath, "utf8").trim();
}

export function rotateRoomKey(roomId: string): string {
  const manifest = readRoomManifest(roomId);
  if (manifest.visibility === "public") {
    return CHATROOM_PUBLIC_KEY;
  }
  const key = randomBytes(32).toString("hex");
  const keyFingerprint = computeFingerprint(key);
  mkdirSync(keysDir(), { recursive: true });
  writeAtomic(roomKeyPath(roomId), key, { mode: 0o600 });
  const updatedManifest: RoomManifest = {
    ...manifest,
    key_fingerprint: keyFingerprint,
  };
  writeRoomManifest(updatedManifest);
  return key;
}

export function listRooms(): readonly RoomManifest[] {
  const root = roomsDir();
  if (!existsSync(root)) {
    return [];
  }

  const entries = readdirSync(root, { withFileTypes: true });
  const manifests: RoomManifest[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      try {
        const manifest = readRoomManifest(entry.name);
        manifests.push(manifest);
      } catch {}
    }
  }

  manifests.sort((left, right) => left.id.localeCompare(right.id));
  return manifests;
}

export function resolveRepoBinding(repoRoot: string): string | null {
  const bindingPath = repoBindingPath(repoRoot);
  if (!existsSync(bindingPath)) {
    return null;
  }

  try {
    const raw = readFileSync(bindingPath, "utf8");
    const parsed = safeJsonParse(raw);
    if (isRepoBinding(parsed)) {
      return parsed.member_id;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeRepoBinding(repoRoot: string, binding: RepoBinding): void {
  if (!isRepoBinding(binding)) {
    throw new ChatError("INVALID_ARGUMENT", "Invalid repo binding object");
  }
  const bindingPath = repoBindingPath(repoRoot);
  writeAtomic(bindingPath, canonicalJson(binding));
}
