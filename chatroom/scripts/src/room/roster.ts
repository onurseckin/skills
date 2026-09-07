import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ChatError, type Identity } from "../identity/index.ts";
import { writeAtomic } from "../core/index.ts";

export interface RoomSettings {
  readonly lease_ttl_ms?: number | undefined;
  readonly max_payload_bytes?: number | undefined;
  readonly segment_max_bytes?: number | undefined;
  readonly segment_max_lines?: number | undefined;
}

export interface RoomManifest {
  readonly v: number;
  readonly id: string;
  readonly title: string;
  readonly visibility: "keyed" | "public";
  readonly key_fingerprint: string;
  readonly created_at: string;
  readonly created_by: string;
  readonly settings?: RoomSettings | undefined;
}

export interface MemberRecord {
  readonly v: number;
  readonly id: string;
  readonly display_name?: string | undefined;
  readonly role: string;
  readonly host: string;
  readonly repo_hint?: string | undefined;
  readonly joined_at: string;
  readonly key_fingerprint?: string | undefined;
  readonly aliases?: readonly string[] | undefined;
}

export interface AddMemberInput {
  readonly id: string;
  readonly display_name?: string | undefined;
  readonly role?: string | undefined;
  readonly host?: string | undefined;
  readonly repo_hint?: string | undefined;
  readonly joined_at?: string | undefined;
  readonly key_fingerprint?: string | undefined;
  readonly aliases?: readonly string[] | undefined;
}

export interface RosterOptions {
  readonly baseDir?: string | undefined;
  readonly homeDir?: string | undefined;
  readonly roomDir?: string | undefined;
  readonly readFile?: ((filePath: string) => string | undefined) | undefined;
  readonly writeFile?: ((filePath: string, content: string) => void) | undefined;
  readonly exists?: ((filePath: string) => boolean) | undefined;
  readonly readdir?: ((dirPath: string) => readonly string[]) | undefined;
  readonly mkdir?: ((dirPath: string) => void) | undefined;
}

export { ChatError };

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{1,62}$/;

function assertValidIdentifier(value: string, code: "INVALID_IDENTITY" | "INVALID_ROOM_ID"): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new ChatError(
      code,
      `${code === "INVALID_IDENTITY" ? "invalid member id" : "invalid room id"}: '${value}'`,
    );
  }
}

function safeRead(p: string, custom?: (p: string) => string | undefined): string | undefined {
  if (custom !== undefined) return custom(p);
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return undefined;
  }
}

function safeExists(p: string, custom?: (p: string) => boolean): boolean {
  if (custom !== undefined) return custom(p);
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function resolveRoomDirAndId(
  room: RoomManifest | string,
  options?: RosterOptions,
): { readonly roomDir: string; readonly roomId: string } {
  const isPath = typeof room === "string" && (room.includes("/") || room.includes("\\"));
  const roomId = isPath
    ? path.basename(path.resolve(room as string))
    : typeof room === "string"
      ? room
      : room.id;
  const chatroomHome =
    process.env["CHATROOM_HOME"] ??
    path.join(options?.homeDir ?? process.env["HOME"] ?? os.homedir(), ".agents", "chatroom");
  const defaultBase = path.join(chatroomHome, "rooms", roomId);
  const roomDir = isPath
    ? path.resolve(room as string)
    : (options?.roomDir ?? (options?.baseDir ? path.join(options.baseDir, roomId) : defaultBase));
  return { roomDir, roomId };
}

function isIdentity(value: unknown): value is Identity {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c["id"] === "string" && c["verified"] === true && typeof c["source"] === "string";
}

function extractIdentityAndRoom(
  first: RoomManifest | string | Identity,
  second: RoomManifest | string | Identity,
): { readonly identity: Identity; readonly room: RoomManifest | string } {
  if (isIdentity(first)) return { identity: first, room: second as RoomManifest | string };
  if (isIdentity(second)) return { identity: second, room: first as RoomManifest | string };
  if (typeof second === "object" && second !== null && "id" in second && "verified" in second) {
    return { identity: second as unknown as Identity, room: first as RoomManifest | string };
  }
  return { identity: first as unknown as Identity, room: second as RoomManifest | string };
}

function levenshteinDistance(source: string, target: string): number {
  const rows = source.length + 1;
  const cols = target.length + 1;
  const distances = Array.from<number>({ length: rows * cols });
  for (let r = 0; r < rows; r += 1) distances[r * cols] = r;
  for (let c = 0; c < cols; c += 1) distances[c] = c;
  for (let r = 1; r < rows; r += 1) {
    for (let c = 1; c < cols; c += 1) {
      const cost = source[r - 1] === target[c - 1] ? 0 : 1;
      distances[r * cols + c] = Math.min(
        distances[(r - 1) * cols + c]! + 1,
        distances[r * cols + c - 1]! + 1,
        distances[(r - 1) * cols + c - 1]! + cost,
      );
    }
  }
  return distances[(rows - 1) * cols + (cols - 1)]!;
}

function formatAlternatives(values: readonly string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0]!;
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}

function nearestCandidates(target: string, candidates: readonly string[]): readonly string[] {
  const lower = target.toLowerCase();
  const prefixed = candidates
    .filter((c) => c.toLowerCase() !== lower && c.toLowerCase().startsWith(lower))
    .sort(
      (a, b) =>
        levenshteinDistance(lower, a.toLowerCase()) - levenshteinDistance(lower, b.toLowerCase()) ||
        a.localeCompare(b),
    );
  if (prefixed.length > 0) return prefixed.slice(0, 3);
  const ranked = candidates
    .map((c) => ({ candidate: c, distance: levenshteinDistance(lower, c.toLowerCase()) }))
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate));
  const nearest = ranked[0];
  if (nearest === undefined || nearest.distance > Math.max(2, Math.floor(target.length / 2)))
    return [];
  const threshold = Math.max(2, Math.floor(target.length / 2));
  return ranked
    .filter((entry) => entry.distance <= threshold)
    .slice(0, 3)
    .map((e) => e.candidate);
}

function parseMemberFile(content: string, fallbackId: string): MemberRecord | undefined {
  try {
    const p = JSON.parse(content) as Record<string, unknown>;
    return {
      v: typeof p["v"] === "number" ? p["v"] : 1,
      id: typeof p["id"] === "string" ? p["id"] : fallbackId,
      display_name: typeof p["display_name"] === "string" ? p["display_name"] : undefined,
      role: typeof p["role"] === "string" ? p["role"] : "communicator",
      host: typeof p["host"] === "string" ? p["host"] : "local",
      repo_hint: typeof p["repo_hint"] === "string" ? p["repo_hint"] : undefined,
      joined_at: typeof p["joined_at"] === "string" ? p["joined_at"] : "",
      key_fingerprint: typeof p["key_fingerprint"] === "string" ? p["key_fingerprint"] : undefined,
      aliases: Array.isArray(p["aliases"])
        ? p["aliases"].filter((a): a is string => typeof a === "string")
        : undefined,
    };
  } catch {
    return undefined;
  }
}

export function assertMember(
  room: RoomManifest | string,
  identity: Identity,
  options?: RosterOptions,
): MemberRecord;
export function assertMember(
  identity: Identity,
  room: RoomManifest | string,
  options?: RosterOptions,
): MemberRecord;
export function assertMember(
  first: RoomManifest | string | Identity,
  second: RoomManifest | string | Identity,
  options?: RosterOptions,
): MemberRecord {
  const { identity, room } = extractIdentityAndRoom(first, second);
  const { roomDir, roomId } = resolveRoomDirAndId(room, options);
  assertValidIdentifier(roomId, "INVALID_ROOM_ID");
  assertValidIdentifier(identity.id, "INVALID_IDENTITY");

  const memberPath = path.join(roomDir, "members", `${identity.id}.json`);
  if (safeExists(memberPath, options?.exists)) {
    const content = safeRead(memberPath, options?.readFile);
    if (content !== undefined && content.trim().length > 0) {
      const record = parseMemberFile(content, identity.id);
      if (record !== undefined) return record;
    }
  }

  const allMembers = listMembers(room, options);
  const aliasMatch = allMembers.find((m) => m.aliases?.includes(identity.id));
  if (aliasMatch !== undefined) return aliasMatch;

  throw new ChatError(
    "NOT_MEMBER",
    `identity '${identity.id}' is not a member of room '${roomId}'`,
  );
}

export function listMembers(
  room: RoomManifest | string,
  options?: RosterOptions,
): readonly MemberRecord[] {
  const { roomDir, roomId } = resolveRoomDirAndId(room, options);
  assertValidIdentifier(roomId, "INVALID_ROOM_ID");
  const membersDir = path.join(roomDir, "members");
  if (!safeExists(membersDir, options?.exists)) return [];

  const readdir =
    options?.readdir ??
    ((d: string) => {
      try {
        return fs.readdirSync(d) as string[];
      } catch {
        return [];
      }
    });

  const fileNames = readdir(membersDir);
  const results: MemberRecord[] = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json")) continue;
    const content = safeRead(path.join(membersDir, fileName), options?.readFile);
    if (content === undefined || content.trim().length === 0) continue;
    const record = parseMemberFile(content, fileName.slice(0, -5));
    if (record !== undefined) results.push(record);
  }
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

export function addMember(
  room: RoomManifest | string,
  member: AddMemberInput | Identity | MemberRecord,
  options?: RosterOptions,
): MemberRecord {
  const { roomDir, roomId } = resolveRoomDirAndId(room, options);
  assertValidIdentifier(roomId, "INVALID_ROOM_ID");
  assertValidIdentifier(member.id, "INVALID_IDENTITY");

  const membersDir = path.join(roomDir, "members");
  const memberPath = path.join(membersDir, `${member.id}.json`);
  const mkdir = options?.mkdir ?? ((d: string) => fs.mkdirSync(d, { recursive: true }));
  mkdir(membersDir);

  const now = new Date().toISOString();
  const joinedAt =
    "joined_at" in member && typeof member.joined_at === "string" && member.joined_at.length > 0
      ? member.joined_at
      : now;

  const record: MemberRecord = {
    v: 1,
    id: member.id,
    display_name:
      "display_name" in member && typeof member.display_name === "string"
        ? member.display_name
        : undefined,
    role: member.role ?? "communicator",
    host: member.host ?? "local",
    repo_hint: member.repo_hint,
    joined_at: joinedAt,
    key_fingerprint:
      "key_fingerprint" in member && typeof member.key_fingerprint === "string"
        ? member.key_fingerprint
        : undefined,
    aliases:
      "aliases" in member && Array.isArray(member.aliases)
        ? member.aliases.filter((a): a is string => typeof a === "string")
        : undefined,
  };

  const writeFile = options?.writeFile ?? ((p: string, c: string) => writeAtomic(p, c));
  writeFile(memberPath, JSON.stringify(record, null, 2) + "\n");
  return record;
}

export function resolveMention(
  room: RoomManifest | string,
  mention: string,
  options?: RosterOptions,
): MemberRecord;
export function resolveMention(
  mention: string,
  room: RoomManifest | string,
  options?: RosterOptions,
): MemberRecord;
export function resolveMention(
  first: RoomManifest | string,
  second: RoomManifest | string,
  options?: RosterOptions,
): MemberRecord {
  const isFirstMention = typeof first === "string" && first.startsWith("@");
  const isSecondMention = typeof second === "string" && second.startsWith("@");
  const isSecondManifest = typeof second === "object" && second !== null && "v" in second;
  const [room, rawMention] = isFirstMention
    ? [second, first]
    : isSecondMention
      ? [first, second]
      : isSecondManifest
        ? [second as RoomManifest, first as string]
        : [first, second as string];

  const target = rawMention.startsWith("@") ? rawMention.slice(1) : rawMention;
  const members = listMembers(room, options);

  const directMatch = members.find((m) => m.id === target);
  if (directMatch !== undefined) return directMatch;
  const aliasMatch = members.find((m) => m.aliases?.includes(target));
  if (aliasMatch !== undefined) return aliasMatch;

  const candidateSet = new Set<string>();
  for (const m of members) {
    candidateSet.add(m.id);
    if (m.aliases !== undefined) {
      for (const a of m.aliases) candidateSet.add(a);
    }
  }

  const suggestions = nearestCandidates(target, Array.from(candidateSet));
  const displayMention = rawMention.startsWith("@") ? rawMention : `@${rawMention}`;
  if (suggestions.length > 0) {
    const formatted = formatAlternatives(suggestions.map((s) => `@${s}`));
    throw new ChatError(
      "UNKNOWN_MENTION",
      `unknown mention '${displayMention}'; did you mean ${formatted}?`,
      formatted,
    );
  }
  throw new ChatError("UNKNOWN_MENTION", `unknown mention '${displayMention}'`);
}
